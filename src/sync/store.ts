/**
 * store.ts — Legend-State observables for the Tier-1 synced roots (v2 S2.2).
 *
 * One observable Record<id, row> per entity. Created as PLAIN observables —
 * deliberately no sync/persistence attached here. hydrate.ts attaches
 * `syncedSupabase` to each root via `syncObservable(...)` only when the
 * Tier-1 flag (flags.ts) is on; with the flag off these are inert empty
 * objects that cost nothing and touch no native module, which is what makes
 * the whole module safe to ship dark in Wave 1.
 *
 * Shape choice: keyed Record (Legend-State crud `as: 'object'`), not array —
 * id-keyed merges are how the sync engine applies per-row changes, and
 * consumers derive sorted arrays per trip client-side (places per trip are
 * ≤ dozens of rows).
 *
 * Write status (S2.4, Wave 2): trips + trip_places are READ-WRITE through
 * the sync layer — a `tier1Store$.trips[id].set(...)` syncs to Supabase via
 * the sanitizeForTier1Write boundary (see hydrate.ts). The other six roots
 * remain read-only (`actions: ['read']`) until a later slice. Nothing in
 * the app UI writes these observables yet — Wave 3 repoints the hooks.
 */

import { observable } from '@legendapp/state';
import type { Tier1RowTypes, Tier1Table } from './allowlist';

/** Camel-cased store keys, mapped 1:1 to synced tables (TABLE_FOR_KEY). */
export interface Tier1Store {
  trips: Record<string, Tier1RowTypes['trips']>;
  tripPlaces: Record<string, Tier1RowTypes['trip_places']>;
  tripDays: Record<string, Tier1RowTypes['trip_days']>;
  tripExpenses: Record<string, Tier1RowTypes['trip_expenses']>;
  tripAccommodations: Record<string, Tier1RowTypes['trip_accommodations']>;
  tripPlaceReactions: Record<string, Tier1RowTypes['trip_place_reactions']>;
  tripPlaceComments: Record<string, Tier1RowTypes['trip_place_comments']>;
  tripPackingItems: Record<string, Tier1RowTypes['trip_packing_items']>;
  // M5 Y2.1 memory roots — AUTHOR-SCOPED (own rows only; allowlist.ts
  // TIER1_AUTHOR_SCOPED_TABLES). Other members' shared items never land here.
  tripJournalEntries: Record<string, Tier1RowTypes['trip_journal_entries']>;
  tripPlaceReviews: Record<string, Tier1RowTypes['trip_place_reviews']>;
  tripPhotos: Record<string, Tier1RowTypes['trip_photos']>;
}

export type Tier1StoreKey = keyof Tier1Store;

/** Store key → Postgres table. Single source of truth for hydrate.ts. */
export const TABLE_FOR_KEY: { readonly [K in Tier1StoreKey]: Tier1Table } = {
  trips: 'trips',
  tripPlaces: 'trip_places',
  tripDays: 'trip_days',
  tripExpenses: 'trip_expenses',
  tripAccommodations: 'trip_accommodations',
  tripPlaceReactions: 'trip_place_reactions',
  tripPlaceComments: 'trip_place_comments',
  tripPackingItems: 'trip_packing_items',
  tripJournalEntries: 'trip_journal_entries',
  tripPlaceReviews: 'trip_place_reviews',
  tripPhotos: 'trip_photos',
} as const;

export const TIER1_STORE_KEYS = Object.keys(TABLE_FOR_KEY) as readonly Tier1StoreKey[];

export const tier1Store$ = observable<Tier1Store>({
  trips: {},
  tripPlaces: {},
  tripDays: {},
  tripExpenses: {},
  tripAccommodations: {},
  tripPlaceReactions: {},
  tripPlaceComments: {},
  tripPackingItems: {},
  tripJournalEntries: {},
  tripPlaceReviews: {},
  tripPhotos: {},
});
