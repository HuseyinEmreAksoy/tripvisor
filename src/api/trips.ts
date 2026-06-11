import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type {
  CreateTripInput,
  RouteRenderMode,
  Trip,
  TripCollaboratorRole,
  Uuid,
} from './types';
import { tripsKeys, tripExpensesKeys } from './_keys';
import { useOptimizeTrip } from './routes';

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

// Phase 23: transport_mode enum widened to include 'bicycling'. Values
// must stay in lockstep with the TransportMode union in `./types`,
// the trips_transport_mode_check CHECK constraint (migration 0016), and
// the Zod enums in supabase/functions/{distance-matrix,directions-polyline}.
const createTripSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  daily_hours_budget: z.number().positive().max(24).default(8),
  transport_mode: z.enum(['driving', 'walking', 'transit', 'bicycling']).default('driving'),
  timezone: z.string().nullish(),
});

export type UseTripsOptions = { archived?: boolean };

/**
 * List trips visible to the signed-in user.
 *
 * Phase 22 Step 22.3: returns the UNION of trips the caller owns AND trips
 * where the caller is an accepted collaborator. Each row is tagged
 * client-side with `{ isOwner, collaboratorRole }` so the UI can render
 * a "Shared with me" badge / role chip without a second hook.
 *
 * How the UNION is assembled
 * --------------------------
 * The `trips_collab_select` policy (see `0014_fix_trips_insert_returning_rls.sql`)
 * grants SELECT on the UNION already: it permits rows where
 * `user_id = auth.uid()` OR `user_can_access_trip(id, auth.uid(), 'viewer')`.
 * So a plain unfiltered SELECT under the user JWT returns both sets.
 *
 * To derive `collaboratorRole`, we issue a SECOND lightweight query
 * against `trip_collaborators` (filtered to status='accepted',
 * user_id=auth.uid()) and join client-side. The two-step form avoids a
 * more expensive PostgREST embedded query.
 *
 * Sort order
 * ----------
 * Owner-trips first (by created_at desc), then collaborator-trips
 * (by created_at desc). Rationale: a user's own work should surface
 * above shared work in the trips list. Applied client-side AFTER the
 * join because Postgres returns the UNION in arbitrary order.
 *
 * Filters by `archived_at` so the active and archived tabs share no data.
 * The filter applies uniformly to owned + collaborator trips (RLS is
 * row-level, not partition-level).
 */
export function useTrips(opts: UseTripsOptions = {}) {
  const archived = opts.archived ?? false;
  return useQuery<Trip[]>({
    queryKey: tripsKeys.list({ archived }),
    queryFn: async () => {
      // 1. Fetch the UNION via RLS. NOTE: no .eq('user_id', ...) filter —
      //    the trips_collab_select policy already gates this to
      //    owner OR accepted-collaborator rows.
      let query = supabase.from('trips').select('*');
      if (archived) {
        query = query.not('archived_at', 'is', null);
      } else {
        query = query.is('archived_at', null);
      }
      const { data: rawTrips, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      // 2. Resolve the caller's user id once so we can label `isOwner`
      //    on each row. If the user is signed out, no rows are visible
      //    under RLS anyway, so this is a defense-in-depth.
      const { data: userData } = await supabase.auth.getUser();
      const callerId = userData.user?.id ?? null;

      // 3. Fetch the caller's accepted-collaborator memberships to
      //    derive `collaboratorRole`. Skip if signed out (rawTrips is
      //    already empty in that case).
      let roleByTripId = new Map<Uuid, TripCollaboratorRole>();
      if (callerId) {
        const { data: collabRows, error: collabErr } = await supabase
          .from('trip_collaborators')
          .select('trip_id, role')
          .eq('user_id', callerId)
          .eq('status', 'accepted');
        if (collabErr) throw collabErr;
        roleByTripId = new Map(
          (collabRows ?? []).map((r) => [
            r.trip_id as Uuid,
            r.role as TripCollaboratorRole,
          ]),
        );
      }

      // 4. Tag each row with derived flags. A row whose user_id matches
      //    the caller is the owner (collaboratorRole = null even if
      //    they also somehow have a collaborator row). Otherwise the
      //    row is a collaborator-trip and we look up the role.
      const tagged: Trip[] = (rawTrips ?? []).map((t) => {
        const row = t as Trip;
        const isOwner = callerId !== null && row.user_id === callerId;
        return {
          ...row,
          isOwner,
          collaboratorRole: isOwner ? null : roleByTripId.get(row.id) ?? null,
        };
      });

      // 5. Sort: owner-trips first (created_at desc), then
      //    collaborator-trips (created_at desc). Stable on identical
      //    timestamps via the secondary id sort to keep RN list keys
      //    deterministic.
      return tagged.sort((a, b) => {
        if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
        const cmp = b.created_at.localeCompare(a.created_at);
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
      });
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
// Phase 8: in-place metadata edits (title / currency / budget fields)
// ============================================================

/**
 * Patch shape for `useUpdateTrip`. Intentionally narrow — only fields the UI
 * actually edits in place:
 *   - `title` — rename affordance (Phase 8)
 *   - `currency` — unit-of-account for `total_budget` / `trip_expenses`
 *     (v2 Phase 0.1 retired the per-km cost model; the per-km rate field
 *     was removed from this patch shape and from the `Trip` type — the DB
 *     column drop is deferred to v2 Phase 15.1)
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
    | 'daily_hours_budget'
    | 'transport_mode'
    | 'total_budget'
    // Phase 23 Step 23.3: route render-mode toggle. Editor-collaborators
    // can flip this column too — see migration 0016 for the trigger
    // allow-list expansion. Adding it here lets the existing
    // `useUpdateTrip` mutation patch it without a dedicated hook.
    | 'route_render_mode'
    // Phase 25 Step 25.3: trip cover-photo pointer. Editor-collaborators
    // can flip this column too — see migration 0018 for the trigger
    // allow-list expansion.
    | 'cover_photo_google_place_id'
  >
>;

/**
 * Update editable trip metadata.
 *
 * Authorization model (Phase 25 Step 25.1)
 * ----------------------------------------
 * No `.eq('user_id', userId)` filter. RLS handles this via the OR of the
 * `trips_owner_update` policy (owners) and the `trips_editor_budget_update`
 * policy (accepted editors), with the `enforce_trips_column_restrictions`
 * BEFORE UPDATE trigger clamping editors to the allow-list
 * `{ total_budget, route_render_mode, cover_photo_google_place_id }`.
 *
 * Why we removed the filter
 * -------------------------
 * Earlier (pre-Phase 22) `useUpdateTrip` was strictly owner-only and the
 * `.eq('user_id', userId)` filter was defense-in-depth. Phase 22 + 23 + 25
 * extended the allow-list so editors can patch a narrow set of columns
 * (`total_budget`, `route_render_mode`, `cover_photo_google_place_id`).
 * The client-side filter blocked editors from issuing those legitimate
 * patches even though RLS + the trigger would have permitted them. The
 * filter is now wrong, so we drop it. RLS + the trigger remain the
 * single source of truth for authorization.
 *
 * Bound to a specific `tripId` at hook time — callers do
 * `useUpdateTrip(id).mutate({ total_budget: 500 })` rather than threading
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
      // Touch the auth session so the supabase client picks up an expired
      // JWT before the UPDATE hits PostgREST. RLS + the trigger gate
      // authorization — no client-side user_id filter (see fn doc).
      await getCallerId();
      const { error } = await supabase
        .from('trips')
        .update(patch)
        .eq('id', tripId);
      if (error) throw error;
      return tripId;
    },
    onSuccess: () => {
      // Invalidate both list partitions (active/archived) so a renamed trip
      // shows fresh in whichever tab is mounted, plus the detail cache so
      // the trip detail screen reflects the patched fields.
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

// ============================================================
// Phase 21 Step 3: total-trip budget mutation
// ============================================================
//
// `useUpdateTripBudget` is a narrow, single-field cousin of `useUpdateTrip`
// dedicated to the budget surface. Why a separate hook (instead of just
// reusing `useUpdateTrip`):
//
//   1. Optimistic UX. The budget card renders the new ceiling immediately
//      while the round trip is in flight; if the server rejects the change,
//      we roll back. `useUpdateTrip` is a coarser, multi-field invalidate-
//      on-success — adding optimism there would risk de-syncing other
//      inline edits (title, transport mode) that don't currently expect
//      a cache pre-write.
//   2. Tighter cache invalidation. After a budget change the
//      `useTripExpenseRollup` (Phase 21 Step 3) needs to recompute since
//      `remaining = budget - totalActual` shifted. Invalidating the
//      per-trip expenses cache is the cheapest way to force the derived
//      rollup memo to re-run on the next render.

type UpdateTripBudgetContext = {
  prevDetail: Trip | null | undefined;
};

/**
 * Update the trip's `total_budget`. Pass `null` to clear the ceiling
 * (returns the trip to "no budget configured" state).
 *
 * Optimistic + rollback: pre-writes the new value into
 * `tripsKeys.detail(tripId)` so the budget card updates instantly. On
 * error we restore the previous detail snapshot. On settle we invalidate
 * both `tripsKeys.detail(tripId)` and `tripExpensesKeys.forTrip(tripId)`
 * — the latter because the rollup hook (`useTripExpenseRollup`) is
 * memoized on the expenses + budget pair, and changing the budget alone
 * needs to trigger a recompute on the next render.
 */
export function useUpdateTripBudget(tripId: Uuid) {
  const qc = useQueryClient();
  const detailKey = tripsKeys.detail(tripId);
  return useMutation<Uuid, Error, number | null, UpdateTripBudgetContext>({
    mutationFn: async (total_budget) => {
      // `null` is a meaningful value (clear the ceiling); we deliberately
      // do NOT short-circuit on `null` like we would on `undefined`.
      //
      // Phase 25 Step 25.1: no `.eq('user_id', userId)` filter. The
      // `trips_editor_budget_update` RLS policy explicitly grants editors
      // permission to UPDATE total_budget; the prior client filter
      // blocked that path. RLS + the
      // `enforce_trips_column_restrictions` trigger (which permits
      // total_budget for editors) gate authorization correctly.
      // Touching the session keeps the JWT fresh before the round trip.
      await getCallerId();
      const { error } = await supabase
        .from('trips')
        .update({ total_budget })
        .eq('id', tripId);
      if (error) throw error;
      return tripId;
    },
    onMutate: async (total_budget) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prevDetail = qc.getQueryData<Trip | null>(detailKey);
      if (prevDetail) {
        // Functional updater: TanStack v5.101 + TS 5.8 mis-infers the direct
        // value form against Updater<NoInfer<Trip | null>>; the callback form
        // type-checks cleanly and is atomic against concurrent cache writes.
        qc.setQueryData<Trip | null>(detailKey, (old) =>
          old ? { ...old, total_budget } : old,
        );
      }
      return { prevDetail };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevDetail !== undefined) {
        qc.setQueryData(detailKey, ctx.prevDetail);
      }
    },
    onSettled: () => {
      // Detail recomputes the trip row; the per-trip expenses cache is
      // what `useTripExpenseRollup` keys its memo against, so bumping it
      // forces the rollup's `remaining = budget - totalActual` to
      // re-derive with the new ceiling.
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: tripExpensesKeys.forTrip(tripId) });
    },
  });
}

// ============================================================
// Phase 23 Step 23.3: route render-mode toggle
// ============================================================
//
// `useUpdateRouteRenderMode` flips `trips.route_render_mode` AND immediately
// re-runs the optimize-trip Edge Function with the new mode so the polyline
// updates without a manual re-optimize. This is the convenience hook the
// trip detail toggle binds to — wrapping two operations behind one
// mutate() call so the UI doesn't have to chain promises.
//
// Why a dedicated hook (instead of just composing useUpdateTrip + useOptimizeTrip)
// ----------------------------------------------------------------------
//   1. Atomicity from the user's perspective. Flipping the toggle should
//      look like one operation: the new mode is persisted AND the route
//      visibly updates. If we exposed two separate mutations, every call
//      site would have to remember to chain them and handle partial-
//      failure (toggle landed but optimize crashed).
//   2. Optimistic update. The detail cache pre-writes the new mode value
//      so the toggle UI flips instantly; if the persist fails, we roll
//      back. Optimize runs after a successful persist — there is no
//      reason to optimize-with-the-new-mode if the new mode never made
//      it to the DB.
//   3. RLS path. Editors can flip route_render_mode (migration 0016
//      extends the editor-budget allow-list). We do NOT add an
//      `.eq('user_id', userId)` filter here (unlike `useUpdateTrip`)
//      because that would block editors. The trips_owner_update +
//      trips_editor_budget_update RLS policies + the
//      enforce_trips_column_restrictions trigger together gate writes
//      correctly.
//
// Sequence
// --------
//   1. Optimistic write to `tripsKeys.detail(tripId)` so the toggle flips
//      immediately.
//   2. UPDATE trips set route_render_mode = mode.
//   3. On success, invoke optimize-trip with { tripId, mode } — this
//      re-renders trip_legs against the new mode (manual: trace existing
//      chain; optimized: re-cluster + 2-opt).
//   4. On error at step 2, roll back the cache. Step 3 is best-effort:
//      if optimize fails, we still keep the persisted mode (the user
//      can re-trigger optimize manually). Logged via the mutation's
//      onError so a parent ErrorBoundary / Sentry catch sees it.

type UpdateRouteRenderModeContext = {
  prevDetail: Trip | null | undefined;
};

export function useUpdateRouteRenderMode(tripId: Uuid) {
  const qc = useQueryClient();
  const optimize = useOptimizeTrip();
  const detailKey = tripsKeys.detail(tripId);

  return useMutation<RouteRenderMode, Error, RouteRenderMode, UpdateRouteRenderModeContext>({
    mutationFn: async (mode) => {
      // Persist the new mode. RLS handles authorization (owner OR
      // editor-via-trips_editor_budget_update policy + the trigger
      // allow-list which now includes route_render_mode).
      const { error } = await supabase
        .from('trips')
        .update({ route_render_mode: mode })
        .eq('id', tripId);
      if (error) throw error;

      // Immediately re-render legs with the new mode. Best-effort: a
      // failure here does NOT roll back the persisted mode (the user
      // can hit "Re-optimize" manually). We swallow the optimize error
      // for the mutation's success path so the toggle UX feels snappy
      // — but log it so observability + Sentry still see it.
      try {
        await optimize.mutateAsync({ tripId, mode });
      } catch (err) {
        console.warn(
          '[useUpdateRouteRenderMode] mode persisted but optimize failed; user may need to re-run optimize manually',
          err,
        );
      }
      return mode;
    },
    onMutate: async (mode) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prevDetail = qc.getQueryData<Trip | null>(detailKey);
      if (prevDetail) {
        // Functional updater — see useUpdateTripBudget onMutate for rationale.
        qc.setQueryData<Trip | null>(detailKey, (old) =>
          old ? { ...old, route_render_mode: mode } : old,
        );
      }
      return { prevDetail };
    },
    onError: (_err, _mode, ctx) => {
      if (ctx?.prevDetail !== undefined) {
        qc.setQueryData(detailKey, ctx.prevDetail);
      }
    },
    onSettled: () => {
      // Refresh the trip row so the persisted mode is the source of
      // truth on the next render. The optimize call already
      // invalidated trip_legs + trip_places via its own onSuccess —
      // we don't need to duplicate that here.
      qc.invalidateQueries({ queryKey: detailKey });
    },
  });
}
