// places-autocomplete — proxies Google Places API (New) :autocomplete
// Deno / Supabase Edge Function
//
// Contract:
//   POST { input: string, sessionToken: string, locationBias?: { lat, lng, radiusMeters? } }
//   -> { suggestions: [{ placeId, mainText, secondaryText }] }
//
// The sessionToken MUST be forwarded to the subsequent place-details call
// by the client — otherwise Google bills both calls separately.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
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
});

const FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text',
  'suggestions.placePrediction.structuredFormat',
].join(',');

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

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'places-autocomplete', level: 'error', err: 'missing_server_key' });
    return errorResponse(
      'server_misconfigured',
      'Google Maps server key is not configured',
      500,
      origin,
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    return errorResponse(
      'invalid_input',
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid JSON',
      400,
      origin,
    );
  }

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
      return errorResponse('upstream_error', 'Google Places returned an error', 502, origin);
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
      .filter((x): x is NonNullable<typeof x> => x !== null);

    log({
      requestId,
      fn: 'places-autocomplete',
      level: 'info',
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
