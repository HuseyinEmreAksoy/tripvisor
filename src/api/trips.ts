import { keepPreviousData, onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { TIER1_MUTATION_NETWORK_MODE, tier1SuccessResult } from './_tier1Facade';
import { EdgeFunctionError, tryParseEdgeFunctionError } from './_errors';
import { use$ } from '@legendapp/state/react';
import { z } from 'zod';
import { supabase } from './supabase';
import type {
  CreateTripInput,
  RouteRenderMode,
  Trip,
  TripCollaboratorRole,
  Uuid,
} from './types';
import { tripsKeys, tripExpensesKeys, tripCollaboratorsKeys } from './_keys';
import { useOptimizeTrip } from './routes';
import {
  createTrip as syncCreateTrip,
  isTier1SyncActive,
  tombstoneTrip as syncTombstoneTrip,
  updateTrip as syncUpdateTrip,
} from '@/sync/mutations';
import { getTier1SyncUserId, pruneTripFromLocalStore, resyncTier1 } from '@/sync/hydrate';
import { tier1Store$ } from '@/sync/store';
import { getSessionUndoStack } from '@/sync/undo';

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

// ============================================================
// v2 S2.8.3 / S2.8.4 — Tier-1 sync facade (reads + write repoint)
// ============================================================
//
// `useTrips` / `useTrip` are now FACADES over two data sources:
//
//   1. The Tier-1 Legend-State store (`tier1Store$.trips`) — served when the
//      sync engine is ACTIVE (flag on + initialized, `isTier1SyncActive()`)
//      AND the trips root has hydrated at least one row.
//   2. The v1 TanStack queryFn (unchanged, byte-identical flag-off) — served
//      otherwise, including the D2 hydration window: a v1 user whose
//      persisted TanStack cache restored but whose Tier-1 store hasn't
//      finished its first pull must keep seeing cached trips, never an empty
//      (or partial) list.
//
// Rules-of-Hooks discipline (the plan's flagged High risk): every hook below
// is called UNCONDITIONALLY in the same order on every render — the facade
// branches only on RETURNED VALUES. The legacy query stays mounted with
// `enabled` gated off while Tier-1 serves, so its cache survives for
// fallback transitions and the persister.
//
// Hydration signal: "store has rows" (read INSIDE the `use$` selector so the
// trips root is tracked and the facade re-renders the instant hydration —
// network pull, disk persist load, or realtime merge — lands rows). This is
// the reactive equivalent of telemetry's `entities.trips.lastSyncAt`: both
// flip on the first store change, but the store read is per-table (no
// re-render on unrelated entity telemetry) and race-free (no listener-order
// dependency between telemetry's onChange and ours). A zero-trip account
// never flips to Tier-1 — the TanStack branch serves its (authoritative,
// empty) server result, which is the conservative side of D2.
//
// Write gating (S2.8.4): update-shaped hooks route through src/sync/mutations
// when THE ROW IS IN THE STORE (`tier1TripRow`), creates when the store has
// rows at all — i.e. writes go sync only when reads are Tier-1-served. This
// is deliberately stricter than bare `isTier1SyncActive()`: a sync-create
// into an empty, still-hydrating store would flip the read facade and render
// a one-trip list while the user's other trips are still in flight (the
// exact D2 bug the fallback exists to prevent). Exactly one source renders,
// and exactly that source is written.
//
// TanStack invalidations KEEP FIRING on every mutation, both branches:
//   - flag-off they are load-bearing (v1 behavior, byte-identical);
//   - flag-on the facade's list/detail queries are disabled while Tier-1
//     serves, so invalidation just marks them stale (no fetch) — cheap, and
//     it keeps the D2 fallback cache + degraded-client persister coherent;
//   - shared Tier-2 keys (trip-expenses rollup after a budget write) still
//     NEED them flag-on.

/**
 * The trip row as hydrated into the Tier-1 store, IF the engine is active.
 * Used by the write hooks to decide sync-vs-legacy: a present row means the
 * store is hydrated and Tier-1 is serving reads, so the write must land in
 * the store (and a missing row means `mutations.updateTrip` would throw
 * `row_not_found` anyway — legacy is the only correct path).
 */
function tier1TripRow(tripId: Uuid): Trip | undefined {
  if (!isTier1SyncActive()) return undefined;
  return tier1Store$.trips[tripId]?.peek();
}

/** Has the trips root hydrated (or locally created) at least one row? */
function tier1TripsStoreHasRows(): boolean {
  const record = tier1Store$.trips.peek();
  return record != null && Object.keys(record).length > 0;
}

/**
 * Sort contract shared with the v1 queryFn (step 5 there): owner-trips
 * first, then `created_at` desc, then id asc for deterministic RN list keys.
 *
 * One Tier-1-only extension: locally-created rows that haven't been acked
 * yet OMIT `created_at` (its absence is the sync plugin's create/update
 * discriminator — it must never be set client-side), and they sort NEWEST:
 * a trip the user just created belongs at the top of a descending list.
 */
function compareTier1Trips(a: Trip, b: Trip): number {
  if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
  // `created_at` is typed required because hydrated rows always carry it;
  // the casts acknowledge the unacked-local-create exception above.
  const aCreated = a.created_at as string | undefined;
  const bCreated = b.created_at as string | undefined;
  if (aCreated === undefined || bCreated === undefined) {
    if (aCreated !== undefined) return 1; // b is the local create → b first
    if (bCreated !== undefined) return -1; // a is the local create → a first
    return a.id.localeCompare(b.id);
  }
  const cmp = bCreated.localeCompare(aCreated);
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

/**
 * Pure Tier-1 list selector — reproduces the v1 `useTrips` queryFn contract
 * (archived partition on `archived_at`, `{ isOwner, collaboratorRole }`
 * tagging, owner-first sort) over the hydrated store record. Exported for
 * tests: feed it a fixture record and compare against the queryFn's shape.
 *
 * `roleByTripId` comes from the Tier-2 collaborators query; while it is
 * unknown (offline, still fetching) non-owner rows degrade to
 * `collaboratorRole: null` — the viewer-safe value (`useTripRole` treats
 * null as no-permissions).
 */
export function selectTier1Trips(
  record: Record<string, Trip>,
  opts: {
    archived: boolean;
    callerId: string | null;
    roleByTripId: Partial<Record<Uuid, TripCollaboratorRole>> | undefined;
  },
): Trip[] {
  const { archived, callerId, roleByTripId } = opts;
  const out: Trip[] = [];
  for (const row of Object.values(record)) {
    if (!row) continue;
    if ((row.archived_at != null) !== archived) continue;
    // Unacked local creates omit user_id (stamped server-side at the write
    // boundary) — only the engine user's own store can contain such a row,
    // so it backfills to the caller. Hydrated rows always carry it.
    const ownerId = (row.user_id as Uuid | undefined) ?? (callerId as Uuid | null);
    const isOwner = callerId !== null && ownerId === callerId;
    out.push({
      ...row,
      ...(ownerId !== null ? { user_id: ownerId } : {}),
      isOwner,
      collaboratorRole: isOwner ? null : roleByTripId?.[row.id] ?? null,
    });
  }
  return out.sort(compareTier1Trips);
}

// tier1SuccessResult: hoisted to ./_tier1Facade (M4 X2.5) — shared by all four facades.

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
export function useTrips(opts: UseTripsOptions = {}): UseQueryResult<Trip[], Error> {
  const archived = opts.archived ?? false;

  // [Hook 1/3] Caller's accepted-collaborator role map for the Tier-1
  // branch's `collaboratorRole` tagging. Collaborators are Tier-2 — they
  // stay on TanStack permanently (not in the sync allowlist's write slice),
  // which is why this is a separate query instead of a store read. Disabled
  // until the engine is active (flag-off: zero behavior change, never
  // fetches); while its data is unknown the selector degrades non-owner
  // rows to the viewer-safe `collaboratorRole: null`.
  const rolesQuery = useQuery<Partial<Record<Uuid, TripCollaboratorRole>>>({
    // Key sits under the trip-collaborators prefix so the existing blanket
    // invalidations in trip-collaborators.ts (invite accept/revoke) refresh
    // it without new wiring.
    queryKey: [...tripCollaboratorsKeys.all, 'my-roles'],
    enabled: isTier1SyncActive(),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const callerId = userData.user?.id;
      if (!callerId) return {};
      const { data, error } = await supabase
        .from('trip_collaborators')
        .select('trip_id, role')
        .eq('user_id', callerId)
        .eq('status', 'accepted');
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((r) => [r.trip_id as Uuid, r.role as TripCollaboratorRole]),
      ) as Partial<Record<Uuid, TripCollaboratorRole>>;
    },
  });
  const roleByTripId = rolesQuery.data;

  // [Hook 2/3] Tier-1 selector. `use$` re-runs the selector on every render
  // (fresh `archived` / `roleByTripId` closures) and re-renders when a
  // TRACKED observable changes; the trips root is read FIRST so it is
  // tracked even while the engine is still booting — the first hydration
  // write is what flips the facade. Tracking is per-table: changes to other
  // store roots (places, expenses, …) never re-render this hook.
  const tier1Trips = use$((): Trip[] | null => {
    const record = tier1Store$.trips.get();
    const hasRows = record != null && Object.keys(record).length > 0;
    if (!hasRows || !isTier1SyncActive()) return null; // → fallback branch
    return selectTier1Trips(record, {
      archived,
      callerId: getTier1SyncUserId(),
      roleByTripId,
    });
  });
  const tier1Serves = tier1Trips !== null;

  // [Hook 3/3] The v1 query — queryFn byte-identical, paused (not unmounted)
  // while Tier-1 serves so its cache stays warm for the D2 fallback.
  const query = useQuery<Trip[]>({
    queryKey: tripsKeys.list({ archived }),
    enabled: !tier1Serves,
    // M4 X2.5 follow-up: flipping Active ⇄ Archived changes the key; without
    // this the list flashes a loading state on the first visit to the other
    // tab. The previous tab's rows stay on screen (`isPlaceholderData: true`
    // while they do) until the new list lands. Tier-1-served lists never hit
    // this — the store selector re-partitions synchronously.
    placeholderData: keepPreviousData,
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

  if (!tier1Serves) return query;
  return tier1SuccessResult(query, tier1Trips as Trip[]);
}

export function useTrip(id: Uuid | undefined): UseQueryResult<Trip | null, Error> {
  // [Hook 1/2] Tier-1 row selector — tracks ONLY this trip's store node
  // (not the trips root), so a detail screen re-renders on changes to its
  // own row and on the hydration write that first creates it, never on
  // sibling-trip churn. Hydration-aware fallback is per-row here: a missing
  // row (engine off, store still pulling, or an archived trip evicted from
  // a stale cache) falls through to the server fetch.
  const tier1Trip = use$((): Trip | null => {
    if (!id) return null;
    // Read BEFORE the active-check so the node is tracked from first render.
    const row = tier1Store$.trips[id]?.get();
    if (!row || !isTier1SyncActive()) return null; // → fallback branch
    // v1 contract: detail rows carry no isOwner/collaboratorRole tagging
    // (consumers are defensive per the Trip type docs). Only backfill the
    // unacked-local-create gap: user_id is absent until the server ack
    // merges it, and `useTripRole` derives ownership from it.
    const userId = (row.user_id as Uuid | undefined) ?? (getTier1SyncUserId() as Uuid | null);
    return userId !== null && userId !== row.user_id ? { ...row, user_id: userId } : row;
  });
  const tier1Serves = tier1Trip !== null;

  // [Hook 2/2] The v1 detail query — queryFn byte-identical, paused while
  // Tier-1 serves.
  const query = useQuery<Trip | null>({
    queryKey: id ? tripsKeys.detail(id) : ['trips', 'detail', 'none'],
    enabled: Boolean(id) && !tier1Serves,
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

  if (!tier1Serves) return query;
  return tier1SuccessResult<Trip | null>(query, tier1Trip);
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation<Trip, Error, CreateTripInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = createTripSchema.parse(input);
      // S2.8.4: sync-create only when the store is already serving reads
      // (has rows) — see the facade header for why bare isTier1SyncActive()
      // is not enough (a create into an empty, still-hydrating store would
      // flip the read facade to a one-trip list). Until first hydration,
      // creates ride the legacy path the reads are also serving from; the
      // engine's incremental pull picks the new row up.
      if (isTier1SyncActive() && tier1TripsStoreHasRows()) {
        // Offline-safe optimistic create: the row is in the local store (and
        // the trips list, via the facade) synchronously; the engine queues
        // the INSERT. created_at/updated_at/user_id are NEVER set on the
        // store row — created_at absence is the plugin's create/update
        // discriminator, and user_id is stamped at the write boundary.
        const id = syncCreateTrip({
          title: parsed.title,
          start_date: parsed.start_date ?? null,
          end_date: parsed.end_date ?? null,
          daily_hours_budget: parsed.daily_hours_budget,
          transport_mode: parsed.transport_mode,
          timezone: parsed.timezone ?? null,
        });
        const row = tier1Store$.trips[id]?.peek() as Trip; // just written — present
        // The placeholders below exist ONLY in this RETURN value so it
        // satisfies the Trip contract for callers (every current caller —
        // new.tsx, useSampleTrip, useAiDraftCommit — reads just `trip.id`).
        // Nothing here writes them back into the store.
        const nowIso = new Date().toISOString();
        return {
          ...row,
          user_id: (row.user_id as Uuid | undefined) ?? ((getTier1SyncUserId() ?? '') as Uuid),
          created_at: (row.created_at as string | undefined) ?? nowIso,
          updated_at: (row.updated_at as string | undefined) ?? nowIso,
        };
      }
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
      // Fires in both branches — load-bearing flag-off; flag-on it marks the
      // paused facade queries stale (no fetch while disabled) and keeps the
      // D2 fallback cache coherent. See the facade header's invalidation note.
      qc.invalidateQueries({ queryKey: tripsKeys.all });
    },
  });
}

/**
 * Typed failure of the `delete-trip` Edge Function. Branch on `.code`:
 *   - `not_owner`              — 403 — only the owner may delete a trip
 *   - `not_authenticated`      — 401 — no / expired session
 *   - `storage_cleanup_failed` — 500 — documents couldn't be removed; the
 *                                trip was NOT deleted, retrying is safe
 *   - `invalid_input` 400 · `db_error` / `internal_error` 500
 * (`not_found` never surfaces — `useDeleteTrip` treats it as success.)
 * Non-envelope failures (network, gateway) are rethrown as-is.
 */
export class DeleteTripError extends EdgeFunctionError {
  constructor(code: string, message: string, status: number) {
    super(code, message, status);
    this.name = 'DeleteTripError';
  }
}

/** `delete-trip` success body (contractVersion 1). */
export interface DeleteTripResult {
  ok: true;
  tripId: Uuid;
  /** false = the row was already gone (deleted elsewhere) — still success. */
  deleted: boolean;
  storage: { objectsRemoved: number };
  meta: { contractVersion: number };
}

/**
 * Hard-delete a trip. Per decision D5 this stays OFF the sync engine even
 * flag-on: trips have no tombstone column by design (0027 — archive is their
 * lifecycle), so a hard delete is an online-only destructive op.
 *
 * Security audit #13: the delete goes through the `delete-trip` Edge
 * Function instead of a direct PostgREST delete, because Postgres cascades
 * never reach Storage — the trip's `trip-docs/<tripId>/…` uploads were left
 * orphaned. The function is owner-only, removes the Storage objects first,
 * then deletes the row (cascade) under the caller's JWT.
 *
 * Idempotent like the old PostgREST path (which "succeeded" with 0 rows): a
 * typed `not_found` (trip already gone, or never visible to this user) is
 * treated as success so the local prune below still runs.
 */
export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, Uuid>({
    mutationFn: async (id) => {
      const { error } = await supabase.functions.invoke<DeleteTripResult>('delete-trip', {
        body: { tripId: id },
      });
      if (error) {
        const typed = await tryParseEdgeFunctionError(error, DeleteTripError);
        if (typed?.code === 'not_found') return id;
        throw typed ?? error;
      }
      return id;
    },
    onSuccess: (id) => {
      // D5: after the server ack, drop the hydrated row from the Tier-1
      // store WITHOUT a network echo (no delete action + no fieldDeleted for
      // trips — contract documented on pruneTripFromLocalStore). Incremental
      // pulls can never observe a hard DELETE (no row left to carry it), so
      // without this the trip would ghost in the flag-on list forever.
      // No-ops flag-off (the store never hydrated the row).
      pruneTripFromLocalStore(id);
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
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (tripId) => {
      // S2.8.4: flag-on (row hydrated) the archive is a sync write —
      // offline-safe, instant in the Tier-1 list, and UNDOABLE: the
      // tombstoneTrip entry (trips "tombstone" == archive; no deleted
      // column by design) goes onto the session undo stack, which is what
      // the S2.8.8 UndoToast surfaces.
      if (tier1TripRow(tripId)) {
        getSessionUndoStack().push(syncTombstoneTrip(tripId));
        return tripId;
      }
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
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (tripId) => {
      // S2.8.4: sync write when the row is hydrated. The returned UndoEntry
      // is deliberately DISCARDED — unarchive IS the inverse affordance (and
      // the undo of an archive); pushing it would stack noise.
      if (tier1TripRow(tripId)) {
        syncUpdateTrip(tripId, { archived_at: null }, 'Unarchive trip');
        return tripId;
      }
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
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (patch) => {
      // Empty patch is a no-op; avoid issuing a pointless UPDATE that would
      // still bump updated_at via the trigger.
      if (Object.keys(patch).length === 0) return tripId;
      // S2.8.4: sync write when the row is hydrated (UpdateTripPatch is a
      // strict subset of TripWritePatch, so this is shape-safe). The
      // UndoEntry is discarded — the S2.8 plan pushes undo only for archive
      // (above) and the D4 mode-switch (wired at the S2.8.7 call site);
      // generic metadata edits are not in the five-case undo catalog.
      // Editor-collaborator writes work identically: the engine syncs under
      // the user's JWT, so RLS + the column-restriction trigger still gate.
      if (tier1TripRow(tripId)) {
        syncUpdateTrip(tripId, patch);
        return tripId;
      }
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
      // D5: duplicate stays on the RPC (the clone is server-knowable only).
      // Flag-on, force an incremental pull so the cloned trip + its places
      // land in the Tier-1 store promptly (their fresh server-stamped
      // updated_at rides the changesSince watermark) instead of waiting for
      // the next realtime event or reconnect.
      if (isTier1SyncActive()) resyncTier1();
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
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (total_budget) => {
      // `null` is a meaningful value (clear the ceiling); we deliberately
      // do NOT short-circuit on `null` like we would on `undefined`.
      //
      // S2.8.4: sync write when the row is hydrated (undo discarded — not
      // in the five-case catalog). The onSettled invalidation of
      // tripExpensesKeys still fires below: the expense rollup is Tier-2
      // and needs it in BOTH branches.
      if (tier1TripRow(tripId)) {
        syncUpdateTrip(tripId, { total_budget }, 'Change budget');
        return tripId;
      }
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
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (mode) => {
      // S2.8.4: sync write when the row is hydrated — offline-safe, so a
      // flag-on offline toggle persists locally and queues; the optimize
      // re-render below then fails (no network) and is swallowed exactly
      // like the legacy best-effort path (the S2.8.7 pendingRecompute pill
      // covers the lag). UndoEntry discarded HERE: the D4 drag-triggered
      // mode-switch undo is wired at its S2.8.7 call site, not on every
      // settings toggle.
      if (tier1TripRow(tripId)) {
        syncUpdateTrip(tripId, { route_render_mode: mode }, 'Change route mode');
      } else {
        // Persist the new mode. RLS handles authorization (owner OR
        // editor-via-trips_editor_budget_update policy + the trigger
        // allow-list which now includes route_render_mode).
        const { error } = await supabase
          .from('trips')
          .update({ route_render_mode: mode })
          .eq('id', tripId);
        if (error) throw error;
      }

      // Immediately re-render legs with the new mode. Best-effort: a
      // failure here does NOT roll back the persisted mode (the user
      // can hit "Re-optimize" manually). We swallow the optimize error
      // for the mutation's success path so the toggle UX feels snappy
      // — but log it so observability + Sentry still see it.
      //
      // Offline (only reachable via the Tier-1 branch — the legacy UPDATE
      // above throws first): skip the optimize call. useOptimizeTrip keeps
      // TanStack's default networkMode 'online', so offline its mutateAsync
      // would PAUSE until reconnect and leave this (networkMode 'always')
      // mutation stuck pending. The persisted mode syncs on reconnect and
      // the S2.8.7 pendingRecompute pill covers the stale polyline.
      if (!onlineManager.isOnline()) return mode;
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
