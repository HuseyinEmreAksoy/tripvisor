import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { tripsKeys } from './trips';
import { tripPlacesKeys } from './trip-places';
import type { TripLeg, Uuid } from './types';

export const tripLegsKeys = {
  all: ['trip-legs'] as const,
  forTrip: (tripId: Uuid) => [...tripLegsKeys.all, tripId] as const,
  /**
   * Cache key for the multi-trip batch fetch used by the trips list cost
   * sort (Phase 12). The id list is sorted at key-construction time so
   * `[a, b]` and `[b, a]` collapse to one cache entry. We cache by the
   * comma-joined string (rather than the array itself) for a stable
   * primitive key — TanStack hashes structurally either way, but the
   * stringified form is faster to compare and keeps the cache key human
   * readable in devtools.
   */
  byTripIds: (tripIds: readonly Uuid[]) =>
    [...tripLegsKeys.all, 'by-trips', [...tripIds].sort().join(',')] as const,
};

export interface OptimizeResult {
  stateHash: string;
  days: Array<{ dayIndex: number; orderedPlaceIds: string[]; totalMinutes: number }>;
  placesUpdated: number;
  legsWritten: number;
  cacheHit: boolean;
  polylineDays: number;
}

export function useTripLegs(tripId: Uuid | undefined) {
  return useQuery<TripLeg[]>({
    queryKey: tripId ? tripLegsKeys.forTrip(tripId) : ['trip-legs', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_legs')
        .select('*')
        .eq('trip_id', tripId);
      if (error) throw error;
      return (data ?? []) as TripLeg[];
    },
  });
}

/**
 * Narrow projection of `trip_legs` for the cost rollup. Only the two
 * fields the trips-list sort actually needs.
 */
export interface TripLegCostRow {
  trip_id: Uuid;
  distance_meters: number;
}

/**
 * Batched trip_legs read for many trips in a single query — designed for
 * the trips list cost sort (Phase 12, deferred from Phase 11).
 *
 * Why this exists
 * ---------------
 * Sorting the trips list by total cost requires summing
 * `distance_meters * cost_per_km` across every leg of every trip. Issuing
 * one `useTripLegs(id)` per row would be N+1 (one query per trip × N
 * trips). This hook collapses that into a single
 *   SELECT trip_id, distance_meters FROM trip_legs WHERE trip_id IN (...)
 * — RLS still gates each row by the parent trip's `user_id`, so callers
 * can't see legs they shouldn't.
 *
 * Why a projected SELECT (not `*`)
 * ---------------------------------
 * The cost sort only consumes `trip_id` (for grouping) and
 * `distance_meters` (for the sum). Projecting saves transferring
 * `polyline` (which can be many KB per leg, especially for long days),
 * `from_place_id`, `to_place_id`, `day_index`, etc. for every leg of
 * every trip on every list refetch. RLS evaluation cost is unaffected by
 * column projection.
 *
 * Return shape
 * ------------
 * A `Map<Uuid, TripLegCostRow[]>` keyed by `trip_id` for O(1) per-trip
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
  const query = useQuery<TripLegCostRow[]>({
    queryKey: tripLegsKeys.byTripIds(tripIds),
    enabled: tripIds.length > 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (tripIds.length === 0) return [];
      const { data, error } = await supabase
        .from('trip_legs')
        .select('trip_id, distance_meters')
        .in('trip_id', tripIds as Uuid[]);
      if (error) throw error;
      return (data ?? []) as TripLegCostRow[];
    },
  });

  const byTripId = useMemo(() => {
    const map = new Map<Uuid, TripLegCostRow[]>();
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

export function useOptimizeTrip() {
  const qc = useQueryClient();
  return useMutation<OptimizeResult, Error, { tripId: Uuid }>({
    mutationFn: async ({ tripId }) => {
      const { data, error } = await supabase.functions.invoke<OptimizeResult>(
        'optimize-trip',
        { body: { tripId } },
      );
      if (error) throw error;
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
