// places-autocomplete — proxies Google Places API (New) :autocomplete
// Deno / Supabase Edge Function
//
// Contract:
//   POST { input: string, sessionToken: string, locationBias?: { lat, lng, radiusMeters? },
//          lang?: 'en' | 'tr' }
//   -> { suggestions: [{ placeId, mainText, secondaryText }] }
//
// `lang` (M5 Y2.5, optional, default 'en'): the app language, sent to
// Google as `languageCode` so suggestion texts come back in it. Any other
// value is a 400 invalid_input.
//
// The sessionToken MUST be forwarded to the subsequent place-details call
// by the client — otherwise Google bills both calls separately.
//
// Auth + quota (security audit 2026-09-29 #2): the gateway's verify_jwt
// accepts the PUBLIC anon key, so the function itself requires a real user
// (`requireUser` -> GoTrue getUser; anon/service keys -> 401
// not_authenticated) and meters DAILY_QUOTA.places_autocomplete per user per
// UTC day (-> 429 quota_exceeded). `?ping` stays public for health checks.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import {
  consumeQuota,
  describeInvalidInput,
  quotaDeniedResponse,
  requireUser,
} from '../_shared/auth.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 3000;

const BodySchema = z.object({
  input: z.string().min(1).max(200),
  sessionToken: z.string().uuid(),
  locationBias: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusMeters: z.number().positive().max(50_000).optional(),
    })
    .optional(),
  lang: z.enum(['en', 'tr']).optional(),
});

const FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text',
  'suggestions.placePrediction.structuredFormat',
].join(',');

const MAX_SUGGESTIONS = 3;

interface GoogleSuggestion {
  placePrediction?: {
    placeId: string;
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    text?: { text?: string };
  };
}

function mapGooglePlacesError(status: number, body: string) {
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
    };
  }

  if (status === 403) {
    return {
      code: 'google_places_forbidden',
      message:
        'Google Places rejected the server key. Check API restrictions, billing, and project access.',
    };
  }

  return { code: 'upstream_error', message: 'Google Places returned an error' };
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'places-autocomplete' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  const auth = await requireUser(req, { fn: 'places-autocomplete', requestId, origin });
  if (!auth.ok) return auth.response;

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'places-autocomplete', level: 'error', err: 'missing_server_key' });
    return errorResponse(
      'server_misconfigured',
      'Google Maps server key is not configured. See docs/google-maps-setup.md.',
      500,
      origin,
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    return errorResponse('invalid_input', describeInvalidInput(err), 400, origin);
  }

  // Metered BEFORE the Google call; a rejected request consumes nothing.
  const quota = await consumeQuota({
    userId: auth.user.id,
    kind: 'places_autocomplete',
    units: 1,
    requestId,
    fn: 'places-autocomplete',
  });
  if (quota !== 'ok') return quotaDeniedResponse(quota, 'places_autocomplete', origin);

  const start = Date.now();
  try {
    const googleRes = await fetchWithTimeout(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          input: body.input,
          sessionToken: body.sessionToken,
          languageCode: body.lang ?? 'en',
          ...(body.locationBias
            ? {
                locationBias: {
                  circle: {
                    center: {
                      latitude: body.locationBias.lat,
                      longitude: body.locationBias.lng,
                    },
                    radius: body.locationBias.radiusMeters ?? 50_000,
                  },
                },
              }
            : {}),
        }),
      },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: 'places-autocomplete',
        level: 'error',
        status: googleRes.status,
        body: text.slice(0, 500),
        durationMs: Date.now() - start,
      });
      const mapped = mapGooglePlacesError(googleRes.status, text);
      return errorResponse(mapped.code, mapped.message, 502, origin);
    }

    const payload = (await googleRes.json()) as { suggestions?: GoogleSuggestion[] };

    const suggestions = (payload.suggestions ?? [])
      .map((s) => {
        const p = s.placePrediction;
        if (!p?.placeId) return null;
        return {
          placeId: p.placeId,
          mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
          secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, MAX_SUGGESTIONS);

    log({
      requestId,
      fn: 'places-autocomplete',
      level: 'info',
      userId: auth.user.id,
      count: suggestions.length,
      durationMs: Date.now() - start,
    });

    return jsonResponse({ suggestions }, { origin });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'places-autocomplete',
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
