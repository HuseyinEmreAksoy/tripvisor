// distance-matrix — proxies Google Routes API computeRouteMatrix
// Returns pairwise travel time / distance for N origins × M destinations.
//
// Contract:
//   POST {
//     origins: [{ lat, lng }],
//     destinations: [{ lat, lng }],
//     mode: 'driving' | 'walking' | 'transit' | 'bicycling'
//   }
//   -> { legs: [{ fromIndex, toIndex, durationSeconds, distanceMeters }] }
//
// Phase 23 Step 23.1: 'bicycling' joins the enum in lockstep with the
// trips CHECK in migration 0016, the directions-polyline Edge Function,
// and the TransportMode union in src/api/types.ts. The Routes API
// computeRouteMatrix endpoint accepts BICYCLE as a first-class travelMode.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 10_000;

const MAX_ORIGINS = 25;
const MAX_DESTINATIONS = 25;

const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const BodySchema = z.object({
  origins: z.array(LatLng).min(1).max(MAX_ORIGINS),
  destinations: z.array(LatLng).min(1).max(MAX_DESTINATIONS),
  mode: z.enum(['driving', 'walking', 'transit', 'bicycling']),
});

const MODE_MAP: Record<z.infer<typeof BodySchema>['mode'], string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  transit: 'TRANSIT',
  bicycling: 'BICYCLE',
};

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'distance-matrix' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'distance-matrix', level: 'error', err: 'missing_server_key' });
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

  const start = Date.now();
  try {
    const googleRes = await fetchWithTimeout(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,distanceMeters,condition',
        },
        body: JSON.stringify({
          origins: body.origins.map((p) => ({
            waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
          })),
          destinations: body.destinations.map((p) => ({
            waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
          })),
          travelMode: MODE_MAP[body.mode],
        }),
      },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: 'distance-matrix',
        level: 'error',
        status: googleRes.status,
        body: text.slice(0, 500),
        durationMs: Date.now() - start,
      });
      return errorResponse('upstream_error', 'Routes API returned an error', 502, origin);
    }

    const payload = (await googleRes.json()) as GoogleMatrixElement[];

    const legs = payload
      .filter((el) => el.condition === 'ROUTE_EXISTS' && typeof el.duration === 'string')
      .map((el) => ({
        fromIndex: el.originIndex ?? 0,
        toIndex: el.destinationIndex ?? 0,
        durationSeconds: parseDuration(el.duration!),
        distanceMeters: el.distanceMeters ?? 0,
      }));

    log({
      requestId,
      fn: 'distance-matrix',
      level: 'info',
      origins: body.origins.length,
      destinations: body.destinations.length,
      legs: legs.length,
      durationMs: Date.now() - start,
    });

    return jsonResponse({ legs }, { origin });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'distance-matrix',
      level: 'error',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return errorResponse(
      isAbort ? 'upstream_timeout' : 'upstream_error',
      'Routes API request failed',
      504,
      origin,
    );
  }
}

/** Routes API returns duration strings like "123s" or "12.5s". */
function parseDuration(s: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(s);
  return match ? Math.round(parseFloat(match[1]!)) : 0;
}

Deno.serve(handler);
