import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { TIER1_MUTATION_NETWORK_MODE, tier1SuccessResult } from './_tier1Facade';
import { use$ } from '@legendapp/state/react';
import { z } from 'zod';
import { supabase } from './supabase';
import type { CreateTripPlaceInput, TripPlace, Uuid } from './types';
// Phase 20 Step 6: hoisted to `./_keys` to break the
// `trip-places <-> routes` circular import. Re-exported below so existing
// `import { tripPlacesKeys } from './trip-places'` call sites keep working.
import { tripsKeys, tripPlacesKeys, tripLegsKeys } from './_keys';
import {
  createPlace as syncCreatePlace,
  isTier1SyncActive,
  tombstonePlace as syncTombstonePlace,
  updatePlace as syncUpdatePlace,
  type PlaceWritePatch,
} from '@/sync/mutations';
import { resyncTier1 } from '@/sync/hydrate';
import { compareNullableNumbersAsc } from '@/sync/order';
import { tier1Store$ } from '@/sync/store';
import { getSessionUndoStack } from '@/sync/undo';

export { tripPlacesKeys };

// v2 S2.8.5: rank-aware DISPLAY ordering lives in src/sync/order.ts (pure,
// Edge-rule-mirrored — see its binding cross-reference header). Re-exported
// here so UI consumers (ItineraryTab / route-shell stateKey, S2.8.7) can
// import it from the same module as `useTripPlaces`. The facade below does
// NOT apply it: this hook doesn't know `route_render_mode`, and its contract
// is today's SQL order (day_index nulls-first, then order_in_day).
export { orderDayPlacesByRank, orderPlacesForDisplay } from '@/sync/order';
export type { DisplayOrderablePlace } from '@/sync/order';

const createTripPlaceSchema = z.object({
  trip_id: z.string().uuid(),
  google_place_id: z.string().min(1),
  user_title: z.string().max(200).nullish(),
  category: z.string().max(80).nullish(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  visit_duration_minutes: z.number().int().positive().max(24 * 60).default(60),
  notes: z.string().max(2000).nullish(),
});

// ============================================================
// v2 S2.8.5 / S2.8.6 — Tier-1 sync facade (reads + write repoint)
// ============================================================
//
// Mirrors the S2.8.3/S2.8.4 facade in ./trips.ts (Wave B1 — read its header
// for the full rationale; only the deltas are documented here):
//
//   - `useTripPlaces` serves from `tier1Store$.tripPlaces` iff the engine is
//     ACTIVE and the places root HAS ROWS; otherwise the v1 TanStack queryFn
//     (byte-identical, paused via `enabled` — never unmounted) serves,
//     including the D2 hydration window for v1-migration users.
//   - Hooks are always called in the same order; only RETURNED VALUES branch.
//   - The store selector filters `deleted !== true` — the hydration engine
//     DELIBERATELY pulls tombstones (fieldDeleted consumption is how remote
//     deletes replicate), so the read facade must apply the same filter the
//     v1 queryFn applies in SQL (`eq('deleted', false)`, S2.8.1).
//   - Subscription granularity: the places root is a FLAT Record<placeId,
//     row> — there is no per-trip node to track, so `use$` tracks the table
//     root (still per-TABLE: other store roots never re-render this hook).
//     A sibling trip's place change does re-run the selector; accepted —
//     rows are per-user-small and the alternative (per-trip index nodes)
//     would change the store shape S2.2 shipped.
//   - Writes are gated on the SAME condition as reads (B1's rule: exactly
//     one source renders, and exactly that source is written): update /
//     delete on the PLACE ROW being in the store (`tier1PlaceRow`), create
//     on the places root having rows at all. Create deliberately does NOT
//     gate on the parent trip row: reads here serve from the places root,
//     so a sync-create into an empty, still-hydrating places root would
//     flip THIS facade to a one-place list while the trip's real places are
//     still in flight — the same D2 bug B1's create gate exists to prevent.
//   - TanStack invalidations KEEP FIRING in both branches (B1's documented
//     decision): flag-off they are load-bearing v1 behavior; flag-on the
//     facade's query is disabled while Tier-1 serves, so invalidation just
//     marks it stale (no fetch) and keeps the D2 fallback cache + the
//     degraded-client persister coherent; shared Tier-2 keys (trip detail,
//     trip_legs) still NEED them flag-on.

/**
 * The place row as hydrated into the Tier-1 store, IF the engine is active.
 * Write hooks use it to decide sync-vs-legacy: a present row means the store
 * is hydrated and Tier-1 is serving reads, so the write must land in the
 * store (and a missing row means `mutations.updatePlace`/`tombstonePlace`
 * would throw `row_not_found` anyway — legacy is the only correct path).
 */
function tier1PlaceRow(placeId: Uuid): TripPlace | undefined {
  if (!isTier1SyncActive()) return undefined;
  return tier1Store$.tripPlaces[placeId]?.peek();
}

/** Has the places root hydrated (or locally created) at least one row? */
function tier1PlacesStoreHasRows(): boolean {
  const record = tier1Store$.tripPlaces.peek();
  return record != null && Object.keys(record).length > 0;
}

/**
 * Dress a Tier-1 store row for a mutation's RETURN value. Unacked local
 * creates omit `created_at`/`updated_at` (created_at absence is the sync
 * plugin's create/update discriminator — it must NEVER be set client-side);
 * the placeholders below exist ONLY in this return value so it satisfies the
 * TripPlace contract for callers. Nothing here writes them back into the
 * store. (Mirrors useCreateTrip's dressing in ./trips.ts.)
 */
function dressTier1PlaceReturn(row: TripPlace): TripPlace {
  const nowIso = new Date().toISOString();
  return {
    ...row,
    created_at: (row.created_at as string | undefined) ?? nowIso,
    updated_at: (row.updated_at as string | undefined) ?? nowIso,
  };
}

/**
 * Sort contract shared with the v1 queryFn: `day_index` asc NULLS FIRST,
 * then `order_in_day` asc NULLS FIRST (the SQL ORDER BY, verbatim). SQL
 * leaves further ties unordered; the store branch needs determinism for
 * stable RN list keys, so ties break on `created_at` asc (insertion order —
 * what PostgREST physically tends to return; a just-added Idea lands at the
 * end of its group). Unacked local creates omit `created_at` and sort LAST
 * within the tie group (they are the newest), then id asc.
 */
function compareTier1TripPlaces(a: TripPlace, b: TripPlace): number {
  const dayCmp = compareNullableNumbersAsc(a.day_index, b.day_index, 'first');
  if (dayCmp !== 0) return dayCmp;
  const orderCmp = compareNullableNumbersAsc(a.order_in_day, b.order_in_day, 'first');
  if (orderCmp !== 0) return orderCmp;
  // `created_at` is typed required because hydrated rows always carry it;
  // the casts acknowledge the unacked-local-create exception above.
  const aCreated = a.created_at as string | undefined;
  const bCreated = b.created_at as string | undefined;
  if (aCreated === undefined || bCreated === undefined) {
    if (aCreated !== undefined) return -1; // b is the local create → b last
    if (bCreated !== undefined) return 1; // a is the local create → a last
    return a.id.localeCompare(b.id);
  }
  const cmp = aCreated.localeCompare(bCreated);
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

/**
 * Pure Tier-1 selector — reproduces the v1 `useTripPlaces` queryFn contract
 * (per-trip filter, live rows only, SQL sort order) over the hydrated store
 * record. Exported for the parity/property suite (like ./trips.ts's
 * `selectTier1Trips`): feed it a fixture record and compare against the
 * queryFn's shape on the same rows.
 *
 * Rows are shallow-copied: `.get()` hands back the store's underlying
 * objects, and a consumer mutating one in place would silently corrupt the
 * sync-attached store (bypassing observable setters — the change would
 * neither notify nor sync, then be clobbered by the next merge).
 */
export function selectTier1TripPlaces(
  record: Record<string, TripPlace>,
  tripId: Uuid,
): TripPlace[] {
  const out: TripPlace[] = [];
  for (const row of Object.values(record)) {
    if (!row || row.trip_id !== tripId) continue;
    // The engine pulls tombstones on purpose (remote-delete replication) —
    // this is the store-side equivalent of the queryFn's eq('deleted', false).
    if (row.deleted === true) continue;
    out.push({ ...row });
  }
  return out.sort(compareTier1TripPlaces);
}

// tier1SuccessResult: hoisted to ./_tier1Facade (M4 X2.5) — shared by all four facades.

export function useTripPlaces(tripId: Uuid | undefined): UseQueryResult<TripPlace[], Error> {
  // [Hook 1/2] Tier-1 selector. The places root is read FIRST so it is
  // tracked from the very first render — the first hydration write (network
  // pull, disk persist load, or realtime merge) is what flips the facade.
  // Flat-record store ⇒ root-level tracking is the narrowest available (see
  // the facade header). A zero-place account never flips to Tier-1 — the
  // TanStack branch serves its (authoritative, empty) server result, the
  // conservative side of D2.
  const tier1Places = use$((): TripPlace[] | null => {
    const record = tier1Store$.tripPlaces.get();
    if (!tripId) return null;
    const hasRows = record != null && Object.keys(record).length > 0;
    if (!hasRows || !isTier1SyncActive()) return null; // → fallback branch
    return selectTier1TripPlaces(record, tripId);
  });
  const tier1Serves = tier1Places !== null;

  // [Hook 2/2] The v1 query — queryFn byte-identical, paused (not unmounted)
  // while Tier-1 serves so its cache stays warm for the D2 fallback and the
  // degraded-client persister.
  const query = useQuery<TripPlace[]>({
    queryKey: tripId ? tripPlacesKeys.forTrip(tripId) : ['trip-places', 'none'],
    enabled: Boolean(tripId) && !tier1Serves,
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_places')
        .select('*')
        .eq('trip_id', tripId)
        // v2 S2.8.1: exclude soft-delete tombstones (deleted = true,
        // migration 0027 — NOT NULL DEFAULT false). Once flag-on web
        // clients tombstone instead of hard-deleting, this filter is what
        // keeps flag-off / fallback readers from resurrecting deleted
        // places. Keep in lockstep with the analytics useQueries queryFn
        // (app/(app)/analytics.tsx) — it shares this exact query key —
        // AND with selectTier1TripPlaces above (the store-branch filter).
        .eq('deleted', false)
        .order('day_index', { ascending: true, nullsFirst: true })
        .order('order_in_day', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as TripPlace[];
    },
  });

  if (!tier1Serves) return query;
  return tier1SuccessResult(query, tier1Places as TripPlace[]);
}

export function useCreateTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, CreateTripPlaceInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = createTripPlaceSchema.parse(input);
      // S2.8.6: sync-create only when the places root is already serving
      // reads (has rows) — the same gate as useCreateTrip (B1), for the same
      // D2 reason: a create into an empty, still-hydrating root would flip
      // the read facade to a one-place list while the trip's other places
      // are still in flight. Until first hydration, creates ride the legacy
      // path the reads are also serving from; the engine's incremental pull
      // picks the new row up. This is also what guarantees the add-flow
      // dedupe (add.tsx reads useTripPlaces) sees optimistic creates: when
      // the create lands in the store, the facade is by definition serving
      // from that store.
      if (isTier1SyncActive() && tier1PlacesStoreHasRows()) {
        // Offline-safe optimistic create: the row is in the local store (and
        // every useTripPlaces consumer, via the facade) synchronously; the
        // engine queues the INSERT. created_at/updated_at are NEVER set on
        // the store row (created_at absence is the plugin's create/update
        // discriminator). day_index/order_in_day start NULL (Ideas) — they
        // are server-domain (C1) and the optimizer assigns them.
        const id = syncCreatePlace({
          trip_id: parsed.trip_id,
          google_place_id: parsed.google_place_id,
          lat: parsed.lat,
          lng: parsed.lng,
          user_title: parsed.user_title ?? null,
          category: parsed.category ?? null,
          visit_duration_minutes: parsed.visit_duration_minutes,
          notes: parsed.notes ?? null,
        });
        const row = tier1Store$.tripPlaces[id]?.peek() as TripPlace; // just written — present
        return dressTier1PlaceReturn(row);
      }
      const { data, error } = await supabase
        .from('trip_places')
        .insert(parsed)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      // Fires in both branches — load-bearing flag-off; flag-on it marks the
      // paused facade query stale (no fetch while disabled) and keeps the D2
      // fallback cache coherent. tripsKeys.detail stays Tier-2-relevant in
      // both branches. See the facade header's invalidation note.
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

export function useDeleteTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, { id: Uuid; trip_id: Uuid }>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ id }) => {
      // S2.8.6 (binding): flag-on + row hydrated, delete becomes a TOMBSTONE
      // through the sync layer (offline-safe; the engine emits
      // UPDATE … SET deleted = true, which replicates through incremental
      // pulls — a hard DELETE leaves no row to carry the fact). The returned
      // UndoEntry goes onto the session undo stack: this is case 1 of the
      // S2.5 catalog ("Place remove"), the primary S2.8.8 UndoToast trigger.
      // Its inverse un-tombstones (deleted: false — the row still exists
      // server-side).
      if (tier1PlaceRow(id)) {
        // Captured BEFORE the tombstone so the return value mirrors the
        // legacy branch's payload (the row as it was at delete time,
        // deleted: false).
        const prev = tier1Store$.tripPlaces[id]?.peek() as TripPlace; // present — gate just checked
        getSessionUndoStack().push(syncTombstonePlace(id));
        return dressTier1PlaceReturn(prev);
      }
      // Legacy hard delete (v1, byte-identical): flag-off clients keep it —
      // no tombstones exist for them, and S2.8.1's read filters protect them
      // once flag-on web starts tombstoning. Accepted race (flag-on, row not
      // yet hydrated): the hard-deleted row could land in the store from an
      // in-flight pull and ghost until a realtime DELETE event clears it; do
      // NOT "fix" this with a store prune — for trip_places (fieldDeleted
      // configured) a store delete EMITS a tombstone UPDATE against a row
      // that no longer exists (infinite-retry fodder; see
      // pruneTripFromLocalStore's contract in hydrate.ts).
      const { data, error } = await supabase
        .from('trip_places')
        .delete()
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      // Both branches — see the facade header's invalidation note.
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
    },
  });
}

/**
 * v2 P1.1: time-of-day string accepted by Postgres `time` columns via
 * PostgREST — 'HH:MM' or 'HH:MM:SS', 24h. Reads come back as 'HH:MM:SS'.
 */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM or HH:MM:SS (24h)');

const updateTripPlaceSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  user_title: z.string().max(200).nullish(),
  category: z.string().max(80).nullish(),
  visit_duration_minutes: z.number().int().positive().max(24 * 60).optional(),
  notes: z.string().max(2000).nullish(),
  // v2 P1.1 (migration 0023): user-confirmed visiting window. `null`
  // clears the bound (nullish + the undefined-filter below = omitted keys
  // stay untouched, explicit nulls clear). ToS invariant: these are USER
  // input only — never programmatically copy Google opening hours into
  // them (live hours are Tier-2 memory-only; see docs/v2/risks-and-
  // decisions.md). The cross-field rule `leave_before > arrive_after`
  // (when both set) is enforced by the DB CHECK — a partial update can't
  // see the other column's current value here, so the constraint error
  // surfaces through the mutation's onError instead.
  arrive_after: timeOfDaySchema.nullish(),
  leave_before: timeOfDaySchema.nullish(),
  // T1 (migration 0025): user-pinned arrival. Same semantics as the window
  // bounds: omitted = untouched, explicit null = clear the pin. Same ToS
  // invariant — user input only, never derived from Google data.
  pinned_start: timeOfDaySchema.nullish(),
  // M5 (migration 0035): per-leg mode override for the leg ARRIVING at this
  // place, + optional user minutes for it. Lockstep with
  // trip_places_arrival_mode_check / _arrival_minutes_check (and the
  // mutation-layer guard). Omitted = untouched; null = back to "inherit".
  // Clear both together when removing an override.
  arrival_mode: z.enum(['driving', 'walking', 'bicycling', 'transit', 'flight', 'ferry']).nullish(),
  arrival_minutes: z.number().int().min(1).max(24 * 60).nullish(),
});

type UpdateTripPlaceInput = z.infer<typeof updateTripPlaceSchema>;

export function useUpdateTripPlace() {
  const qc = useQueryClient();
  return useMutation<TripPlace, Error, UpdateTripPlaceInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = updateTripPlaceSchema.parse(input);
      const { id, trip_id: _tripId, ...patch } = parsed;
      const payload = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      // S2.8.6: sync write when the row is hydrated (every key this schema
      // can produce is in the mutation layer's PLACE_PATCH_FIELDS allowlist,
      // so the cast is shape-safe). The UndoEntry is DISCARDED — mirrors
      // useUpdateTrip (B1): the S2.5 five-case catalog has no generic-edit
      // case (place remove / day reassign / reorder / optimize / AI-apply
      // are the catalog; duration-notes-windows edits are not), and stacking
      // every keystroke-debounced notes write would evict the entries users
      // actually want to undo. One DB-contract caveat, sync branch only: a
      // 'HH:MM' time lands in the store verbatim until the server ack merges
      // back the canonical 'HH:MM:SS' — harmless (LWW echo of the same
      // value), noted for anyone diffing store snapshots in tests.
      if (tier1PlaceRow(id)) {
        syncUpdatePlace(id, payload as PlaceWritePatch);
        const row = tier1Store$.tripPlaces[id]?.peek() as TripPlace; // present — gate just checked
        return dressTier1PlaceReturn(row);
      }
      const { data, error } = await supabase
        .from('trip_places')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      // Both branches — see the facade header's invalidation note.
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

export function useReorderDay() {
  const qc = useQueryClient();
  return useMutation<
    { rowsUpdated: number },
    Error,
    { tripId: Uuid; dayIndex: number; orderedIds: Uuid[] }
  >({
    mutationFn: async ({ tripId, dayIndex, orderedIds }) => {
      const { data, error } = await supabase.rpc('apply_manual_day_order', {
        p_trip_id: tripId,
        p_day_index: dayIndex,
        p_ordered_ids: orderedIds,
      });
      if (error) throw error;
      return { rowsUpdated: (data as number | null) ?? 0 };
    },
    onSuccess: (_res, { tripId }) => {
      // S2.8.6 / D5: this RPC stays legacy permanently (order_in_day is
      // server-domain, C1) and S2.8.7 retires its flag-on call sites
      // entirely (flag-on drag = manual_rank writes). Defense-in-depth for
      // the window until then (and any call site S2.8.7 misses): flag-on,
      // converge the store on the server-side order rewrite — same
      // rationale as useMoveToDay below.
      if (isTier1SyncActive()) resyncTier1();
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(tripId) });
      qc.invalidateQueries({ queryKey: tripLegsKeys.forTrip(tripId) });
    },
  });
}

export function useMoveToDay() {
  const qc = useQueryClient();
  return useMutation<
    TripPlace,
    Error,
    { id: Uuid; tripId: Uuid; toDayIndex: number; positionInDay?: number }
  >({
    mutationFn: async ({ id, tripId, toDayIndex, positionInDay }) => {
      let nextPos = positionInDay;
      if (nextPos === undefined) {
        const { data: existing } = await supabase
          .from('trip_places')
          .select('order_in_day')
          .eq('trip_id', tripId)
          .eq('day_index', toDayIndex)
          // v2 S2.8.1: tombstoned rows must not inflate the appended
          // position — the moved place should land right after the last
          // LIVE place of the target day.
          .eq('deleted', false);
        const max = (existing ?? []).reduce<number>(
          (m, r) => Math.max(m, (r as { order_in_day: number | null }).order_in_day ?? -1),
          -1,
        );
        nextPos = max + 1;
      }
      const { data, error } = await supabase
        .from('trip_places')
        .update({ day_index: toDayIndex, order_in_day: nextPos })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as TripPlace;
    },
    onSuccess: (row) => {
      // S2.8.6 / D5: day_index is SERVER-domain (C1), so move-to-day stays
      // on the legacy PostgREST path even flag-on — it cannot route through
      // mutations.ts (day_index is not client-writable). The server write
      // bumps updated_at via handle_times(), so flag-on we force an
      // incremental pull to converge the store promptly (mirrors
      // useDuplicateTrip in ./trips.ts — waiting on realtime alone is not
      // reliable across disconnects; hydrate.ts header). Online-only by
      // construction: flag-on + offline, S2.8.7 disables the move-to-day
      // affordances with a hint.
      if (isTier1SyncActive()) resyncTier1();
      qc.invalidateQueries({ queryKey: tripPlacesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripLegsKeys.forTrip(row.trip_id) });
    },
  });
}
