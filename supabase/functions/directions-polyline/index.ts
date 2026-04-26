// directions-polyline — proxies Google Routes API computeRoutes
// Returns an encoded polyline + total duration/distance for an ordered
// sequence of waypoints. optimizeWaypointOrder is FALSE — the caller has
// already solved the order via the optimizer (or in manual mode, via the
// user's drag-and-drop layout).
//
// Contract:
//   POST {
//     origin: { lat, lng },
//     destination: { lat, lng },
//     intermediates?: [{ lat, lng }],
//     mode: 'driving' | 'walking' | 'transit' | 'bicycling'
//   }
//   -> { polyline: string | null, durationSeconds: number, distanceMeters: number }
//
// Phase 23: 'bicycling' joins the enum (Routes API exposes BICYCLE as a
// first-class travelMode). 'transit' returns polyline = null because the
// Routes API computeRoutes response shape for transit is multi-leg and
// vehicle-typed, and the MVP UI does not render transit polylines — it
// falls back to dashed straight-line segments + a "Open in Google Maps"
// deep link (UI step 23.9). Duration / distance for transit are still
// returned normally so the per-leg time label is realistic.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 10_000;
const MAX_INTERMEDIATES = 23; // Routes API supports 25 waypoints total

const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const BodySchema = z.object({
  origin: LatLng,
  destination: LatLng,
  intermediates: z.array(LatLng).max(MAX_INTERMEDIATES).optional(),
  // Phase 23 Step 23.1: 'bicycling' added in lockstep with the trips
  // CHECK in migration 0016 and the TransportMode union in src/api/types.ts.
  mode: z.enum(['driving', 'walking', 'transit', 'bicycling']),
});

// Routes API uses upper-case enum names. BICYCLE is the first-class
// travelMode for cycling routes. TWO_WHEELER is a separate (motorcycle)
// mode and intentionally not used.
const MODE_MAP: Record<z.infer<typeof BodySchema>['mode'], string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  transit: 'TRANSIT',
  bicycling: 'BICYCLE',
};

interface GoogleRoutesResponse {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }>;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'directions-polyline' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!apiKey) {
    log({ requestId, fn: 'directions-polyline', level: 'error', err: 'missing_server_key' });
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
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: latLngWaypoint(body.origin),
          destination: latLngWaypoint(body.destination),
          intermediates: (body.intermediates ?? []).map(latLngWaypoint),
          travelMode: MODE_MAP[body.mode],
          optimizeWaypointOrder: false,
          polylineEncoding: 'ENCODED_POLYLINE',
        }),
      },
      TIMEOUT_MS,
    );

    if (!googleRes.ok) {
      const text = await googleRes.text().catch(() => '');
      log({
        requestId,
        fn: 'directions-polyline',
        level: 'error',
        status: googleRes.status,
        body: text.slice(0, 500),
        durationMs: Date.now() - start,
      });
      return errorResponse('upstream_error', 'Routes API returned an error', 502, origin);
    }

    const payload = (await googleRes.json()) as GoogleRoutesResponse;
    const route = payload.routes?.[0];

    // Phase 23: transit + bicycling tolerance.
    //   - 'transit' MAY return without an encodedPolyline (multi-leg
    //     transit is not represented as a single line). We return
    //     polyline = null and let the UI fall back to dashed straight-
    //     line segments + a Google Maps deep link.
    //   - For other modes, a missing route is still an error — the
    //     caller asked for a polyline they could draw, and we have
    //     nothing to give them.
    if (!route) {
      if (body.mode === 'transit') {
        const fallback = {
          polyline: null,
          durationSeconds: 0,
          distanceMeters: 0,
        };
        log({
          requestId,
          fn: 'directions-polyline',
          level: 'info',
          mode: body.mode,
          fallback: 'transit_no_route',
          durationMs: Date.now() - start,
        });
        return jsonResponse(fallback, { origin });
      }
      return errorResponse('no_route', 'No route found', 404, origin);
    }

    const result: {
      polyline: string | null;
      durationSeconds: number;
      distanceMeters: number;
    } = {
      polyline:
        body.mode === 'transit'
          ? null
          : route.polyline?.encodedPolyline ?? null,
      durationSeconds: parseDuration(route.duration ?? '0s'),
      distanceMeters: route.distanceMeters ?? 0,
    };

    // Drivable / walkable / bikeable mode without a polyline string is a
    // genuine "no route" — surface it. Transit with polyline = null is
    // expected and already fell through above.
    if (body.mode !== 'transit' && result.polyline === null) {
      return errorResponse('no_route', 'No route found', 404, origin);
    }

    log({
      requestId,
      fn: 'directions-polyline',
      level: 'info',
      mode: body.mode,
      polyline: result.polyline === null ? 'null' : 'present',
      intermediates: body.intermediates?.length ?? 0,
      durationSeconds: result.durationSeconds,
      distanceMeters: result.distanceMeters,
      durationMs: Date.now() - start,
    });

    return jsonResponse(result, { origin });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'directions-polyline',
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

function latLngWaypoint(p: { lat: number; lng: number }) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

function parseDuration(s: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(s);
  return match ? Math.round(parseFloat(match[1]!)) : 0;
}

Deno.serve(handler);
