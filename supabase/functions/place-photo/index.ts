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
// client invariant. This function fetches the bytes server-side (the key
// stays on the Edge host) and streams them back.
//
// Two operations
// --------------
//   GET  ?photoName=<name>&maxWidthPx=<w>&exp=<unix s>&sig=<b64url>
//        -> image bytes. PUBLIC (`verify_jwt = false`, see below) but only
//           with a valid, unexpired HMAC signature.
//   POST { photos: [{ name, maxWidthPx? }] }   (1..20 entries)
//        -> { photos: [{ name, maxWidthPx, exp, sig }] }. AUTHENTICATED
//           (requireUser) fallback signer, metered by
//           DAILY_QUOTA.photo_sign per user per UTC day. The primary
//           signer is place-details, which embeds `photos[].signature`.
//
// Auth model (security audit 2026-09-29 #3)
// -----------------------------------------
// `verify_jwt = false` in supabase/config.toml is REQUIRED for the GET: the
// URL is used as `<Image src>`, which cannot send an Authorization header.
// Before the audit that made this a public, unlimited, billed proxy, and an
// arbitrary maxWidthPx (1..4800) defeated every cache. Now:
//   - every GET needs sig = HMAC-SHA256(PHOTO_URL_SECRET, `name|w|exp`),
//     minted ONLY by authenticated paths (place-details, POST here). The
//     URL is self-authenticating and short-lived (exp <= 24h, bucketed, so
//     URLs stay cache-stable; see _shared/photo-signature.ts);
//   - widths are limited to {200, 400, 800, 1600} (requests snap UP), so
//     there are at most four cache variants per photo;
//   - a per-isolate fixed-window rate limit per signature and per client IP
//     caps replay of one leaked URL (-> 429 rate_limited);
//   - the POST signer requires a real user and is metered.
// The Google key never leaves the function.
//
// Caching
// -------
// `Cache-Control: public, max-age=21600` (6h) on 200s. Google's CDN URLs
// typically expire within hours; 6h is a conservative ceiling. Because the
// signature's `exp` is bucketed, the same photo+width keeps the same URL
// for 12h and browsers/CDNs actually get cache hits.
//
// Contract (GET)
// --------------
//   200: image bytes (upstream content-type, fallback image/jpeg)
//   400: invalid_input: photoName missing/malformed
//   403: invalid_signature | signature_expired (the client re-signs via POST)
//   429: rate_limited (+ Retry-After)
//   500: server_misconfigured: GOOGLE_MAPS_SERVER_KEY or PHOTO_URL_SECRET missing
//   502: upstream_error | photo_not_found(404) | google_places_*
//   504: upstream_timeout
// Contract (POST)
// ---------------
//   200: { photos: [{ name, maxWidthPx, exp, sig }] }
//   400: invalid_input · 401: not_authenticated · 429: quota_exceeded
//   500: server_misconfigured

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import {
  consumeQuota,
  describeInvalidInput,
  quotaDeniedResponse,
  requireUser,
} from '../_shared/auth.ts';
import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import {
  PHOTO_NAME_PATTERN,
  photoSignatureExpiry,
  signPhoto,
  snapPhotoWidth,
  verifyPhotoSignature,
} from '../_shared/photo-signature.ts';

const FN = 'place-photo';
const TIMEOUT_MS = 8000;

/** Max photo names per POST sign request. A trips list signs a page at a time. */
const MAX_SIGN_BATCH = 20;

// ---- Per-isolate rate limit (GET) --------------------------------------------
// Fixed 10-minute windows, per isolate. Cheap and dependency-free. It does
// not replace the signature: it bounds how often ONE valid URL (e.g. a
// leaked one) or ONE client can pull billed bytes before browser caching
// takes over. Legit clients fetch each URL about once per 6h (Cache-Control),
// so these ceilings sit far above normal use.
const RL_WINDOW_MS = 10 * 60_000;
const RL_MAX_PER_SIG = 20;
const RL_MAX_PER_IP = 300;
const RL_MAX_KEYS = 10_000; // memory bound; the map is pruned when exceeded

const rlCounters = new Map<string, { windowStart: number; count: number }>();

/** Returns seconds to wait when over the limit, else 0. Exported for tests. */
export function rateLimitHit(key: string, max: number, nowMs: number): number {
  const entry = rlCounters.get(key);
  if (!entry || nowMs - entry.windowStart >= RL_WINDOW_MS) {
    if (rlCounters.size >= RL_MAX_KEYS) {
      for (const [k, v] of rlCounters) {
        if (nowMs - v.windowStart >= RL_WINDOW_MS) rlCounters.delete(k);
      }
      // Still full of live windows: drop the oldest insertions (Map order).
      if (rlCounters.size >= RL_MAX_KEYS) {
        let toDrop = Math.ceil(RL_MAX_KEYS / 10);
        for (const k of rlCounters.keys()) {
          rlCounters.delete(k);
          if (--toDrop <= 0) break;
        }
      }
    }
    rlCounters.set(key, { windowStart: nowMs, count: 1 });
    return 0;
  }
  entry.count += 1;
  if (entry.count > max) {
    return Math.max(1, Math.ceil((entry.windowStart + RL_WINDOW_MS - nowMs) / 1000));
  }
  return 0;
}

/** Test-only: clear the rate-limit windows between cases. */
export function _resetRateLimitForTests(): void {
  rlCounters.clear();
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null;
}

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

function misconfigured(origin: string | null, requestId: string, what: string): Response {
  log({ requestId, fn: FN, level: 'error', err: `missing_${what}` });
  return errorResponse(
    'server_misconfigured',
    what === 'photo_url_secret'
      ? 'PHOTO_URL_SECRET is not configured on the Edge host.'
      : 'Google Maps server key is not configured. See docs/google-maps-setup.md.',
    500,
    origin,
  );
}

// ---- POST: authenticated fallback signer ---------------------------------------

const SignBodySchema = z.object({
  photos: z
    .array(
      z.object({
        name: z.string().regex(PHOTO_NAME_PATTERN),
        maxWidthPx: z.number().int().positive().max(10_000).optional(),
      }),
    )
    .min(1)
    .max(MAX_SIGN_BATCH),
});

async function handleSign(req: Request, origin: string | null, requestId: string): Promise<Response> {
  const auth = await requireUser(req, { fn: FN, requestId, origin });
  if (!auth.ok) return auth.response;

  const secret = Deno.env.get('PHOTO_URL_SECRET');
  if (!secret) return misconfigured(origin, requestId, 'photo_url_secret');

  let body: z.infer<typeof SignBodySchema>;
  try {
    body = SignBodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse('invalid_input', describeInvalidInput(err), 400, origin);
  }

  const quota = await consumeQuota({
    userId: auth.user.id,
    kind: 'photo_sign',
    units: body.photos.length,
    requestId,
    fn: FN,
  });
  if (quota !== 'ok') return quotaDeniedResponse(quota, 'photo_sign', origin);

  const exp = photoSignatureExpiry(Date.now());
  const photos = await Promise.all(
    body.photos.map(async (p: { name: string; maxWidthPx?: number }) => {
      const w = snapPhotoWidth(p.maxWidthPx);
      return { name: p.name, maxWidthPx: w, exp, sig: await signPhoto(secret, p.name, w, exp) };
    }),
  );

  log({ requestId, fn: FN, level: 'info', op: 'sign', userId: auth.user.id, count: photos.length });
  return jsonResponse({ photos }, { origin });
}

// ---- GET: signature-gated byte proxy ---------------------------------------------

async function handleFetch(
  req: Request,
  url: URL,
  origin: string | null,
  requestId: string,
): Promise<Response> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) return misconfigured(origin, requestId, 'server_key');
  const secret = Deno.env.get('PHOTO_URL_SECRET');
  if (!secret) return misconfigured(origin, requestId, 'photo_url_secret');

  const photoName = url.searchParams.get('photoName');
  if (!photoName || !PHOTO_NAME_PATTERN.test(photoName)) {
    return errorResponse(
      'invalid_input',
      'photoName is required and must match places/<placeId>/photos/<photoRef>',
      400,
      origin,
    );
  }

  const sig = url.searchParams.get('sig');
  const nowMs = Date.now();
  const check = await verifyPhotoSignature({
    secret,
    photoName,
    maxWidthPx: url.searchParams.get('maxWidthPx'),
    exp: url.searchParams.get('exp'),
    sig,
    nowMs,
  });
  if (!check.ok) {
    log({ requestId, fn: FN, level: 'warn', op: 'fetch', stage: 'signature', reason: check.reason });
    return check.reason === 'expired'
      ? errorResponse('signature_expired', 'Photo URL has expired; request a new one', 403, origin)
      : errorResponse('invalid_signature', 'Photo URL is missing or has an invalid signature', 403, origin);
  }
  const maxWidthPx = check.width;

  // Rate limits run after verification, so unsigned junk can't fill the maps.
  const ip = clientIp(req);
  const wait =
    rateLimitHit(`s:${sig}`, RL_MAX_PER_SIG, nowMs) ||
    (ip ? rateLimitHit(`i:${ip}`, RL_MAX_PER_IP, nowMs) : 0);
  if (wait > 0) {
    log({ requestId, fn: FN, level: 'warn', op: 'fetch', stage: 'rate_limit', photoName });
    return jsonResponse(
      { error: { code: 'rate_limited', message: 'Too many photo requests; slow down' } },
      { status: 429, origin, headers: { 'Retry-After': String(wait) } },
    );
  }

  // Google's photo media endpoint 302-redirects to the CDN-hosted image. We
  // follow it server-side so the API key (in the initial URL) never reaches
  // the client.
  const photoUrl = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  photoUrl.searchParams.set('maxWidthPx', String(maxWidthPx));
  photoUrl.searchParams.set('key', apiKey);

  const start = Date.now();
  try {
    const googleRes = await fetchWithTimeout(
      photoUrl.toString(),
      { method: 'GET', redirect: 'follow' },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: FN,
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

    const contentType = googleRes.headers.get('content-type') ?? 'image/jpeg';
    const respHeaders = corsHeaders(origin);
    respHeaders.set('Content-Type', contentType);
    // 6h browser/CDN cache (see header). The bucketed `exp` keeps the URL,
    // and so the cache key, stable for 12h.
    respHeaders.set('Cache-Control', 'public, max-age=21600');

    const bytes = await googleRes.arrayBuffer();

    log({
      requestId,
      fn: FN,
      level: 'info',
      op: 'fetch',
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
      fn: FN,
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

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: FN }, { origin });
  }

  if (req.method === 'GET') return await handleFetch(req, url, origin, requestId);
  if (req.method === 'POST') return await handleSign(req, origin, requestId);
  return errorResponse('method_not_allowed', 'Only GET and POST are allowed', 405, origin);
}

Deno.serve(handler);
