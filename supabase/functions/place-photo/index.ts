// place-photo — proxies Google Places API (New) photo media bytes.
// Deno / Supabase Edge Function.
//
// Why this exists
// ---------------
// Google's Places API (New) photo media endpoint
// (`/v1/{photoName}/media?key=<API_KEY>`) embeds the API key directly in
// the URL. Returning that URL to the client (e.g. via a redirect) leaks
// the server key into network traces, browser history, and any
// `<img src>` referrer. That violates Tripvisor's no-server-key-in-the-
// client invariant.
//
// This function fetches the photo bytes server-side (the API key stays
// on the Edge host) and streams them back to the caller. The caller
// uses the function URL itself as the `<Image src>` value:
//   `${SUPABASE_URL}/functions/v1/place-photo?photoName=places/<id>/photos/<ref>&maxWidthPx=400`
//
// Auth model
// ----------
// Marked `verify_jwt = false` in supabase/config.toml. Photo names are
// tied to public Google Place ids — there is nothing user-specific in
// the request, and adding JWT verification would prevent the
// `<Image src>` element from authenticating (it cannot set
// `Authorization` headers). Key safety is preserved because the
// Google API key never leaves the function.
//
// Caching
// -------
// `Cache-Control: public, max-age=21600` (6h). Google's photo media
// CDN URLs typically expire within hours; 6h is a conservative ceiling
// that lets the browser / CDN cache the response without serving a
// stale 404 for too long. The browser is the primary cache layer; we
// do not cache server-side beyond the implicit Edge cold path.
//
// Contract
// --------
//   GET /place-photo?photoName=<encoded>&maxWidthPx=<n>
//   200: image/jpeg bytes
//   400: { error: { code: 'invalid_input', message } }
//        — photoName missing/malformed OR maxWidthPx out of range
//   500: { error: { code: 'server_misconfigured', message } }
//        — GOOGLE_MAPS_SERVER_KEY missing on the Edge host
//   502: { error: { code: 'upstream_error' | 'google_places_*', message } }
//   504: { error: { code: 'upstream_timeout', message } }
//
// We use GET (not POST) so the URL itself can be embedded in `<Image src>`.

import { handlePreflight, corsHeaders } from '../_shared/cors.ts';
import { errorResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 8000;

// Google's photo resource name pattern: `places/{place_id}/photos/{photo_id}`.
// {place_id} and {photo_id} are opaque alphanumeric strings; we accept
// the conservative URL-safe charset including hyphens and underscores
// (Google's docs show both). Reject anything else to avoid being a
// generic open proxy onto Google's CDN.
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_\-]+\/photos\/[A-Za-z0-9_\-]+$/;

// Google's documented bounds for maxWidthPx are 1..4800. We default to
// 400 (matches the planner brief) and clamp into a slightly tighter
// 1..4800 to mirror Google's own validation.
const MAX_WIDTH_DEFAULT = 400;
const MAX_WIDTH_MIN = 1;
const MAX_WIDTH_MAX = 4800;

function mapGooglePhotosError(status: number, body: string) {
  if (status === 404) {
    return { code: 'photo_not_found', message: 'Google photo was not found', status: 404 };
  }
  const normalized = body.toLowerCase();
  if (
    status === 403 &&
    (normalized.includes('places api (new) has not been used') ||
      normalized.includes('disabled') ||
      normalized.includes('billing'))
  ) {
    return {
      code: 'google_places_disabled',
      message:
        'Google Places API (New) is disabled or billing is not active for the server key project.',
      status: 502,
    };
  }
  if (
    status === 403 &&
    (normalized.includes('referer') ||
      normalized.includes('referrer') ||
      normalized.includes('api_key_http_referrer_blocked'))
  ) {
    return {
      code: 'google_key_restricted',
      message:
        'Google Maps server key cannot call Places photos from Edge Functions. Use a server key without browser referrer restrictions.',
      status: 502,
    };
  }
  if (status === 403) {
    return {
      code: 'google_places_forbidden',
      message:
        'Google Places rejected the server key. Check API restrictions, billing, and project access.',
      status: 502,
    };
  }
  return { code: 'upstream_error', message: 'Google Places photo request returned an error', status: 502 };
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    // Mirror place-details: a tiny JSON ping for warmup + monitoring.
    return new Response(JSON.stringify({ ok: true, fn: 'place-photo' }), {
      headers: (() => {
        const h = corsHeaders(origin);
        h.set('Content-Type', 'application/json');
        return h;
      })(),
    });
  }

  if (req.method !== 'GET') {
    return errorResponse('method_not_allowed', 'Only GET is allowed', 405, origin);
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'place-photo', level: 'error', err: 'missing_server_key' });
    return errorResponse(
      'server_misconfigured',
      'Google Maps server key is not configured. See docs/google-maps-setup.md.',
      500,
      origin,
    );
  }

  const photoName = url.searchParams.get('photoName');
  if (!photoName || !PHOTO_NAME_PATTERN.test(photoName)) {
    return errorResponse(
      'invalid_input',
      'photoName is required and must match places/<placeId>/photos/<photoRef>',
      400,
      origin,
    );
  }

  // maxWidthPx is optional; default 400. Out-of-bounds values get clamped
  // (rather than rejected) to keep `<Image>` resilient — a caller
  // accidentally passing 0 or 9999 still gets a sensible photo.
  const rawMax = url.searchParams.get('maxWidthPx');
  let maxWidthPx = MAX_WIDTH_DEFAULT;
  if (rawMax !== null) {
    const parsed = Number.parseInt(rawMax, 10);
    if (!Number.isFinite(parsed)) {
      return errorResponse('invalid_input', 'maxWidthPx must be an integer', 400, origin);
    }
    maxWidthPx = Math.min(MAX_WIDTH_MAX, Math.max(MAX_WIDTH_MIN, parsed));
  }

  // Google's photo media endpoint by default issues a 302 redirect to the
  // CDN-hosted image. We let `fetch` follow the redirect server-side so
  // the API key (in the initial URL) is never exposed to the client.
  // `redirect: 'follow'` is the default for Deno's fetch but we name it
  // explicitly for clarity.
  const photoUrl = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  photoUrl.searchParams.set('maxWidthPx', String(maxWidthPx));
  photoUrl.searchParams.set('key', apiKey);

  const start = Date.now();
  try {
    const googleRes = await fetchWithTimeout(
      photoUrl.toString(),
      {
        method: 'GET',
        redirect: 'follow',
      },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: 'place-photo',
        level: 'error',
        photoName,
        maxWidthPx,
        status: googleRes.status,
        body: text.slice(0, 500),
        durationMs: Date.now() - start,
      });
      const mapped = mapGooglePhotosError(googleRes.status, text);
      return errorResponse(mapped.code, mapped.message, mapped.status, origin);
    }

    // Stream the bytes back. Pull the upstream content-type (Google
    // returns image/jpeg or image/png depending on the source); fall
    // back to image/jpeg if Google didn't set one.
    const contentType = googleRes.headers.get('content-type') ?? 'image/jpeg';
    const respHeaders = corsHeaders(origin);
    respHeaders.set('Content-Type', contentType);
    // 6h browser cache. The CDN URL behind Google's redirect typically
    // expires within hours; this ceiling keeps us safe without serving
    // stale 404s for too long.
    respHeaders.set('Cache-Control', 'public, max-age=21600');

    const bytes = await googleRes.arrayBuffer();

    log({
      requestId,
      fn: 'place-photo',
      level: 'info',
      photoName,
      maxWidthPx,
      bytes: bytes.byteLength,
      contentType,
      durationMs: Date.now() - start,
    });

    return new Response(bytes, { status: 200, headers: respHeaders });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'place-photo',
      level: 'error',
      photoName,
      maxWidthPx,
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return errorResponse(
      isAbort ? 'upstream_timeout' : 'upstream_error',
      'Google Places photo request failed',
      isAbort ? 504 : 502,
      origin,
    );
  }
}

Deno.serve(handler);
