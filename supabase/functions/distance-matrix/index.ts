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
//
// v2 Phase N5 (D2 RESOLVED): openrouteservice (ORS) free API is the
// switchable PRIMARY for non-transit modes; Google stays the hard default
// AND the automatic fallback on ANY ORS failure. Provider resolution
// (app_config row -> ROUTING_PROVIDER env -> 'google'), the circuit breaker,
// and `tryOrs` live in _shared/routing.ts. The response contract is
// byte-compatible regardless of provider. Transit ALWAYS uses Google (ORS
// has no transit profile). GOOGLE_MAPS_SERVER_KEY stays required even when
// ORS is primary — it backs the automatic failover.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import {
  ORS_BASE_URL,
  ORS_PROFILE,
  ORS_TIMEOUT_MS,
  OrsError,
  type OrsRoutableMode,
  resolveRoutingProvider,
  tryOrs,
} from '../_shared/routing.ts';

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

  // ---- v2 N5: routing-provider switch. Default is google — with no
  // app_config row and no ROUTING_PROVIDER secret set, this resolves to
  // 'google' and the function behaves exactly as it did pre-N5.
  const { provider, source: providerSource } = await resolveRoutingProvider();
  if (provider === 'ors') {
    const mode = body.mode;
    if (mode === 'transit') {
      // ORS has no transit profile — transit is ALWAYS served by Google.
      log({
        requestId,
        fn: 'distance-matrix',
        level: 'info',
        provider_fallback: 'google',
        reason: 'transit_unsupported_by_ors',
      });
    } else {
      const routable: OrsRoutableMode = mode;
      const ors = await tryOrs({
        requestId,
        fn: 'distance-matrix',
        call: (orsKey) => orsMatrix(body, routable, orsKey),
      });
      if (ors !== null) {
        log({
          requestId,
          fn: 'distance-matrix',
          level: 'info',
          provider: 'ors',
          provider_source: providerSource,
          origins: body.origins.length,
          destinations: body.destinations.length,
          legs: ors.legs.length,
          durationMs: Date.now() - start,
        });
        return jsonResponse(ors, { origin });
      }
      // tryOrs logged { provider_fallback: 'google', reason } and fed the
      // breaker — fall through to the Google path below.
    }
  }

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
      provider: 'google',
      provider_source: providerSource,
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

// ---- ORS matrix (v2 N5) ----------------------------------------------------

interface OrsMatrixResponse {
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

interface MatrixLeg {
  fromIndex: number;
  toIndex: number;
  durationSeconds: number;
  distanceMeters: number;
}

/**
 * POST https://api.openrouteservice.org/v2/matrix/{profile}
 *
 * CAREFUL: ORS coordinates are **[lng, lat]** (GeoJSON order) — the reverse
 * of our wire contract's { lat, lng }. Origins + destinations are sent as one
 * `locations` array and addressed via `sources` / `destinations` index lists.
 * The response carries float-second `durations` and float-meter `distances`
 * indexed [sourceIdx][destIdx]; `null` cells mean unreachable and are skipped
 * — exactly mirroring the Google path's non-ROUTE_EXISTS filter, so the
 * `{ legs }` shape is byte-compatible across providers.
 *
 * Throws OrsError on any HTTP/shape problem; `tryOrs` (the only caller's
 * wrapper) maps that to a logged Google fallback.
 */
async function orsMatrix(
  body: z.infer<typeof BodySchema>,
  mode: OrsRoutableMode,
  orsKey: string,
): Promise<{ legs: MatrixLeg[] }> {
  const locations = [...body.origins, ...body.destinations].map((p) => [p.lng, p.lat]);
  const sources = body.origins.map((_, i) => i);
  const destinations = body.destinations.map((_, i) => body.origins.length + i);

  const res = await fetchWithTimeout(
    `${ORS_BASE_URL}/v2/matrix/${ORS_PROFILE[mode]}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: orsKey,
      },
      body: JSON.stringify({
        locations,
        sources,
        destinations,
        metrics: ['duration', 'distance'],
      }),
    },
    ORS_TIMEOUT_MS,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OrsError(`ors_http_${res.status}`, text.slice(0, 300));
  }

  const payload = (await res.json()) as OrsMatrixResponse;
  const durations = payload.durations;
  const distances = payload.distances;
  if (!Array.isArray(durations) || !Array.isArray(distances)) {
    throw new OrsError('ors_bad_response', 'missing durations/distances');
  }

  const legs: MatrixLeg[] = [];
  for (let i = 0; i < body.origins.length; i++) {
    const dRow = durations[i];
    const mRow = distances[i];
    if (!Array.isArray(dRow) || !Array.isArray(mRow)) {
      throw new OrsError('ors_bad_response', `matrix row ${i} missing`);
    }
    for (let j = 0; j < body.destinations.length; j++) {
      const dur = dRow[j];
      if (typeof dur !== 'number') continue; // null = unreachable (parity with Google filter)
      const dist = mRow[j];
      legs.push({
        fromIndex: i,
        toIndex: j,
        durationSeconds: Math.round(dur),
        distanceMeters: Math.round(typeof dist === 'number' ? dist : 0),
      });
    }
  }

  return { legs };
}

Deno.serve(handler);
