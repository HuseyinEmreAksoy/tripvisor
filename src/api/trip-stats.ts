/**
 * trip-stats — server-side analytics aggregates (v2 Phase P3.2).
 *
 * Reads the `analytics_user_trip_stats` materialized view through its
 * security-definer reader `get_my_trip_stats()` (migration 0019 — the MV has
 * NO direct grants; the function filters to auth.uid()). Refreshed nightly by
 * pg_cron, so rows can be up to ~24h stale — consumers keep a LIVE fallback
 * for same-day data (the analytics screen's existing client aggregation).
 *
 * This replaces the client-side N-queries-per-trip aggregation as the
 * SCALABLE path (the v1 10-trip cap's proper fix; the interim useQueries fix
 * from Phase 0.5c remains the live fallback).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Uuid } from './types';

export interface TripStatsRow {
  user_id: Uuid;
  trip_id: Uuid;
  /**
   * In the trip's HOME currency (`trips.currency`, 0034). Pending expenses
   * are excluded (0038); see `pending_*` below and the TripExpense JSDoc.
   */
  total_actual_spend: number;
  total_estimated_spend: number;
  liked_count: number;
  disliked_count: number;
  place_count: number;
  /**
   * 0038: live expenses whose home-currency rate is not known yet (step 4 of
   * the TripExpense conversion order). They are NOT in the totals above.
   * Optional because backends before 0038 omit it.
   */
  pending_count?: number;
  /**
   * 0038: pending `actual` amounts summed per ORIGINAL currency,
   * e.g. `{ EUR: 12.5 }`. `{}` when none. Show beside the total and never
   * convert these on the client with a rate into another currency.
   */
  pending_actual_by_currency?: Partial<Record<string, number>>;
  /** 0038: the same for `estimated` expenses. */
  pending_estimated_by_currency?: Partial<Record<string, number>>;
}

export const tripStatsKeys = {
  all: ['trip-stats'] as const,
};

/**
 * All trips' aggregates for the signed-in user, one row per trip.
 * Nightly-stale by design — pair with live data for the current day.
 * Returns [] when the MV is empty (e.g. before the first cron refresh) or
 * the RPC is missing (pre-0019 backends) — never throws for those cases so
 * the analytics screen can silently fall back to client aggregation.
 */
export function useTripStats() {
  return useQuery<TripStatsRow[]>({
    queryKey: tripStatsKeys.all,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_trip_stats');
      if (error) {
        // Missing function / MV not yet refreshed → fallback territory.
        return [];
      }
      return (data ?? []) as TripStatsRow[];
    },
  });
}
