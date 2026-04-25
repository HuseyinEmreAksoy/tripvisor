import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { TripDay, Uuid } from './types';
// Phase 20 Step 6: query-key factories moved to `./_keys` to break the
// `trip-places <-> routes` circular import. `tripDaysKeys` was hoisted
// alongside its peers for consistency, even though it isn't part of the
// cycle today — keeping the convention uniform avoids future circles
// when more cross-module invalidations land.
import { tripsKeys, tripDaysKeys } from './_keys';

// ----- Query keys ---------------------------------------------------------
//
// Mirrors the `tripPlacesKeys` / `tripsKeys` shape: `all` is the prefix for
// blanket invalidations, `forTrip(tripId)` is the per-trip list. Day rows are
// only ever consumed in the context of a parent trip (the trip detail screen
// renders the per-day timeline), so a single per-trip key is enough.
export { tripDaysKeys };

/**
 * List trip_days for a trip ordered by day_index. Returns an empty array when
 * the optimizer hasn't populated days yet — callers can safely render against
 * `data ?? []`.
 *
 * Rows are sparse: a trip_days row exists only after the user has interacted
 * with that day (pinned a start/end anchor, or — Phase 9 — written a note).
 * This is why `useUpdateTripDay` upserts rather than updates; see below.
 */
export function useTripDays(tripId: Uuid | undefined) {
  return useQuery<TripDay[]>({
    queryKey: tripId ? tripDaysKeys.forTrip(tripId) : ['trip-days', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_days')
        .select('*')
        .eq('trip_id', tripId)
        .order('day_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TripDay[];
    },
  });
}

// `notes` is a Markdown blob rendered client-side per ADR-0008. The 2000-char
// cap matches `trip_places.notes` for consistency and keeps a single per-day
// entry comfortably below the 1MB row size threshold even with multibyte runs.
const updateTripDaySchema = z.object({
  trip_id: z.string().uuid(),
  day_index: z.number().int().min(0),
  notes: z.string().max(2000).nullish(),
});

export type UpdateTripDayInput = z.infer<typeof updateTripDaySchema>;

async function getCallerId(): Promise<Uuid> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not authenticated');
  return data.user.id;
}

/**
 * Upsert per-day notes on a trip_days row, keyed by `(trip_id, day_index)`.
 *
 * Why upsert (and not update): the optimizer (supabase/functions/optimize-trip)
 * does NOT auto-populate trip_days — only `trip_places.day_index` /
 * `order_in_day` are written by `apply_optimization`. So a brand-new trip
 * has zero rows in trip_days and the user's first note on day 0 needs to
 * INSERT, not UPDATE. The natural conflict target is the existing
 * `(trip_id, day_index)` UNIQUE constraint from 0001_init.sql.
 *
 * The defense-in-depth is the explicit `trip_id` filter on the upsert payload
 * itself (RLS gates the row via the parent trip's `user_id`, but threading
 * `trip_id` through the request body keeps the contract self-validating —
 * a stale cache or an injected `day_index` from elsewhere can't write to
 * another user's trip).
 *
 * On error we throw (matches the `useArchiveTrip` / `useUpdateTrip` shape
 * in `trips.ts` — the planner spec said "return the error object" but the
 * existing pattern across `trips.ts` and `trip-places.ts` is `if (error)
 * throw error`; staying consistent with the codebase wins).
 */
export function useUpdateTripDay() {
  const qc = useQueryClient();
  return useMutation<TripDay, Error, UpdateTripDayInput>({
    mutationFn: async (input) => {
      const parsed = updateTripDaySchema.parse(input);
      // Touch the auth session so the supabase client picks up an expired
      // JWT before the upsert hits PostgREST (mirrors `useArchiveTrip`).
      await getCallerId();
      const { data, error } = await supabase
        .from('trip_days')
        .upsert(
          {
            trip_id: parsed.trip_id,
            day_index: parsed.day_index,
            notes: parsed.notes ?? null,
          },
          { onConflict: 'trip_id,day_index' },
        )
        .select('*')
        .single();
      if (error) throw error;
      return data as TripDay;
    },
    onSuccess: (row) => {
      // Refresh the per-trip days list so the timeline reflects the new
      // notes blob, plus the trip detail surface (the print page reads
      // through tripsKeys.detail).
      qc.invalidateQueries({ queryKey: tripDaysKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}
