import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { CreateTripInput, Trip, Uuid } from './types';
import { tripsKeys } from './_keys';

// ----- Query keys ---------------------------------------------------------
//
// `tripsKeys.list({ archived })` partitions Active vs. Archived caches so
// flipping the filter is instant from cache and one mutation only invalidates
// what it needs to. `tripsKeys.all` (the prefix) lets a single
// `invalidateQueries({ queryKey: tripsKeys.all })` hit both lists when a
// mutation affects ownership of which list a trip lives in (archive /
// unarchive / duplicate / delete).
//
// Phase 20 Step 6: the factory itself moved to `./_keys` to break the
// `trip-places <-> routes` circular import. Re-exported here so existing
// `import { tripsKeys } from './trips'` call sites keep working.
export { tripsKeys };

const createTripSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  daily_hours_budget: z.number().positive().max(24).default(8),
  transport_mode: z.enum(['driving', 'walking', 'transit']).default('driving'),
  timezone: z.string().nullish(),
});

export type UseTripsOptions = { archived?: boolean };

/**
 * List trips for the signed-in user.
 *
 * Filters by `archived_at` so the active and archived tabs share no data.
 * Default: `archived: false` (the existing call sites get the same active
 * list they did before Phase 7).
 */
export function useTrips(opts: UseTripsOptions = {}) {
  const archived = opts.archived ?? false;
  return useQuery<Trip[]>({
    queryKey: tripsKeys.list({ archived }),
    queryFn: async () => {
      let query = supabase.from('trips').select('*');
      if (archived) {
        query = query.not('archived_at', 'is', null);
      } else {
        query = query.is('archived_at', null);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data as Trip[];
    },
  });
}

export function useTrip(id: Uuid | undefined) {
  return useQuery<Trip | null>({
    queryKey: id ? tripsKeys.detail(id) : ['trips', 'detail', 'none'],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as Trip | null) ?? null;
    },
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation<Trip, Error, CreateTripInput>({
    mutationFn: async (input) => {
      const parsed = createTripSchema.parse(input);
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw userErr ?? new Error('Not authenticated');
      const { data, error } = await supabase
        .from('trips')
        .insert({ ...parsed, user_id: userData.user.id })
        .select('*')
        .single();
      if (error) throw error;
      return data as Trip;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripsKeys.all });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('trips').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: tripsKeys.all });
      qc.removeQueries({ queryKey: tripsKeys.detail(id) });
    },
  });
}

// ============================================================
// Phase 7: archive / unarchive / duplicate
// ============================================================
//
// Archive / unarchive use an optimistic update: the trip disappears from the
// list it currently lives in immediately, and reappears (or stays gone) once
// the server confirms. On error we roll back. On settle we invalidate both
// lists so the truth is server-side.

const ACTIVE_KEY = tripsKeys.list({ archived: false });
const ARCHIVED_KEY = tripsKeys.list({ archived: true });

type ArchiveContext = {
  prevActive: Trip[] | undefined;
  prevArchived: Trip[] | undefined;
};

async function getCallerId(): Promise<Uuid> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('Not authenticated');
  return data.user.id;
}

/**
 * Archive (soft-delete) a trip. The row stays in the DB; only `archived_at`
 * is set. RLS on `trips` already gates the update by `user_id`; the explicit
 * `.eq('user_id', ...)` is defense-in-depth so a stale cache or a row that
 * shouldn't exist can't slip past.
 */
export function useArchiveTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid, ArchiveContext>({
    mutationFn: async (tripId) => {
      const userId = await getCallerId();
      const { error } = await supabase
        .from('trips')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', tripId)
        .eq('user_id', userId);
      if (error) throw error;
      return tripId;
    },
    onMutate: async (tripId) => {
      await qc.cancelQueries({ queryKey: tripsKeys.all });
      const prevActive = qc.getQueryData<Trip[]>(ACTIVE_KEY);
      const prevArchived = qc.getQueryData<Trip[]>(ARCHIVED_KEY);
      qc.setQueryData<Trip[]>(ACTIVE_KEY, (old) =>
        Array.isArray(old) ? old.filter((t) => t.id !== tripId) : old,
      );
      return { prevActive, prevArchived };
    },
    onError: (_err, _tripId, ctx) => {
      if (ctx?.prevActive !== undefined) qc.setQueryData(ACTIVE_KEY, ctx.prevActive);
      if (ctx?.prevArchived !== undefined) qc.setQueryData(ARCHIVED_KEY, ctx.prevArchived);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: tripsKeys.all });
    },
  });
}

/**
 * Unarchive: restores a trip to the active list by clearing `archived_at`.
 */
export function useUnarchiveTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid, ArchiveContext>({
    mutationFn: async (tripId) => {
      const userId = await getCallerId();
      const { error } = await supabase
        .from('trips')
        .update({ archived_at: null })
        .eq('id', tripId)
        .eq('user_id', userId);
      if (error) throw error;
      return tripId;
    },
    onMutate: async (tripId) => {
      await qc.cancelQueries({ queryKey: tripsKeys.all });
      const prevActive = qc.getQueryData<Trip[]>(ACTIVE_KEY);
      const prevArchived = qc.getQueryData<Trip[]>(ARCHIVED_KEY);
      qc.setQueryData<Trip[]>(ARCHIVED_KEY, (old) =>
        Array.isArray(old) ? old.filter((t) => t.id !== tripId) : old,
      );
      return { prevActive, prevArchived };
    },
    onError: (_err, _tripId, ctx) => {
      if (ctx?.prevActive !== undefined) qc.setQueryData(ACTIVE_KEY, ctx.prevActive);
      if (ctx?.prevArchived !== undefined) qc.setQueryData(ARCHIVED_KEY, ctx.prevArchived);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: tripsKeys.all });
    },
  });
}

// ============================================================
// Phase 8: in-place metadata edits (title / currency / cost_per_km)
// ============================================================

/**
 * Patch shape for `useUpdateTrip`. Intentionally narrow — only fields the UI
 * actually edits in place:
 *   - `title` — rename affordance (Phase 8)
 *   - `currency`, `cost_per_km` — Phase 8 cost rollup card
 *     (`cost_per_km` is DEPRECATED as of Phase 20 Step 6 — kept for
 *     back-compat until Phase 21 Step 4 migrates the UI to the
 *     category-based budget model)
 *   - `daily_hours_budget`, `transport_mode` — Phase 9 trip-meta cleanup
 *     (Step 9.6); these are the two remaining editable scalars on the trip
 *     detail screen and the optimizer reads both, so a typed home for them
 *     here keeps the editing surface consistent.
 *   - `total_budget` — Phase 20 Step 6: optional total-trip budget ceiling;
 *     the per-category sum lives on `trip_expenses` and is fetched
 *     separately via `useTripExpenses`.
 *
 * Add fields here as new inline-editable surfaces land; do NOT widen to
 * `Partial<Trip>` since that would let callers blindly overwrite immutable
 * fields like `id` / `user_id` / `created_at`.
 */
export type UpdateTripPatch = Partial<
  Pick<
    Trip,
    | 'title'
    | 'currency'
    | 'cost_per_km'
    | 'daily_hours_budget'
    | 'transport_mode'
    | 'total_budget'
  >
>;

/**
 * Update editable trip metadata. Mirrors the `useArchiveTrip` shape: the
 * `.eq('user_id', userId)` is defense-in-depth on top of RLS, and on
 * settle we invalidate both the lists (in case `title` changed) and the
 * detail (so the trip screen recomputes the cost rollup with the new rate
 * and the optimizer picks up new `daily_hours_budget` / `transport_mode`
 * values on the next run).
 *
 * Bound to a specific `tripId` at hook time — callers do
 * `useUpdateTrip(id).mutate({ cost_per_km: 0.35 })` rather than threading
 * the id through the variables. This matches how the UI surfaces consume
 * it (one card per trip detail screen).
 */
export function useUpdateTrip(tripId: Uuid) {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, UpdateTripPatch>({
    mutationFn: async (patch) => {
      // Empty patch is a no-op; avoid issuing a pointless UPDATE that would
      // still bump updated_at via the trigger.
      if (Object.keys(patch).length === 0) return tripId;
      const userId = await getCallerId();
      const { error } = await supabase
        .from('trips')
        .update(patch)
        .eq('id', tripId)
        .eq('user_id', userId);
      if (error) throw error;
      return tripId;
    },
    onSuccess: () => {
      // Invalidate both list partitions (active/archived) so a renamed trip
      // shows fresh in whichever tab is mounted, plus the detail cache so
      // the cost rollup recomputes with the new rate.
      qc.invalidateQueries({ queryKey: tripsKeys.all });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
    },
  });
}

/**
 * Duplicate a trip via the `duplicate_trip(p_trip_id)` Postgres RPC. The
 * server-side function (security definer) clones the trip + its places per
 * ADR-0006. Returns the new trip id. No optimistic update — the new row
 * isn't fully knowable client-side, so we just invalidate the active list.
 */
export function useDuplicateTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid>({
    mutationFn: async (tripId) => {
      const { data, error } = await supabase.rpc('duplicate_trip', { p_trip_id: tripId });
      if (error) throw error;
      if (typeof data !== 'string') {
        throw new Error('duplicate_trip returned no id');
      }
      return data as Uuid;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_KEY });
    },
  });
}
