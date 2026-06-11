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
// Delete model: HARD delete (pre-offline-engine; see the migration header).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import type { Uuid } from './types';
import { tripPackingKeys } from './_keys';

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
   * engine — supersedes the "hard delete until S2" stance in 0024. Optional:
   * nothing writes `true` until S2 Wave 2 enables Tier-1 writes.
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
// Hooks: reads
// ===========================================================================

/**
 * The whole packing checklist for a trip in ONE query. Ordered by
 * `created_at` then `label` so the seed batch (identical timestamps) renders
 * alphabetically and later manual adds append at the bottom. Grouping by
 * `category` is the UI's job (one list, client-side group-by).
 */
export function useTripPackingItems(tripId: Uuid | undefined) {
  return useQuery<TripPackingItem[]>({
    queryKey: tripId ? tripPackingKeys.forTrip(tripId) : [...tripPackingKeys.all, 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_packing_items')
        .select(PACKING_SELECT_FIELDS)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true })
        .order('label', { ascending: true });
      if (error) throw error;
      // List reads are cast (not hard-parsed) per project policy: an
      // unexpected extra column degrades to stale UI, not a crash.
      return (data ?? []) as TripPackingItem[];
    },
  });
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
 * No optimistic append: seeding is a one-shot action behind a button with
 * room for a spinner, and the invalidation round trip returns the real ids
 * immediately. (Toggle/delete below ARE optimistic — they're the high-
 * frequency interactions.)
 */
export function useCreateTripPackingItems() {
  const qc = useQueryClient();
  return useMutation<TripPackingItem[], Error, CreateTripPackingItemsInput>({
    mutationFn: async (input) => {
      const { tripId, items } = createTripPackingItemsSchema.parse(input);
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
 */
export function useUpdateTripPackingItem() {
  const qc = useQueryClient();
  return useMutation<TripPackingItem, Error, UpdateTripPackingItemInput, PackingMutationContext>({
    mutationFn: async ({ itemId, patch }) => {
      // Validate patched fields with the same bounds as create.
      if (patch.label !== undefined) newPackingItemSchema.shape.label.parse(patch.label);
      if (patch.category != null) {
        z.string().min(1).max(60).parse(patch.category);
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
 * HARD delete a packing item (pre-offline-engine; see the migration header).
 * Optimistic removal from the per-trip list with snapshot rollback.
 */
export function useDeleteTripPackingItem() {
  const qc = useQueryClient();
  return useMutation<{ itemId: Uuid }, Error, DeleteTripPackingItemInput, PackingMutationContext>({
    mutationFn: async ({ itemId }) => {
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
