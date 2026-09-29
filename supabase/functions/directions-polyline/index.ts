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
//     mode: 'driving' | 'walking' | 'transit' | 'bicycling',
//     perLeg?: boolean,                                  // M5 Y2.3
//   }
//   -> {
//        polyline: string | null,
//        durationSeconds: number,
//        distanceMeters: number,
//        transitSteps?: [{ polyline: string | null,
//                          travelMode: 'WALK' | 'TRANSIT',
//                          lineName: string | null,
//                          vehicleType: string | null }],
//        provider: 'ors' | 'google',                     // M5 Y2.3
//        legs?: [{ polyline: string | null,              // M5 Y2.3, perLeg only
//                  durationSeconds: number,
//                  distanceMeters: number }],
//        noRoute?: true,                                 // M5 Y2.3, transit fallback
//      }
//
// Phase 23: 'bicycling' joins the enum (Routes API exposes BICYCLE as a
// first-class travelMode). 'transit' returns polyline = null because the
// Routes API computeRoutes response shape for transit is multi-leg and
// vehicle-typed, and the MVP UI does not render transit polylines — it
// falls back to dashed straight-line segments + a "Open in Google Maps"
// deep link (UI step 23.9). Duration / distance for transit are still
// returned normally so the per-leg time label is realistic.
//
// v2 Phase P1.2 (ADDITIVE contract change): real multi-leg transit. When
// mode === 'transit' the Google FieldMask is extended to request
// routes.legs.steps (per-step polyline + travelMode + transit line
// metadata) and the response carries an OPTIONAL `transitSteps` array —
// one entry per step that has geometry, in route order. The top-level
// `polyline` stays null for transit, so clients that don't read
// transitSteps behave exactly as before P1 (dashed segments + deep link).
// Steps with no polyline are skipped; WALK/TRANSIT is collapsed from the
// step's travelMode (anything non-TRANSIT renders as a walking connector);
// lineName prefers transitLine.nameShort ("M2") over .name. ORS note:
// transit ALWAYS routes to Google (N5), so this lives only in the Google
// branch.
//
// v2 Phase N5 (D2 RESOLVED): openrouteservice (ORS) free API is the
// switchable PRIMARY for non-transit modes; Google stays the hard default
// AND the automatic fallback on ANY ORS failure. Provider resolution
// (app_config row -> ROUTING_PROVIDER env -> 'google'), the circuit breaker,
// and `tryOrs` live in _shared/routing.ts. ORS's JSON `routes[0].geometry`
// is a Google-algorithm encoded polyline (precision 1e5), so the response
// contract — and the client decoder — are unchanged. Transit ALWAYS uses
// Google (polyline-null behavior preserved). GOOGLE_MAPS_SERVER_KEY stays
// required even when ORS is primary — it backs the automatic failover.
//
// Auth + quota (security audit 2026-09-29 #2): requires a real signed-in
// user (`requireUser`; the public anon key -> 401 not_authenticated). Every
// call consumes DAILY_QUOTA.routing_elements per user per UTC day: 1 unit,
// or 2 when there are > 10 intermediates (Google prices that as the Pro SKU,
// about 2x) (-> 429 quota_exceeded). optimize-trip forwards the CALLER's
// Authorization header, so its per-day polylines are metered to that user.
//
// M5 Y2.3 (ADDITIVE contract change, per-leg transport modes):
//   request  `perLeg?: boolean` asks for a per-leg breakdown of a
//            multi-waypoint route (ignored for transit, which optimize-trip
//            routes one leg per call).
//   response `provider: 'ors' | 'google'` (always; optimize-trip records it
//            as trip_legs.source), `legs?: [{ polyline, durationSeconds,
//            distanceMeters }]` (only when perLeg was asked AND the provider
//            returned a consistent split: exactly waypoints - 1 entries,
//            otherwise omitted), and `noRoute: true` on the transit-no-route
//            200 fallback. Older callers ignore all three. Quota metering is
//            unchanged: the breakdown costs no extra units.
//   ORS: the route's `segments[i]` carry each leg's duration/distance and
//        `way_points` index the geometry, so the encoded geometry is split
//        exactly (decode -> slice -> re-encode, integer E5 math, lossless).
//   Google: the FieldMask adds routes.legs.{duration,distanceMeters,
//        polyline.encodedPolyline} only when perLeg is asked with
//        intermediates (the pre-Y2.3 mask is unchanged otherwise).

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import {
  consumeQuota,
  describeInvalidInput,
  quotaDeniedResponse,
  requireUser,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
import {
  ORS_BASE_URL,
  ORS_PROFILE,
  ORS_TIMEOUT_MS,
  OrsError,
  type OrsRoutableMode,
  resolveRoutingProvider,
  tryOrs,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from '../_shared/routing.ts';

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
  // M5 Y2.3: per-leg breakdown for multi-waypoint routes (see header).
  perLeg: z.boolean().optional(),
});

type Body = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  intermediates?: Array<{ lat: number; lng: number }>;
  mode: 'driving' | 'walking' | 'transit' | 'bicycling';
  perLeg?: boolean;
};

/** M5 Y2.3: one leg of a per-leg breakdown (waypoint i -> i + 1). */
export interface RouteLegWire {
  /** polyline5; null only when the provider sent no geometry for the leg. */
  polyline: string | null;
  durationSeconds: number;
  distanceMeters: number;
}

// Routes API uses upper-case enum names. BICYCLE is the first-class
// travelMode for cycling routes. TWO_WHEELER is a separate (motorcycle)
// mode and intentionally not used.
const MODE_MAP: Record<Body['mode'], string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  transit: 'TRANSIT',
  bicycling: 'BICYCLE',
};

// ---- v2 P1.2: per-mode field masks ------------------------------------------
// Field masks are mandatory (project rule #3) and per-caller minimal. The
// transit mask drops routes.polyline.encodedPolyline — the contract returns
// top-level polyline = null for transit, so requesting it would be waste —
// and instead asks for the per-step geometry + transit line metadata that
// feeds `transitSteps`. Non-transit modes keep the pre-P1 mask verbatim.
const BASE_FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
// M5 Y2.3: per-leg split, requested only with perLeg + intermediates.
const LEGS_FIELD_MASK = [
  'routes.legs.duration',
  'routes.legs.distanceMeters',
  'routes.legs.polyline.encodedPolyline',
].join(',');
const TRANSIT_FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
].join(',');

interface GoogleRouteStep {
  polyline?: { encodedPolyline?: string };
  travelMode?: string;
  transitDetails?: {
    transitLine?: {
      nameShort?: string;
      name?: string;
      vehicle?: { type?: string };
    };
  };
}

interface GoogleRoute {
  duration?: string;
  distanceMeters?: number;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{
    steps?: GoogleRouteStep[];
    // M5 Y2.3: present only with LEGS_FIELD_MASK.
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }>;
}

interface GoogleRoutesResponse {
  routes?: GoogleRoute[];
}

/**
 * v2 P1.2: wire shape of one rendered transit step. Mirrors `TransitStep`
 * in src/api/types.ts and the jsonb stored in trip_legs.transit_steps —
 * keep all three in lockstep.
 *
 * `polyline` is typed nullable for forward-compat, but the current
 * implementation never emits null — steps without geometry are skipped
 * (there is nothing to draw for them).
 */
interface TransitStep {
  polyline: string | null;
  travelMode: 'WALK' | 'TRANSIT';
  lineName: string | null;
  vehicleType: string | null;
}

/**
 * Flatten routes.legs[].steps[] into the transitSteps wire array, in route
 * order. Rules (P1.2):
 *   - steps with no encodedPolyline are skipped — no geometry, nothing to
 *     render (Google occasionally emits zero-length connector steps);
 *   - travelMode collapses to the 'WALK' | 'TRANSIT' binary: only TRANSIT
 *     steps carry line metadata, everything else is a walking connector;
 *   - lineName prefers transitLine.nameShort ("M2") over .name
 *     ("Metro Linea 2"), null when neither is present (WALK steps);
 *   - vehicleType is Google's vehicle.type enum string (SUBWAY, BUS,
 *     TRAM, HEAVY_RAIL, ...) passed through verbatim, null for WALK steps.
 */
function extractTransitSteps(route: GoogleRoute): TransitStep[] {
  const steps: TransitStep[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const polyline = step.polyline?.encodedPolyline;
      if (!polyline) continue;
      const line = step.transitDetails?.transitLine;
      steps.push({
        polyline,
        travelMode: step.travelMode === 'TRANSIT' ? 'TRANSIT' : 'WALK',
        lineName: line?.nameShort ?? line?.name ?? null,
        vehicleType: line?.vehicle?.type ?? null,
      });
    }
  }
  return steps;
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

  const auth = await requireUser(req, { fn: 'directions-polyline', requestId, origin });
  if (!auth.ok) return auth.response;

  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
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

  let body: Body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse('invalid_input', describeInvalidInput(err), 400, origin);
  }

  // Metered BEFORE any upstream call (ORS or Google); a rejected request
  // consumes nothing.
  const quota = await consumeQuota({
    userId: auth.user.id,
    kind: 'routing_elements',
    units: routeQuotaUnits(body.intermediates?.length ?? 0),
    requestId,
    fn: 'directions-polyline',
  });
  if (quota !== 'ok') return quotaDeniedResponse(quota, 'routing_elements', origin);

  const start = Date.now();

  // ---- v2 N5: routing-provider switch. Default is google — with no
  // app_config row and no ROUTING_PROVIDER secret set, this resolves to
  // 'google' and the function behaves exactly as it did pre-N5.
  const { provider, source: providerSource } = await resolveRoutingProvider();
  if (provider === 'ors') {
    const mode = body.mode;
    if (mode === 'transit') {
      // ORS has no transit profile — transit is ALWAYS served by Google,
      // preserving the polyline-null + dashed-segment fallback behavior.
      log({
        requestId,
        fn: 'directions-polyline',
        level: 'info',
        provider_fallback: 'google',
        reason: 'transit_unsupported_by_ors',
      });
    } else {
      const routable: OrsRoutableMode = mode;
      const ors = await tryOrs({
        requestId,
        fn: 'directions-polyline',
        call: (orsKey: string) => orsRoute(body, routable, orsKey),
      });
      if (ors !== null) {
        log({
          requestId,
          fn: 'directions-polyline',
          level: 'info',
          provider: 'ors',
          provider_source: providerSource,
          userId: auth.user.id,
          mode: body.mode,
          polyline: 'present',
          intermediates: body.intermediates?.length ?? 0,
          perLeg: body.perLeg === true ? (ors.legs ? 'split' : 'unavailable') : 'no',
          durationSeconds: ors.durationSeconds,
          distanceMeters: ors.distanceMeters,
          durationMs: Date.now() - start,
        });
        return jsonResponse({ ...ors, provider: 'ors' as const }, { origin });
      }
      // tryOrs logged { provider_fallback: 'google', reason } and fed the
      // breaker — fall through to the Google path below. If the leg is
      // genuinely unroutable, Google's own no_route 404 preserves today's
      // client-visible behavior exactly.
    }
  }

  // M5 Y2.3: waypoints this request spans; a per-leg split has count - 1 legs.
  const waypointCount = 2 + (body.intermediates?.length ?? 0);
  // Transit never gets a split: optimize-trip routes transit one leg per call.
  const wantLegs = body.perLeg === true && body.mode !== 'transit';

  try {
    const googleRes = await fetchWithTimeout(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            body.mode === 'transit'
              ? TRANSIT_FIELD_MASK
              : wantLegs && waypointCount > 2
                ? `${BASE_FIELD_MASK},${LEGS_FIELD_MASK}`
                : BASE_FIELD_MASK,
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
        // M5 Y2.3: `noRoute` + `provider` are additive; the zeros stay for
        // pre-Y2.3 callers. optimize-trip turns this into an estimate leg.
        const fallback = {
          polyline: null,
          durationSeconds: 0,
          distanceMeters: 0,
          noRoute: true as const,
          provider: 'google' as const,
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

    // v2 P1.2: per-step transit geometry. Only computed for transit (the
    // field mask only requests legs.steps for transit). The field is
    // OMITTED (not []) when there is nothing to render so optimize-trip's
    // `poly.transitSteps ?? null` persists NULL instead of an empty array,
    // and pre-P1 clients see a byte-identical response.
    const transitSteps = body.mode === 'transit' ? extractTransitSteps(route) : [];

    const result: {
      polyline: string | null;
      durationSeconds: number;
      distanceMeters: number;
      transitSteps?: TransitStep[];
      provider: 'google';
      legs?: RouteLegWire[];
    } = {
      polyline:
        body.mode === 'transit'
          ? null
          : route.polyline?.encodedPolyline ?? null,
      durationSeconds: parseDuration(route.duration ?? '0s'),
      distanceMeters: route.distanceMeters ?? 0,
      ...(transitSteps.length > 0 ? { transitSteps } : {}),
      provider: 'google',
    };

    // Drivable / walkable / bikeable mode without a polyline string is a
    // genuine "no route" — surface it. Transit with polyline = null is
    // expected and already fell through above.
    if (body.mode !== 'transit' && result.polyline === null) {
      return errorResponse('no_route', 'No route found', 404, origin);
    }

    // M5 Y2.3: per-leg split. Two waypoints = one leg = the route itself.
    if (wantLegs) {
      const legs =
        waypointCount === 2
          ? [
              {
                polyline: result.polyline,
                durationSeconds: result.durationSeconds,
                distanceMeters: result.distanceMeters,
              },
            ]
          : extractGoogleLegs(route, waypointCount - 1);
      if (legs) result.legs = legs;
    }

    log({
      requestId,
      fn: 'directions-polyline',
      level: 'info',
      provider: 'google',
      provider_source: providerSource,
      userId: auth.user.id,
      mode: body.mode,
      polyline: result.polyline === null ? 'null' : 'present',
      transitSteps: transitSteps.length,
      intermediates: body.intermediates?.length ?? 0,
      perLeg: wantLegs ? (result.legs ? 'split' : 'unavailable') : 'no',
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

/**
 * Quota units for one computeRoutes request. Google bills a route with
 * more than 10 intermediates at the Pro SKU, about 2x Essentials, so it
 * counts double. Exported for tests.
 */
export function routeQuotaUnits(intermediates: number): number {
  return intermediates > 10 ? 2 : 1;
}

function latLngWaypoint(p: { lat: number; lng: number }) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

function parseDuration(s: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(s);
  return match ? Math.round(parseFloat(match[1]!)) : 0;
}

/**
 * M5 Y2.3: routes[0].legs -> RouteLegWire[] (one per waypoint pair), or
 * undefined when the split is not exactly `expected` legs long. Google omits
 * zero values in its JSON (proto3), so a missing duration/distance reads as
 * 0 and a missing leg polyline as null (a zero-length leg has nothing to
 * draw).
 */
function extractGoogleLegs(route: GoogleRoute, expected: number): RouteLegWire[] | undefined {
  const legs = route.legs;
  if (!Array.isArray(legs) || legs.length !== expected) return undefined;
  return legs.map((leg) => ({
    polyline: leg.polyline?.encodedPolyline ?? null,
    durationSeconds: parseDuration(leg.duration ?? '0s'),
    distanceMeters: typeof leg.distanceMeters === 'number' ? Math.round(leg.distanceMeters) : 0,
  }));
}

// ---- polyline5 codec (M5 Y2.3) ----------------------------------------------
// Google's encoded polyline algorithm at precision 1e5 (what both providers
// return). Decoding keeps INTEGER E5 coordinates and encoding consumes them,
// so a decode -> slice -> encode round trip reproduces the provider's exact
// characters; no float rounding can creep in.

/** Decode a polyline5 string into integer [latE5, lngE5] pairs. Throws on bad input. */
export function decodePolylineE5(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('truncated polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('invalid polyline character');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat, lng]);
  }
  return points;
}

function encodeSignedE5(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Encode integer [latE5, lngE5] pairs as polyline5. */
export function encodePolylineE5(points: ReadonlyArray<readonly [number, number]>): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    out += encodeSignedE5(lat - prevLat) + encodeSignedE5(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// ---- ORS directions (v2 N5) --------------------------------------------------

interface OrsRoute {
  summary?: { duration?: number; distance?: number };
  geometry?: string;
  // M5 Y2.3: one per waypoint pair (returned with the default instructions=true).
  segments?: Array<{ duration?: number; distance?: number }>;
  // M5 Y2.3: index of each waypoint in the decoded geometry.
  way_points?: number[];
}

interface OrsDirectionsResponse {
  routes?: OrsRoute[];
}

/**
 * M5 Y2.3: split an ORS route into one RouteLegWire per waypoint pair, using
 * `segments[i]` for the numbers and `way_points` to slice the geometry.
 * Undefined when anything is inconsistent (the caller then omits `legs` and
 * optimize-trip routes those legs one call each). Exported for tests.
 */
export function splitOrsRoute(route: OrsRoute, waypointCount: number): RouteLegWire[] | undefined {
  const segments = route.segments;
  const wayPoints = route.way_points;
  if (typeof route.geometry !== 'string') return undefined;
  if (!Array.isArray(segments) || segments.length !== waypointCount - 1) return undefined;
  if (!Array.isArray(wayPoints) || wayPoints.length !== waypointCount) return undefined;
  let coords: Array<[number, number]>;
  try {
    coords = decodePolylineE5(route.geometry);
  } catch {
    return undefined;
  }
  const legs: RouteLegWire[] = [];
  for (let i = 0; i < segments.length; i++) {
    const a = wayPoints[i];
    const b = wayPoints[i + 1];
    if (
      typeof a !== 'number' || typeof b !== 'number' ||
      !Number.isInteger(a) || !Number.isInteger(b) ||
      a < 0 || b < a || b >= coords.length
    ) {
      return undefined;
    }
    const slice = coords.slice(a, b + 1);
    const seg = segments[i]!;
    legs.push({
      // A zero-length leg (two stops on the same spot) is one point; repeat
      // it so the leg still decodes to a (degenerate) line.
      polyline: encodePolylineE5(slice.length === 1 ? [slice[0]!, slice[0]!] : slice),
      durationSeconds: Math.round(typeof seg.duration === 'number' ? seg.duration : 0),
      distanceMeters: Math.round(typeof seg.distance === 'number' ? seg.distance : 0),
    });
  }
  return legs;
}

/**
 * POST https://api.openrouteservice.org/v2/directions/{profile}
 *
 * CAREFUL: ORS coordinates are **[lng, lat]** (GeoJSON order) — the reverse
 * of our wire contract's { lat, lng }. Waypoints are routed strictly in the
 * given order (origin, intermediates..., destination) — ORS never reorders,
 * which matches the Google path's optimizeWaypointOrder: false.
 *
 * The default JSON response returns `routes[0].geometry` as a
 * Google-algorithm encoded polyline, precision 1e5, 2D (we never send
 * `elevation: true`, which would switch it to a 3D encoding) — exactly what
 * the client's decodePolyline (src/components/Map/polyline.ts) already
 * expects, byte-compatible with Google's routes.polyline.encodedPolyline.
 * `summary.duration` is float seconds, `summary.distance` float meters.
 * M5 Y2.3: `instructions` stays at its default (true) on purpose: that is
 * what makes ORS return `segments`, the per-leg numbers `perLeg` needs.
 *
 * Throws OrsError on any HTTP/shape problem (including "no route found",
 * which ORS reports as a 404); `tryOrs` (the only caller's wrapper) maps
 * that to a logged Google fallback.
 */
async function orsRoute(
  body: Body,
  mode: OrsRoutableMode,
  orsKey: string,
): Promise<{ polyline: string; durationSeconds: number; distanceMeters: number; legs?: RouteLegWire[] }> {
  const waypoints = [body.origin, ...(body.intermediates ?? []), body.destination];
  const coordinates = waypoints.map((p) => [p.lng, p.lat]);

  const res = await fetchWithTimeout(
    `${ORS_BASE_URL}/v2/directions/${ORS_PROFILE[mode]}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: orsKey,
      },
      body: JSON.stringify({ coordinates }),
    },
    ORS_TIMEOUT_MS,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OrsError(`ors_http_${res.status}`, text.slice(0, 300));
  }

  const payload = (await res.json()) as OrsDirectionsResponse;
  const route = payload.routes?.[0];
  if (!route || typeof route.geometry !== 'string' || route.geometry.length === 0) {
    throw new OrsError('ors_bad_response', 'missing routes[0].geometry');
  }

  const out: {
    polyline: string;
    durationSeconds: number;
    distanceMeters: number;
    legs?: RouteLegWire[];
  } = {
    polyline: route.geometry,
    durationSeconds: Math.round(route.summary?.duration ?? 0),
    distanceMeters: Math.round(route.summary?.distance ?? 0),
  };
  if (body.perLeg === true) {
    const legs =
      waypoints.length === 2
        ? [{ polyline: out.polyline, durationSeconds: out.durationSeconds, distanceMeters: out.distanceMeters }]
        : splitOrsRoute(route, waypoints.length);
    if (legs) out.legs = legs;
  }
  return out;
}

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
