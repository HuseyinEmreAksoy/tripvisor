// Tripvisor v2 Phase P2 (BUILD-LOG P2.2) — trip packing list client wrappers.
//
// Mirrors the pattern of `src/api/trip-place-comments.ts`:
//   - Zod schemas validate inputs client-side BEFORE the round trip (friendly
//     errors instead of opaque CHECK violations) and row shapes coming back.
//   - Query keys live in `./_keys` (`tripPackingKeys`).
//   - All hooks talk to the table directly under RLS via @supabase/supabase-js
//     — no Edge Function. The policies in
//     `0024_v2_packing_documents_storage.sql` are the only authorization gate
//     (SELECT viewer / INSERT+UPDATE+DELETE editor via user_can_access_trip).
//
// ToS / state-tier note: packing items are Tier-1-safe USER content (no
// Google data → no 30-day ceiling; offline-syncable later).
//
// Seeding: `useCreateTripPackingItems` is a BULK insert because the packing
// template (src/lib/packingSeed.ts) produces ~20-30 rows that must land in
// ONE statement (one network round trip, one RLS evaluation pass) — seeded
// rows carry `auto: true` so a future re-seed can replace only them.
//
// Delete model (M4 X2.5): TOMBSTONE (deleted = true) through the Tier-1 sync
// engine when it is serving; the v1 HARD delete otherwise (flag off / not yet
// hydrated). Every direct read filters deleted = false.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { use$ } from '@legendapp/state/react';
import { z } from 'zod';
import { supabase } from './supabase';
import type { Uuid } from './types';
import { tripPackingKeys } from './_keys';
import {
  TIER1_MUTATION_NETWORK_MODE,
  compareCreatedAtAscLocalLast,
  dressTier1Return,
  tier1SuccessResult,
} from './_tier1Facade';
import {
  createPackingItems as syncCreatePackingItems,
  isTier1SyncActive,
  tombstonePackingItem as syncTombstonePackingItem,
  updatePackingItem as syncUpdatePackingItem,
} from '@/sync/mutations';
import { tier1RootLoaded$ } from '@/sync/hydrate';
import { tier1Store$ } from '@/sync/store';
import { getSessionUndoStack } from '@/sync/undo';

// Re-export so consumers can import everything from `@/api`.
export { tripPackingKeys };

// ===========================================================================
// Types + Zod schemas (keep in lockstep with 0024_v2_packing_documents_storage.sql)
// ===========================================================================

export interface TripPackingItem {
  id: Uuid;
  trip_id: Uuid;
  label: string;
  /** Free-form grouping ("clothing", "toiletries", …); null renders as "other". */
  category: string | null;
  checked: boolean;
  /** true = seeded by the packing template; false = user-added. */
  auto: boolean;
  /**
   * v2 S2.1 (migration 0027): soft-delete tombstone for the offline sync
   * engine — supersedes the "hard delete until S2" stance in 0024. Written
   * `true` by the Tier-1 delete path since M4 X2.5. Optional on the type
   * because PACKING_SELECT_FIELDS does not request it (reads filter on it).
   */
  deleted?: boolean;
  created_at: string;
  updated_at: string;
}

const tripPackingItemRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  // Mirrors `check (char_length(label) between 1 and 120)`.
  label: z.string().min(1).max(120),
  category: z.string().min(1).max(60).nullable(),
  checked: z.boolean(),
  auto: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Explicit projection (never `*`) so the wire shape stays stable.
const PACKING_SELECT_FIELDS =
  'id, trip_id, label, category, checked, auto, created_at, updated_at';

const newPackingItemSchema = z.object({
  label: z
    .string()
    .min(1, 'Item label cannot be empty')
    .max(120, 'Item label is too long (max 120 characters)'),
  category: z.string().min(1).max(60).nullish(),
  auto: z.boolean().optional(),
});

const createTripPackingItemsSchema = z.object({
  tripId: z.string().uuid(),
  // 100 is a generous ceiling: the seed template caps at 30 and manual adds
  // arrive one at a time — anything bigger is a caller bug.
  items: z.array(newPackingItemSchema).min(1).max(100),
});

export type CreateTripPackingItemsInput = z.infer<typeof createTripPackingItemsSchema>;

export interface UpdateTripPackingItemInput {
  itemId: Uuid;
  /** Needed for optimistic cache surgery on the per-trip list. */
  tripId: Uuid;
  patch: {
    label?: string;
    category?: string | null;
    checked?: boolean;
  };
}

export interface DeleteTripPackingItemInput {
  itemId: Uuid;
  tripId: Uuid;
}

// ===========================================================================
// M4 X2.5 — Tier-1 sync facade (reads + write repoint)
// ===========================================================================
//
// Identical contract to the ./trip-expenses.ts facade (read its header):
// serving gate = engine active AND (packing root has rows OR its first
// remote load completed — `tier1RootLoaded$`); writes follow the same gate
// (create when serving, update/delete when the ROW is in the store); delete
// is a TOMBSTONE whose UndoEntry lands on the session undo stack; flag-off
// keeps v1 (hard delete) and every direct read filters `deleted = false`.
// Hook signatures are UNCHANGED.
//
// The optimistic TanStack cache surgery in update/delete stays in both
// branches: flag-off it IS the optimism; flag-on it only touches the paused
// fallback cache (the store write is already synchronous and optimistic).

/** The packing row in the Tier-1 store, IF the engine is active. */
function tier1PackingRow(itemId: Uuid): TripPackingItem | undefined {
  if (!isTier1SyncActive()) return undefined;
  return tier1Store$.tripPackingItems[itemId]?.peek();
}

/** Non-reactive twin of the read gate (for mutationFns). */
function tier1PackingServing(): boolean {
  if (!isTier1SyncActive()) return false;
  const record = tier1Store$.tripPackingItems.peek();
  const hasRows = record != null && Object.keys(record).length > 0;
  return hasRows || tier1RootLoaded$.tripPackingItems.peek() === true;
}

/** v1 ORDER BY created_at asc, label asc; unacked local creates last
 * (label, then id — so a locally-seeded batch renders alphabetically, like
 * the v1 single-statement seed whose rows share one timestamp). */
function compareTier1Packing(a: TripPackingItem, b: TripPackingItem): number {
  const cmp = compareCreatedAtAscLocalLast(a, b);
  if (cmp !== null && cmp !== 0) return cmp;
  const labelCmp = a.label.localeCompare(b.label);
  return labelCmp !== 0 ? labelCmp : a.id.localeCompare(b.id);
}

/**
 * Pure Tier-1 selector — the v1 `useTripPackingItems` queryFn contract
 * (per-trip, live rows only, created_at then label) over the store record.
 * Rows are shallow-copied so consumers can never mutate the synced store.
 */
export function selectTier1PackingItems(
  record: Record<string, TripPackingItem>,
  tripId: Uuid,
): TripPackingItem[] {
  const out: TripPackingItem[] = [];
  for (const row of Object.values(record)) {
    if (!row || row.trip_id !== tripId) continue;
    if (row.deleted === true) continue; // tombstones are pulled on purpose
    out.push({ ...row });
  }
  return out.sort(compareTier1Packing);
}

// ===========================================================================
// Hooks: reads
// ===========================================================================

/**
 * The whole packing checklist for a trip in ONE query. Ordered by
 * `created_at` then `label` so the seed batch (identical timestamps) renders
 * alphabetically and later manual adds append at the bottom. Grouping by
 * `category` is the UI's job (one list, client-side group-by).
 */
export function useTripPackingItems(
  tripId: Uuid | undefined,
): UseQueryResult<TripPackingItem[], Error> {
  // [Hook 1/2] Tier-1 selector (root + loaded flag tracked from first render).
  const tier1Items = use$((): TripPackingItem[] | null => {
    const record = tier1Store$.tripPackingItems.get();
    const loaded = tier1RootLoaded$.tripPackingItems.get();
    if (!tripId) return null;
    const hasRows = record != null && Object.keys(record).length > 0;
    if ((!hasRows && !loaded) || !isTier1SyncActive()) return null;
    return selectTier1PackingItems(record ?? {}, tripId);
  });
  const tier1Serves = tier1Items !== null;

  // [Hook 2/2] The v1 query — paused (not unmounted) while Tier-1 serves.
  const query = useQuery<TripPackingItem[]>({
    queryKey: tripId ? tripPackingKeys.forTrip(tripId) : [...tripPackingKeys.all, 'none'],
    enabled: Boolean(tripId) && !tier1Serves,
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_packing_items')
        .select(PACKING_SELECT_FIELDS)
        .eq('trip_id', tripId)
        // X2.5: flag-on clients tombstone — never resurrect deleted items on
        // the legacy path. Lockstep with selectTier1PackingItems.
        .eq('deleted', false)
        .order('created_at', { ascending: true })
        .order('label', { ascending: true });
      if (error) throw error;
      // List reads are cast (not hard-parsed) per project policy: an
      // unexpected extra column degrades to stale UI, not a crash.
      return (data ?? []) as TripPackingItem[];
    },
  });

  if (!tier1Serves) return query;
  return tier1SuccessResult(query, tier1Items as TripPackingItem[]);
}

// ===========================================================================
// Hooks: mutations
// ===========================================================================

interface PackingMutationContext {
  previousForTrip: TripPackingItem[] | undefined;
}

/**
 * BULK insert — one statement for N items. This is the seeding path
 * (`seedPackingList(...)` → ~20-30 rows with `auto: true`) AND the manual
 * single-add path (an array of one).
 *
 * Flag-on (root serving): the whole batch lands in the store through ONE
 * write (complete rows — the X2.5 seed-race mitigation) and the INSERTs are
 * queued offline-safe; the returned rows are the optimistic store rows.
 */
export function useCreateTripPackingItems() {
  const qc = useQueryClient();
  return useMutation<TripPackingItem[], Error, CreateTripPackingItemsInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const { tripId, items } = createTripPackingItemsSchema.parse(input);
      if (tier1PackingServing()) {
        const ids = syncCreatePackingItems(
          tripId,
          items.map((it) => ({ label: it.label, category: it.category ?? null, auto: it.auto ?? false })),
        );
        return ids.map((id) =>
          dressTier1Return(tier1Store$.tripPackingItems[id]?.peek() as TripPackingItem), // just written — present
        );
      }
      const rows = items.map((it) => ({
        trip_id: tripId,
        label: it.label,
        category: it.category ?? null,
        auto: it.auto ?? false,
      }));
      const { data, error } = await supabase
        .from('trip_packing_items')
        .insert(rows)
        .select(PACKING_SELECT_FIELDS);
      if (error) throw error;
      // Write results are hard-parsed: catching a drifted shape at the write
      // site is cheap and immediate.
      return z.array(tripPackingItemRowSchema).parse(data ?? []) as TripPackingItem[];
    },
    onSuccess: (_rows, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripPackingKeys.forTrip(tripId) });
    },
  });
}

/**
 * Patch a packing item — the hot path is the `checked` toggle, so the update
 * is OPTIMISTIC against the per-trip list with snapshot rollback on error.
 * Flag-on (row in the store): a sync write (offline-safe tick); the
 * UndoEntry is discarded — a tick is its own undo (tap again).
 */
export function useUpdateTripPackingItem() {
  const qc = useQueryClient();
  return useMutation<TripPackingItem, Error, UpdateTripPackingItemInput, PackingMutationContext>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ itemId, patch }) => {
      // Validate patched fields with the same bounds as create.
      if (patch.label !== undefined) newPackingItemSchema.shape.label.parse(patch.label);
      if (patch.category != null) {
        z.string().min(1).max(60).parse(patch.category);
      }
      if (tier1PackingRow(itemId)) {
        syncUpdatePackingItem(itemId, patch);
        const row = tier1Store$.tripPackingItems[itemId]?.peek() as TripPackingItem; // present — gate just checked
        return dressTier1Return(row);
      }
      const { data, error } = await supabase
        .from('trip_packing_items')
        .update(patch)
        .eq('id', itemId)
        .select(PACKING_SELECT_FIELDS)
        .single();
      // RLS makes a forbidden update a 0-row UPDATE; `.single()` then errors
      // — the correct "you can't edit this" surface for a viewer-only user.
      if (error) throw error;
      return tripPackingItemRowSchema.parse(data) as TripPackingItem;
    },
    onMutate: async ({ itemId, tripId, patch }) => {
      await qc.cancelQueries({ queryKey: tripPackingKeys.forTrip(tripId) });
      const previousForTrip = qc.getQueryData<TripPackingItem[]>(
        tripPackingKeys.forTrip(tripId),
      );
      if (previousForTrip) {
        qc.setQueryData<TripPackingItem[]>(
          tripPackingKeys.forTrip(tripId),
          previousForTrip.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        );
      }
      return { previousForTrip };
    },
    onError: (_err, { tripId }, context) => {
      if (context?.previousForTrip !== undefined) {
        qc.setQueryData(tripPackingKeys.forTrip(tripId), context.previousForTrip);
      }
    },
    onSettled: (_row, _err, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripPackingKeys.forTrip(tripId) });
    },
  });
}

/**
 * Delete a packing item. Flag-on (row in the store): TOMBSTONE through the
 * sync layer with its UndoEntry on the session undo stack. Otherwise the v1
 * HARD delete. Optimistic removal from the per-trip list with snapshot
 * rollback either way.
 */
export function useDeleteTripPackingItem() {
  const qc = useQueryClient();
  return useMutation<{ itemId: Uuid }, Error, DeleteTripPackingItemInput, PackingMutationContext>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ itemId }) => {
      if (tier1PackingRow(itemId)) {
        getSessionUndoStack().push(syncTombstonePackingItem(itemId));
        return { itemId };
      }
      const { error } = await supabase
        .from('trip_packing_items')
        .delete()
        .eq('id', itemId)
        .select('id')
        .single();
      if (error) throw error;
      return { itemId };
    },
    onMutate: async ({ itemId, tripId }) => {
      await qc.cancelQueries({ queryKey: tripPackingKeys.forTrip(tripId) });
      const previousForTrip = qc.getQueryData<TripPackingItem[]>(
        tripPackingKeys.forTrip(tripId),
      );
      if (previousForTrip) {
        qc.setQueryData<TripPackingItem[]>(
          tripPackingKeys.forTrip(tripId),
          previousForTrip.filter((it) => it.id !== itemId),
        );
      }
      return { previousForTrip };
    },
    onError: (_err, { tripId }, context) => {
      if (context?.previousForTrip !== undefined) {
        qc.setQueryData(tripPackingKeys.forTrip(tripId), context.previousForTrip);
      }
    },
    onSettled: (_res, _err, { tripId }) => {
      qc.invalidateQueries({ queryKey: tripPackingKeys.forTrip(tripId) });
    },
  });
}
