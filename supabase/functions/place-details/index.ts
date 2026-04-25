// place-details — proxies Google Places API (New) :get
// Deno / Supabase Edge Function
//
// Contract:
//   POST { placeId: string, sessionToken?: string, fields?: string[] }
//   -> { place: PlaceDetails }
//
// Reviews, photos, rating, hours etc. are returned live and MUST NOT be
// persisted by the client beyond the React Query cache (Google ToS).

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 8000;

// Full mask for the place-detail screen. Callers may pass a narrower list
// via `fields` for list views to reduce billing.
const DEFAULT_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'userRatingCount',
  'priceLevel',
  'photos',
  'reviews',
  'regularOpeningHours',
  'nationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
];

// Whitelist — no caller can request arbitrary Google fields through this proxy.
const ALLOWED_FIELDS = new Set(DEFAULT_FIELDS);

const BodySchema = z.object({
  placeId: z.string().min(1),
  sessionToken: z.string().uuid().optional(),
  fields: z.array(z.string()).optional(),
});

interface GooglePlaceResponse {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
    authorAttributions?: Array<{ displayName: string; uri?: string; photoUri?: string }>;
  }>;
  reviews?: Array<{
    name: string;
    rating?: number;
    text?: { text?: string; languageCode?: string };
    authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
    publishTime?: string;
    relativePublishTimeDescription?: string;
  }>;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
}

function mapGooglePlacesError(status: number, body: string) {
  if (status === 404) {
    return { code: 'place_not_found', message: 'Google place was not found', status: 404 };
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
        'Google Maps server key cannot call Places from Edge Functions. Use a server key without browser referrer restrictions.',
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

  return { code: 'upstream_error', message: 'Google Places returned an error', status: 502 };
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'place-details' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'place-details', level: 'error', err: 'missing_server_key' });
    return errorResponse(
      'server_misconfigured',
      'Google Maps server key is not configured. See docs/google-maps-setup.md.',
      500,
      origin,
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(
      'invalid_input',
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid JSON',
      400,
      origin,
    );
  }

  const requestedFields = body.fields?.filter((f) => ALLOWED_FIELDS.has(f)) ?? DEFAULT_FIELDS;
  if (requestedFields.length === 0) {
    return errorResponse('invalid_input', 'No valid fields requested', 400, origin);
  }

  const fieldMask = requestedFields.join(',');
  const placeUrl = new URL(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(body.placeId)}`,
  );
  if (body.sessionToken) placeUrl.searchParams.set('sessionToken', body.sessionToken);

  const start = Date.now();
  try {
    const googleRes = await fetchWithTimeout(
      placeUrl.toString(),
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
      },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: 'place-details',
        level: 'error',
        status: googleRes.status,
        body: text.slice(0, 500),
        durationMs: Date.now() - start,
      });
      const mapped = mapGooglePlacesError(googleRes.status, text);
      return errorResponse(mapped.code, mapped.message, mapped.status, origin);
    }

    const raw = (await googleRes.json()) as GooglePlaceResponse;

    const place = {
      placeId: raw.id ?? body.placeId,
      displayName: raw.displayName?.text ?? '',
      formattedAddress: raw.formattedAddress ?? '',
      location: {
        latitude: raw.location?.latitude ?? 0,
        longitude: raw.location?.longitude ?? 0,
      },
      types: raw.types ?? [],
      rating: raw.rating ?? null,
      userRatingCount: raw.userRatingCount ?? null,
      priceLevel: raw.priceLevel ?? null,
      photos: (raw.photos ?? []).map((p) => ({
        name: p.name,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        attributions: p.authorAttributions ?? [],
      })),
      reviews: (raw.reviews ?? []).map((r) => ({
        name: r.name,
        rating: r.rating ?? 0,
        text: r.text?.text
          ? { text: r.text.text, languageCode: r.text.languageCode }
          : null,
        authorAttribution: {
          displayName: r.authorAttribution?.displayName ?? 'Google user',
          uri: r.authorAttribution?.uri,
          photoUri: r.authorAttribution?.photoUri,
        },
        publishTime: r.publishTime ?? '',
        relativePublishTimeDescription: r.relativePublishTimeDescription ?? '',
      })),
      regularOpeningHours: raw.regularOpeningHours
        ? {
            openNow: Boolean(raw.regularOpeningHours.openNow),
            weekdayDescriptions: raw.regularOpeningHours.weekdayDescriptions ?? [],
          }
        : null,
      nationalPhoneNumber: raw.nationalPhoneNumber ?? null,
      websiteUri: raw.websiteUri ?? null,
      googleMapsUri: raw.googleMapsUri ?? null,
    };

    log({
      requestId,
      fn: 'place-details',
      level: 'info',
      placeId: place.placeId,
      reviewCount: place.reviews.length,
      photoCount: place.photos.length,
      durationMs: Date.now() - start,
    });

    return jsonResponse({ place }, { origin });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'place-details',
      level: 'error',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return errorResponse(
      isAbort ? 'upstream_timeout' : 'upstream_error',
      'Google Places request failed',
      504,
      origin,
    );
  }
}

Deno.serve(handler);
