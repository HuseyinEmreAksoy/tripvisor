// optimize-trip/legs.ts: per-leg transport modes (M5 Y2.3). Pure: no I/O, no
// Deno globals, no imports. index.ts does the network calls; everything that
// decides WHAT to call, and what a leg is when nothing can be called, lives
// here so legs.test.ts can pin it down.
//
// Vocabulary
// ----------
//   chain   the places of one day, in visit order (after optimize or rank sort).
//   leg     chain[i-1] -> chain[i]. Its mode is decided by the ARRIVING place:
//             effective mode = to.arrival_mode ?? trip_days.transport_mode
//                              ?? trips.transport_mode
//           (migration 0035). The first place of a day has no inbound leg, so
//           its arrival_mode never produces a leg.
//   source  who produced a leg's numbers (trip_legs.source, 0035):
//             'ors' | 'google'  a routing API answered,
//             'estimate'        distance-based fallback (the UI shows "≈"),
//             'user'            trip_places.arrival_minutes (user-given).
//
// Routing policy (index.ts executes it; segmentDayLegs encodes it):
//   driving / walking / bicycling  consecutive legs with the same mode form ONE
//       directions-polyline call (ORS primary, Google fallback, per the
//       existing routing_provider switch) with a per-leg breakdown. A failed
//       call -> estimates for those legs.
//   transit    one Google call per leg (Routes API transit takes no
//       intermediates), only while the caller's routing quota lasts and the
//       app_config 'transit_routing' kill switch allows it -> else estimate.
//   flight / ferry   never routed: arrival_minutes ('user') or an estimate.
//   arrival_minutes set (any mode)  the user's duration wins: no routing call.
//
// Estimate model (LEG_ESTIMATE_MODEL): great-circle distance x detour factor
// at a typical speed, plus a fixed overhead:
//   ground modes  x1.3 detour; driving 40 km/h, walking 4.8, bicycling 15,
//                 transit 25 km/h + 5 min for waits/transfers
//   flight        great circle at 800 km/h + 2 h airport overhead
//   ferry         great circle at 25 km/h
// Distances under 1 m (two stops at the same spot) estimate to 0 s / 0 m.

// ============================================================================
// Modes
// ============================================================================

/** trips.transport_mode / trip_days.transport_mode (0016 / 0035 CHECKs). */
export type TripMode = 'driving' | 'walking' | 'transit' | 'bicycling';

/** trip_places.arrival_mode (0035 CHECK): the 4 routable modes + flight/ferry. */
export type LegMode = TripMode | 'flight' | 'ferry';

/** trip_legs.source (0035 CHECK). */
export type LegSource = 'ors' | 'google' | 'estimate' | 'user';

/** Modes a directions-polyline "run" can batch (ORS has a profile for each). */
export type RunMode = 'driving' | 'walking' | 'bicycling';

const TRIP_MODES: ReadonlySet<string> = new Set(['driving', 'walking', 'transit', 'bicycling']);
const LEG_MODES: ReadonlySet<string> = new Set([...TRIP_MODES, 'flight', 'ferry']);

export function isTripMode(value: unknown): value is TripMode {
  return typeof value === 'string' && TRIP_MODES.has(value);
}

export function isLegMode(value: unknown): value is LegMode {
  return typeof value === 'string' && LEG_MODES.has(value);
}

/**
 * Modes no routing API computes. A day containing a place that ARRIVES by one
 * of these keeps the user's manual_rank order in 'optimized' mode: the
 * optimizer can't reason about a flight, so it must not reshuffle that day.
 */
export const KEPT_ORDER_MODES: ReadonlySet<LegMode> = new Set<LegMode>(['flight', 'ferry']);

/** The day's default leg mode: trip_days.transport_mode ?? trips.transport_mode. */
export function dayDefaultMode(dayMode: unknown, tripMode: TripMode): TripMode {
  return isTripMode(dayMode) ? dayMode : tripMode;
}

/**
 * Effective mode of the leg ARRIVING at a place (0035):
 *   arrival_mode ?? trip_days.transport_mode ?? trips.transport_mode.
 * Values outside the CHECK lists are treated as absent (fail-safe inherit).
 */
export function effectiveLegMode(arrivalMode: unknown, dayMode: unknown, tripMode: TripMode): LegMode {
  return isLegMode(arrivalMode) ? arrivalMode : dayDefaultMode(dayMode, tripMode);
}

/**
 * The user's duration for the arriving leg, or null. 0035 contract:
 * arrival_minutes counts ONLY while arrival_mode is set (the DB deliberately
 * does not couple the two columns), and must sit in the CHECK range 1-1440.
 */
export function userLegMinutes(arrivalMode: unknown, arrivalMinutes: unknown): number | null {
  if (!isLegMode(arrivalMode)) return null;
  if (typeof arrivalMinutes !== 'number' || !Number.isInteger(arrivalMinutes)) return null;
  if (arrivalMinutes < 1 || arrivalMinutes > 1440) return null;
  return arrivalMinutes;
}

// ============================================================================
// Distance + estimates
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

/** Haversine great-circle distance in meters (mean Earth radius). */
export function greatCircleMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface EstimateModel {
  /** Network distance / great-circle distance. */
  detourFactor: number;
  speedKmh: number;
  /** Fixed time on top of the moving time (airport, waits, transfers). */
  overheadMinutes: number;
}

export const LEG_ESTIMATE_MODEL: Readonly<Record<LegMode, EstimateModel>> = {
  driving: { detourFactor: 1.3, speedKmh: 40, overheadMinutes: 0 },
  walking: { detourFactor: 1.3, speedKmh: 4.8, overheadMinutes: 0 },
  bicycling: { detourFactor: 1.3, speedKmh: 15, overheadMinutes: 0 },
  transit: { detourFactor: 1.3, speedKmh: 25, overheadMinutes: 5 },
  flight: { detourFactor: 1, speedKmh: 800, overheadMinutes: 120 },
  ferry: { detourFactor: 1, speedKmh: 25, overheadMinutes: 0 },
};

/** Below this the two stops are the same spot: no travel at all. */
const SAME_SPOT_METERS = 1;

/** Estimated travel distance (integer meters) for a mode. */
export function estimatedDistanceMeters(mode: LegMode, a: LatLng, b: LatLng): number {
  const gc = greatCircleMeters(a, b);
  if (gc < SAME_SPOT_METERS) return 0;
  return Math.round(gc * LEG_ESTIMATE_MODEL[mode].detourFactor);
}

/** Estimated leg (integer seconds / meters, the trip_legs column types). */
export function estimateLeg(
  mode: LegMode,
  a: LatLng,
  b: LatLng,
): { durationSeconds: number; distanceMeters: number } {
  const distanceMeters = estimatedDistanceMeters(mode, a, b);
  if (distanceMeters === 0) return { durationSeconds: 0, distanceMeters: 0 };
  const model = LEG_ESTIMATE_MODEL[mode];
  const metersPerSecond = model.speedKmh / 3.6;
  const durationSeconds = Math.round(distanceMeters / metersPerSecond + model.overheadMinutes * 60);
  return { durationSeconds, distanceMeters };
}

// ============================================================================
// Leg planning
// ============================================================================

export interface LegPlace extends LatLng {
  id: string;
  /** trip_places.arrival_mode; absent on pre-0035 rows / narrow mocks. */
  arrival_mode?: string | null;
  arrival_minutes?: number | null;
}

export interface PlannedLeg<P extends LegPlace = LegPlace> {
  from: P;
  to: P;
  mode: LegMode;
  /** Non-null when the user gave this leg's duration (source 'user'). */
  userMinutes: number | null;
}

/** One leg per consecutive pair of the day's chain, with its effective mode. */
export function planDayLegs<P extends LegPlace>(
  chain: readonly P[],
  dayMode: unknown,
  tripMode: TripMode,
): PlannedLeg<P>[] {
  const legs: PlannedLeg<P>[] = [];
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1]!;
    const to = chain[i]!;
    legs.push({
      from,
      to,
      mode: effectiveLegMode(to.arrival_mode, dayMode, tripMode),
      userMinutes: userLegMinutes(to.arrival_mode, to.arrival_minutes),
    });
  }
  return legs;
}

/**
 * directions-polyline accepts 23 intermediates (25 waypoints), so one call
 * covers at most 24 legs. A day holds at most 25 places (MAX_PLACES), so a
 * run never actually splits; the cap is a guard, not a code path.
 */
export const MAX_LEGS_PER_RUN = 24;

/**
 * Google's computeRouteMatrix accepts at most 100 elements for TRANSIT (625
 * otherwise). A bigger transit matrix is refused upstream AFTER the caller's
 * quota was consumed, so index.ts estimates instead of sending it.
 */
export const GOOGLE_TRANSIT_MATRIX_MAX_ELEMENTS = 100;

export type LegSegment<P extends LegPlace = LegPlace> =
  /** arrival_minutes given: the user's duration, no routing call. */
  | { kind: 'user'; leg: PlannedLeg<P> }
  /** flight / ferry without minutes: never routed, always an estimate. */
  | { kind: 'estimate'; leg: PlannedLeg<P> }
  /** One Google Routes transit call (quota + kill switch permitting). */
  | { kind: 'transit'; leg: PlannedLeg<P> }
  /** Consecutive same-mode ground legs: ONE directions-polyline call. */
  | { kind: 'run'; mode: RunMode; legs: PlannedLeg<P>[] };

/** Group a day's planned legs into the calls (or non-calls) that resolve them. */
export function segmentDayLegs<P extends LegPlace>(legs: readonly PlannedLeg<P>[]): LegSegment<P>[] {
  const out: LegSegment<P>[] = [];
  let run: { kind: 'run'; mode: RunMode; legs: PlannedLeg<P>[] } | null = null;
  for (const leg of legs) {
    if (leg.userMinutes !== null) {
      run = null;
      out.push({ kind: 'user', leg });
      continue;
    }
    if (leg.mode === 'flight' || leg.mode === 'ferry') {
      run = null;
      out.push({ kind: 'estimate', leg });
      continue;
    }
    if (leg.mode === 'transit') {
      run = null;
      out.push({ kind: 'transit', leg });
      continue;
    }
    const mode: RunMode = leg.mode;
    if (run && run.mode === mode && run.legs.length < MAX_LEGS_PER_RUN) {
      run.legs.push(leg);
    } else {
      run = { kind: 'run', mode, legs: [leg] };
      out.push(run);
    }
  }
  return out;
}

// ============================================================================
// Kept-order days (flight / ferry)
// ============================================================================

/**
 * Day indexes that hold a place ARRIVING by flight or ferry, ascending. In
 * 'optimized' mode those days keep the user's manual_rank order (and their
 * places stay on that day); only their legs are recomputed. The whole day is
 * protected, even when the flight place currently sorts first, because the
 * optimizer would otherwise move it into the middle of the day.
 */
export function keptOrderDayIndexes(
  places: ReadonlyArray<{ day_index: number | null; arrival_mode?: unknown }>,
): number[] {
  const days = new Set<number>();
  for (const p of places) {
    if (p.day_index === null || typeof p.day_index !== 'number') continue;
    if (isLegMode(p.arrival_mode) && KEPT_ORDER_MODES.has(p.arrival_mode)) days.add(p.day_index);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * The first `count` day indexes (from 0 up) that are NOT kept. The optimizer
 * numbers its days 0..k-1; this maps them around the kept days. With no kept
 * days it is the identity, so trips without flight/ferry behave as before.
 */
export function freeDayIndexes(count: number, kept: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < count; i++) {
    if (!kept.has(i)) out.push(i);
  }
  return out;
}

// ============================================================================
// Rank order (moved verbatim from the manual branch, v2 S2.8.2)
// ============================================================================

export interface RankedPlace {
  order_in_day: number | null;
  manual_rank: string | null;
}

/**
 * Sort a day's chain IN PLACE into the user's order (v2 S2.8.2, C1 loop
 * closure). Per-day fallback rule (deterministic):
 *   - every row has manual_rank = NULL -> legacy order_in_day order (NULLs
 *     last). Byte-identical to the pre-rank behavior.
 *   - at least one rank -> ranked rows FIRST by plain string compare of
 *     manual_rank (base-62 fractional index: JS '<' and Postgres text agree,
 *     src/sync/rank.ts), then NULL-rank rows in their legacy order.
 * Rank ties keep the legacy base order (Array.prototype.sort is stable).
 */
export function orderChainByRank<T extends RankedPlace>(list: T[]): void {
  // Legacy base order: order_in_day asc, NULLs last (defensive).
  list.sort((a, b) => {
    const ao = a.order_in_day ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order_in_day ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  // `typeof === 'string'` (not `!== null`) so a row WITHOUT the key
  // (undefined) counts as unranked instead of poisoning the rank sort.
  const ranked = list.filter((p): p is T & { manual_rank: string } => typeof p.manual_rank === 'string');
  if (ranked.length === 0) return; // all-NULL day: legacy order stands
  const unranked = list.filter((p) => typeof p.manual_rank !== 'string');
  ranked.sort((a, b) => (a.manual_rank < b.manual_rank ? -1 : a.manual_rank > b.manual_rank ? 1 : 0));
  list.splice(0, list.length, ...ranked, ...unranked);
}

/** True when at least one row of the day carries a manual_rank. */
export function chainHasRank(list: ReadonlyArray<RankedPlace>): boolean {
  return list.some((p) => typeof p.manual_rank === 'string');
}

// ============================================================================
// Leg results
// ============================================================================

export interface LegResult {
  fromId: string;
  toId: string;
  mode: LegMode;
  durationSeconds: number;
  distanceMeters: number;
  /** polyline5; null for transit (steps carry geometry) and for estimate/user legs. */
  polyline: string | null;
  /** directions-polyline transitSteps, stored verbatim (0023); null otherwise. */
  transitSteps: unknown[] | null;
  source: LegSource;
  /**
   * Set only on a leg REUSED from an earlier run (sweep fix): the original
   * trip_legs.computed_at, kept on re-insert so the Google 30-day ToS clock
   * never restarts. Absent = computed now.
   */
  computedAt?: string;
}

export function estimatedLegResult(leg: PlannedLeg): LegResult {
  const est = estimateLeg(leg.mode, leg.from, leg.to);
  return {
    fromId: leg.from.id,
    toId: leg.to.id,
    mode: leg.mode,
    durationSeconds: est.durationSeconds,
    distanceMeters: est.distanceMeters,
    polyline: null,
    transitSteps: null,
    source: 'estimate',
  };
}

/** Caller guarantees leg.userMinutes !== null (segmentDayLegs 'user'). */
export function userLegResult(leg: PlannedLeg): LegResult {
  return {
    fromId: leg.from.id,
    toId: leg.to.id,
    mode: leg.mode,
    durationSeconds: (leg.userMinutes ?? 0) * 60,
    // The user gave a time, not a distance: great circle for flight/ferry,
    // the detour-adjusted estimate for ground modes.
    distanceMeters: estimatedDistanceMeters(leg.mode, leg.from, leg.to),
    polyline: null,
    transitSteps: null,
    source: 'user',
  };
}

/** Map directions-polyline's `provider` to a trip_legs.source. */
export function routedSource(provider: unknown): 'ors' | 'google' {
  // A directions-polyline deployed before Y2.3 sends no `provider`; Google is
  // the hard-default provider, so that is the honest guess.
  return provider === 'ors' ? 'ors' : 'google';
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Turn a 2xx directions-polyline body into leg results for the legs it
 * covered (origin = legs[0].from, destination = last leg's .to).
 *   ok            every leg resolved;
 *   no_breakdown  a multi-leg run came back without a usable per-leg split
 *                 (older function, odd provider payload): resolve its legs
 *                 one call each instead;
 *   invalid       unusable (no route, missing numbers): estimate.
 */
export function routedLegsFromDirections(
  body: unknown,
  legs: readonly PlannedLeg[],
):
  | { kind: 'ok'; results: LegResult[] }
  | { kind: 'no_breakdown' }
  | { kind: 'invalid'; reason: string } {
  if (legs.length === 0) return { kind: 'ok', results: [] };
  if (!body || typeof body !== 'object') return { kind: 'invalid', reason: 'bad_response' };
  const b = body as Record<string, unknown>;
  const source = routedSource(b.provider);

  if (legs.length === 1) {
    const leg = legs[0]!;
    if (b.noRoute === true) return { kind: 'invalid', reason: 'no_route' };
    const durationSeconds = toNonNegativeInt(b.durationSeconds);
    const distanceMeters = toNonNegativeInt(b.distanceMeters);
    if (durationSeconds === null || distanceMeters === null) {
      return { kind: 'invalid', reason: 'bad_response' };
    }
    const polyline = typeof b.polyline === 'string' && b.polyline.length > 0 ? b.polyline : null;
    if (leg.mode === 'transit') {
      // The transit-no-route fallback answers 200 with zeros (pre-Y2.3
      // functions omit `noRoute`): nothing was routed.
      if (durationSeconds === 0 && distanceMeters === 0) return { kind: 'invalid', reason: 'no_route' };
      const steps = Array.isArray(b.transitSteps) && b.transitSteps.length > 0 ? b.transitSteps : null;
      return {
        kind: 'ok',
        results: [
          {
            fromId: leg.from.id,
            toId: leg.to.id,
            mode: leg.mode,
            durationSeconds,
            distanceMeters,
            polyline: null,
            transitSteps: steps,
            source,
          },
        ],
      };
    }
    // A ground-mode 2xx always carries a polyline (the function answers 404
    // no_route otherwise); a missing one means the payload is not usable.
    if (polyline === null) return { kind: 'invalid', reason: 'bad_response' };
    return {
      kind: 'ok',
      results: [
        {
          fromId: leg.from.id,
          toId: leg.to.id,
          mode: leg.mode,
          durationSeconds,
          distanceMeters,
          polyline,
          transitSteps: null,
          source,
        },
      ],
    };
  }

  const wire = b.legs;
  if (!Array.isArray(wire) || wire.length !== legs.length) return { kind: 'no_breakdown' };
  const results: LegResult[] = [];
  for (let i = 0; i < legs.length; i++) {
    const w = wire[i] as Record<string, unknown> | null | undefined;
    if (!w || typeof w !== 'object') return { kind: 'no_breakdown' };
    const durationSeconds = toNonNegativeInt(w.durationSeconds);
    const distanceMeters = toNonNegativeInt(w.distanceMeters);
    if (durationSeconds === null || distanceMeters === null) return { kind: 'no_breakdown' };
    const leg = legs[i]!;
    results.push({
      fromId: leg.from.id,
      toId: leg.to.id,
      mode: leg.mode,
      durationSeconds,
      distanceMeters,
      polyline: typeof w.polyline === 'string' && w.polyline.length > 0 ? w.polyline : null,
      transitSteps: null,
      source,
    });
  }
  return { kind: 'ok', results };
}

export type LegSourceCounts = Record<LegSource, number>;

export function countLegSources(results: ReadonlyArray<{ source: LegSource }>): LegSourceCounts {
  const counts: LegSourceCounts = { ors: 0, google: 0, estimate: 0, user: 0 };
  for (const r of results) counts[r.source] += 1;
  return counts;
}

// ============================================================================
// Matrix requests (sweep fix: ask only for the pairs the cache is missing)
// ============================================================================

/**
 * One distance-matrix request: every origin x every destination (indexes
 * into the caller's place list). distance-matrix always answers the full
 * cross product and bills origins x destinations elements.
 */
export interface MatrixRequestPlan {
  origins: number[];
  destinations: number[];
}

/**
 * Cost of one extra request, in elements. Two calls instead of one only pay
 * off when they save more than this (ORS counts requests, not elements, and
 * each call is a round trip).
 */
export const MATRIX_CALL_PENALTY_ELEMENTS = 10;

/**
 * Cover the missing ordered pairs (fromIndex, toIndex) with at most TWO
 * rectangular requests, minimising the billed elements (+ the call penalty).
 *
 * Origins are sorted by how many destinations they miss (most first) and
 * split at the best point i: the top i origins x their destination union,
 * plus the rest x theirs. A trip with k new places (all their pairs missing,
 * plus every old place -> the new ones) costs k*N + (N-k)*k elements instead
 * of N*N; a first run (everything missing) stays one N x N request. Every
 * missing pair is covered exactly once (the split partitions the origins).
 * Pure; deterministic for a given input.
 */
export function planMatrixRequests(
  missing: ReadonlyArray<readonly [number, number]>,
  callPenalty: number = MATRIX_CALL_PENALTY_ELEMENTS,
): MatrixRequestPlan[] {
  if (missing.length === 0) return [];
  const rows = new Map<number, Set<number>>();
  for (const [from, to] of missing) {
    let row = rows.get(from);
    if (!row) rows.set(from, (row = new Set<number>()));
    row.add(to);
  }
  const origins = [...rows.keys()].sort((a, b) => rows.get(b)!.size - rows.get(a)!.size || a - b);
  const n = origins.length;

  // prefix[i] = destination union of origins[0..i), suffix[i] = of origins[i..n).
  const prefix: Array<Set<number>> = [new Set<number>()];
  for (let i = 0; i < n; i++) {
    const next = new Set(prefix[i]);
    for (const d of rows.get(origins[i]!)!) next.add(d);
    prefix.push(next);
  }
  const suffix: Array<Set<number>> = new Array(n + 1);
  suffix[n] = new Set<number>();
  for (let i = n - 1; i >= 0; i--) {
    const next = new Set(suffix[i + 1]);
    for (const d of rows.get(origins[i]!)!) next.add(d);
    suffix[i] = next;
  }

  let best = 0; // 0 = one request with every origin
  let bestCost = n * suffix[0]!.size;
  for (let i = 1; i < n; i++) {
    const cost = i * prefix[i]!.size + (n - i) * suffix[i]!.size + callPenalty;
    if (cost < bestCost) {
      best = i;
      bestCost = cost;
    }
  }
  const sorted = (s: Iterable<number>) => [...s].sort((a, b) => a - b);
  if (best === 0) return [{ origins: sorted(origins), destinations: sorted(suffix[0]!) }];
  return [
    { origins: sorted(origins.slice(0, best)), destinations: sorted(prefix[best]!) },
    { origins: sorted(origins.slice(best)), destinations: sorted(suffix[best]!) },
  ];
}

/** Billed elements of a plan (sum of origins x destinations). */
export function planElements(plan: ReadonlyArray<MatrixRequestPlan>): number {
  return plan.reduce((sum, r) => sum + r.origins.length * r.destinations.length, 0);
}

/** Visit minutes + travel minutes of a day, rounded (response `totalMinutes`). */
export function dayTotalMinutes(
  chain: ReadonlyArray<{ visit_duration_minutes: number }>,
  legs: ReadonlyArray<{ durationSeconds: number }>,
): number {
  const visits = chain.reduce((sum, p) => sum + p.visit_duration_minutes, 0);
  const travel = legs.reduce((sum, l) => sum + l.durationSeconds, 0) / 60;
  return Math.round(visits + travel);
}
