import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { RouteRenderMode, TripLeg, Uuid } from './types';
// Phase 20 Step 6: hoisted to `./_keys` to break the
// `trip-places <-> routes` circular import. Re-exported below so existing
// `import { tripLegsKeys } from './routes'` call sites keep working.
import { tripsKeys, tripPlacesKeys, tripLegsKeys } from './_keys';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';
import { orderLegsForHopLookup, type OptimizeResultLegFields } from './routes.types';

export { tripLegsKeys };
// M5 Y2.3: per-leg transport modes (types + pure helpers, see routes.types.ts).
export {
  OPTIMIZE_CONTRACT_VERSION,
  KEPT_ORDER_LEG_MODES,
  dayLegsFor,
  effectiveLegMode,
  isDayLeg,
  isEstimatedLeg,
  isKeptOrderLegMode,
  isUserTimedLeg,
  keptOrderDaySet,
  orderLegsForHopLookup,
} from './routes.types';
export type { OptimizeLegSources, OptimizeResultLegFields } from './routes.types';

/**
 * optimize-trip success body. M5 Y2.3 (contractVersion 2) adds the optional
 * {@link OptimizeResultLegFields} (`keptOrderDays`, `legSources`, `meta`);
 * every pre-M5 field is unchanged.
 */
export interface OptimizeResult extends OptimizeResultLegFields {
  stateHash: string;
  days: Array<{ dayIndex: number; orderedPlaceIds: string[]; totalMinutes: number }>;
  placesUpdated: number;
  legsWritten: number;
  cacheHit: boolean;
  polylineDays: number;
  /**
   * Phase 23 Step 23.2: which branch the Edge Function executed.
   * Mirrors the input `mode` for confirmation; defaults to 'optimized'
   * when the caller did not pass `mode` (the Edge Function's own default).
   */
  mode: RouteRenderMode;
}

/**
 * Typed error thrown by `useOptimizeTrip` when the `optimize-trip` Edge
 * Function returns a structured `{ error: { code, message } }` envelope
 * with a non-2xx HTTP status. Consumers can branch on the error via
 * `instanceof OptimizeError` and inspect `.code` to render an appropriate
 * surface (e.g. an "in progress" pill on 409 vs. a generic failure pill
 * on 5xx).
 *
 * Phase 20 Step 6: now extends the shared {@link EdgeFunctionError} base
 * class. The class name and field shape are unchanged so existing
 * `instanceof OptimizeError` checks at consumer sites keep working.
 *
 * Known codes (mirrors `supabase/functions/optimize-trip/index.ts`):
 *   - `already_optimizing`  — 409 — another optimize is in flight for this
 *                              trip; transient, no user action required
 *   - `too_many_places`     — 400 — trip exceeds the MVP cap (25 places)
 *   - `matrix_failed`       — 502 — distance-matrix Edge Function failed
 *   - `rpc_failed`          — 500 — `apply_optimization` RPC failed
 *   - `db_error`            — 500 — Postgres read/write error
 *   - `not_found`           — 404 — trip not visible to caller under RLS
 *   - `invalid_input`       — 400 — request body failed Zod validation
 *   - `method_not_allowed`  — 405 — non-POST request to the function
 *   - `not_editor`          — 403 — (audit 2026-09-29 #6) caller can SEE the
 *                              trip but is a viewer. Only the owner or an
 *                              accepted editor may optimize. The UI should not
 *                              auto-run optimize for viewers (gate on
 *                              `useTripRole().canEditTrip`).
 *   - `quota_exceeded`      — 429 — (audit #2) the caller's daily routing quota
 *                              (2000 billable elements per UTC day) is spent.
 *                              Not retryable today. See
 *                              {@link isRoutingQuotaExceeded}. M5 Y2.3: only
 *                              the optimizer's (non-transit) matrix can fail
 *                              this way; legs routed after the quota is gone
 *                              are written as `source: 'estimate'` instead.
 *   - `not_authenticated`   — 401 — no signed-in user session
 *
 * Network-only failures (no envelope / parse failure) fall through to
 * the original `Error` thrown by `supabase.functions.invoke` — the
 * mutation's error type is `OptimizeError | Error` to reflect that.
 */
export class OptimizeError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'OptimizeError';
  }
}

/**
 * True when optimize-trip failed because the caller's daily routing quota
 * is spent. Show a friendly "daily route limit reached, try again tomorrow"
 * state, not a generic failure.
 */
export function isRoutingQuotaExceeded(error: unknown): error is OptimizeError {
  return error instanceof OptimizeError && error.code === 'quota_exceeded';
}

export function useTripLegs(tripId: Uuid | undefined) {
  return useQuery<TripLeg[]>({
    queryKey: tripId ? tripLegsKeys.forTrip(tripId) : ['trip-legs', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      // SELECT * is deliberate here (single-trip detail read): it carries
      // `polyline` AND — since v2 P1.2 / migration 0023 — `transit_steps`
      // (jsonb → PostgREST returns it pre-parsed as TransitStep[] | null),
      // which the map renders for transit trips. Do NOT narrow this to a
      // projection without including transit_steps. The trips-list
      // aggregate path below (useAllTripLegs) stays projected — it never
      // needs geometry.
      //
      // Wave-2 sweep: TWO reads. The matrix cache (day_index -1) holds up
      // to 25 x 24 rows PER MODE, so one unordered read could hit
      // PostgREST's max_rows (1000) and silently drop DAY legs, i.e. break
      // the route. The day legs (<= 24 per day) are read on their own and
      // can never be crowded out; the cache read is only a hop-lookup
      // fallback (truncating it is harmless).
      const [dayRes, cacheRes] = await Promise.all([
        supabase.from('trip_legs').select('*').eq('trip_id', tripId).gte('day_index', 0),
        supabase.from('trip_legs').select('*').eq('trip_id', tripId).lt('day_index', 0),
      ]);
      if (dayRes.error) throw dayRes.error;
      if (cacheRes.error) throw cacheRes.error;
      // M5 Y2.3: matrix-cache rows (day_index -1) first, day legs last, so
      // from→to lookups with last-wins (computeDayTimeline) always pick the
      // day leg, whose mode may differ from the cached day-default pair.
      return orderLegsForHopLookup([...(cacheRes.data ?? []), ...(dayRes.data ?? [])] as TripLeg[]);
    },
  });
}

/**
 * Narrow projection of `trip_legs` for the trips-list duration sort. Only
 * the two fields the sort actually needs. (v2 Phase 0.1: replaces the
 * retired `TripLegCostRow` / per-km cost projection.)
 */
export interface TripLegDurationRow {
  trip_id: Uuid;
  duration_seconds: number;
}

/**
 * Batched trip_legs read for many trips in a single query — designed for
 * the trips list duration sort (originally built for the Phase 12 cost
 * sort; repointed to time-first metrics in v2 Phase 0.1).
 *
 * Why this exists
 * ---------------
 * Sorting the trips list by total travel time requires summing
 * `duration_seconds` across every leg of every trip. Issuing
 * one `useTripLegs(id)` per row would be N+1 (one query per trip × N
 * trips). This hook collapses that into a single
 *   SELECT trip_id, duration_seconds FROM trip_legs WHERE trip_id IN (...)
 * — RLS still gates each row by the parent trip's `user_id`, so callers
 * can't see legs they shouldn't.
 *
 * Why a projected SELECT (not `*`)
 * ---------------------------------
 * The duration sort only consumes `trip_id` (for grouping) and
 * `duration_seconds` (for the sum). Projecting saves transferring
 * `polyline` (which can be many KB per leg, especially for long days),
 * `from_place_id`, `to_place_id`, `day_index`, etc. for every leg of
 * every trip on every list refetch. RLS evaluation cost is unaffected by
 * column projection.
 *
 * Return shape
 * ------------
 * A `Map<Uuid, TripLegDurationRow[]>` keyed by `trip_id` for O(1) per-trip
 * lookup. The map is built in a `useMemo` over `data` so its identity is
 * stable across renders that don't refetch — list rows that read it via
 * `map.get(trip.id)` won't re-render unnecessarily.
 *
 * Empty input
 * -----------
 * `tripIds.length === 0` short-circuits via `enabled: false` — TanStack
 * never invokes `queryFn`, so the network stays untouched and no `[]`
 * entry pollutes the cache. The defensive `if (tripIds.length === 0)`
 * inside `queryFn` is a belt-and-suspenders guard for the rare race
 * where `enabled` flips between scheduling and execution; under normal
 * flow it never runs.
 *
 * Refetch
 * -------
 * `refetchOnWindowFocus: false` — the trips list is the only consumer
 * today, and `useTrips` already covers focus refetch for the list itself.
 * Optimize mutations invalidate `tripLegsKeys.all` (via the existing
 * `useOptimizeTrip().onSuccess`) which transitively busts both the
 * single-trip and multi-trip caches.
 */
export function useAllTripLegs(tripIds: readonly Uuid[]) {
  const query = useQuery<TripLegDurationRow[]>({
    queryKey: tripLegsKeys.byTripIds(tripIds),
    enabled: tripIds.length > 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (tripIds.length === 0) return [];
      // M5 Y2.3: day legs only (day_index >= 0). optimize-trip also keeps
      // one matrix-cache row per ordered place pair (day_index = -1, up to
      // 600 per trip); summing those inflated the sort and could push the
      // read past PostgREST's row cap.
      const { data, error } = await supabase
        .from('trip_legs')
        .select('trip_id, duration_seconds')
        .in('trip_id', tripIds as Uuid[])
        .gte('day_index', 0);
      if (error) throw error;
      return (data ?? []) as TripLegDurationRow[];
    },
  });

  const byTripId = useMemo(() => {
    const map = new Map<Uuid, TripLegDurationRow[]>();
    if (!query.data) return map;
    for (const leg of query.data) {
      const bucket = map.get(leg.trip_id);
      if (bucket) bucket.push(leg);
      else map.set(leg.trip_id, [leg]);
    }
    return map;
  }, [query.data]);

  return { ...query, byTripId };
}

/**
 * Mutation hook that invokes the `optimize-trip` Edge Function.
 *
 * Error shape: when the function returns a non-2xx status with the
 * structured `{ error: { code, message } }` envelope, this hook parses
 * the body and throws an {@link OptimizeError} carrying the code and
 * status. Consumers can `instanceof OptimizeError` to branch on the
 * code (see the JSDoc on `OptimizeError` for the full code list).
 * Network-only failures (no envelope / unparseable body) fall through
 * to the original generic `Error` from `supabase.functions.invoke` —
 * the mutation's error type is `OptimizeError | Error`.
 */
/**
 * Input variables for `useOptimizeTrip().mutate(...)`.
 *
 * Phase 23 Step 23.3: `mode` is optional for back-compat with every
 * Phase 1–22 call site that passed only `{ tripId }`. The Edge Function
 * itself also defaults to `'optimized'` (see `BodySchema` in
 * `supabase/functions/optimize-trip/index.ts`). Post-Phase-23 call sites
 * SHOULD pass `mode: trip.route_render_mode` explicitly so the function
 * runs the branch the user expects.
 */
export interface OptimizeTripInput {
  tripId: Uuid;
  mode?: RouteRenderMode;
}

export function useOptimizeTrip() {
  const qc = useQueryClient();
  return useMutation<OptimizeResult, OptimizeError | Error, OptimizeTripInput>({
    mutationFn: async ({ tripId, mode }) => {
      // Always send `mode` to the Edge Function — even when the caller
      // omitted it client-side, we materialize the default here so the
      // wire format is consistent and easier to grep across logs.
      const resolvedMode: RouteRenderMode = mode ?? 'optimized';
      const { data, error } = await supabase.functions.invoke<OptimizeResult>(
        'optimize-trip',
        { body: { tripId, mode: resolvedMode } },
      );
      if (error) {
        // `supabase.functions.invoke` wraps non-2xx responses in
        // FunctionsHttpError, exposing the original Response on `.context`.
        // Phase 20 Step 6: parse via the shared `tryParseEdgeFunctionError`
        // helper so the envelope-parsing logic lives in one place.
        const typed = await tryParseEdgeFunctionError(error, OptimizeError);
        if (typed) throw typed;
        throw error;
      }
      if (!data) throw new Error('optimize-trip returned no data');
      return data;
    },
    onSuccess: (_res, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(tripId) });
      // Invalidate the entire trip-legs prefix (rather than just
      // `forTrip(tripId)`) so the Phase 12 multi-trip `byTripIds` cache
      // — used by the trips list cost sort — refreshes too. The single
      // optimize call rewrites legs for one trip, but any list view
      // querying that trip alongside others is now stale.
      qc.invalidateQueries({ queryKey: tripLegsKeys.all });
    },
  });
}
