import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { use$ } from '@legendapp/state/react';
import { z } from 'zod';
import { supabase } from './supabase';
import { useTrip } from './trips';
import type {
  TripExpense,
  TripExpenseCategory,
  TripExpenseKind,
  Uuid,
} from './types';
import { tripsKeys, tripExpensesKeys } from './_keys';
import {
  TIER1_MUTATION_NETWORK_MODE,
  compareCreatedAtAscLocalLast,
  dressTier1Return,
  tier1SuccessResult,
} from './_tier1Facade';
import {
  createExpense as syncCreateExpense,
  isTier1SyncActive,
  tombstoneExpense as syncTombstoneExpense,
  updateExpense as syncUpdateExpense,
  type ExpenseWritePatch,
} from '@/sync/mutations';
import { tier1RootLoaded$ } from '@/sync/hydrate';
import { tier1Store$ } from '@/sync/store';
import { getSessionUndoStack } from '@/sync/undo';

// ----- Query keys (re-exported from ./_keys; see comment in trip-days.ts) ---
export { tripExpensesKeys };

// Re-export the shared types so consumers can import everything from a
// single module (`import { TripExpense, useTripExpenses } from '@/api'`).
export type { TripExpense, TripExpenseCategory, TripExpenseKind };

// ===========================================================================
// Zod schemas
// ===========================================================================
//
// `tripExpenseRowSchema` mirrors the `public.trip_expenses` columns and the
// CHECK constraints on `category` and `kind`. The set of allowed values
// MUST stay in lockstep with the migration (`0010_trip_budget_categories.sql`)
// and the type union in `./types.ts` — if you widen one, widen all three.
//
// Why a Zod schema (not just a TS type): the migration's CHECK constraints
// reject bad values at the DB layer, but RLS errors are noisy / opaque
// from the UI. Validating client-side first lets us surface a friendly
// "category not allowed" error before the round trip.
const tripExpenseCategoryEnum = z.enum([
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
]);

const tripExpenseKindEnum = z.enum(['estimated', 'actual']);

const tripExpenseRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  category: tripExpenseCategoryEnum,
  amount: z.number().nonnegative(),
  kind: tripExpenseKindEnum,
  day_index: z.number().int().min(0).nullable(),
  label: z.string().max(200).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Insert payload: server fills id / created_at / updated_at, kind defaults
// to 'estimated' on the DB side; client may omit it for the common case
// (planning a trip).
const createTripExpenseSchema = z.object({
  trip_id: z.string().uuid(),
  category: tripExpenseCategoryEnum,
  amount: z.number().nonnegative(),
  kind: tripExpenseKindEnum.optional(),
  day_index: z.number().int().min(0).nullish(),
  label: z.string().max(200).nullish(),
});

export type CreateTripExpenseInput = z.infer<typeof createTripExpenseSchema>;

// Update payload: id is required (we route the UPDATE by id under RLS);
// every other field is optional. We don't allow `trip_id` to change — moving
// an expense between trips is a delete + create, not an in-place update.
const updateTripExpenseSchema = z.object({
  id: z.string().uuid(),
  category: tripExpenseCategoryEnum.optional(),
  amount: z.number().nonnegative().optional(),
  kind: tripExpenseKindEnum.optional(),
  day_index: z.number().int().min(0).nullish(),
  label: z.string().max(200).nullish(),
});

export type UpdateTripExpenseInput = z.infer<typeof updateTripExpenseSchema>;

// ===========================================================================
// M4 X2.5 — Tier-1 sync facade (reads + write repoint)
// ===========================================================================
//
// Same always-call facade as ./trips.ts (S2.8.3/4) and ./trip-places.ts
// (S2.8.5/6) — read those headers for the full rationale. Deltas:
//
//   - SERVING GATE = engine active AND (expenses root has rows OR its first
//     remote load has completed this session — `tier1RootLoaded$`). The
//     loaded half matters here: plenty of users have zero expenses, and a
//     rows-only gate would never flip, so the first expense added OFFLINE
//     mid-trip would take the network path and fail. Before hydration the
//     v1 query serves (D2).
//   - Writes follow the SAME gate as reads (exactly one source renders and
//     exactly that source is written): create when the root is serving,
//     update/delete when the ROW is in the store.
//   - Delete is a TOMBSTONE through the sync layer (`deleted: true`,
//     replicates via incremental pulls) and its UndoEntry goes on the
//     session undo stack. Flag-off / not-yet-hydrated deletes stay v1 hard
//     deletes; every direct read filters `deleted = false` so tombstones
//     never resurface on the legacy path.
//   - Hook signatures are UNCHANGED (X2.4 / X2.1 / X2.2 consume them).
//   - TanStack invalidations keep firing in both branches (B1's decision):
//     flag-on they only mark the paused query stale.

/** The expense row in the Tier-1 store, IF the engine is active. */
function tier1ExpenseRow(id: Uuid): TripExpense | undefined {
  if (!isTier1SyncActive()) return undefined;
  return tier1Store$.tripExpenses[id]?.peek();
}

/** Non-reactive twin of the read gate (for mutationFns). */
function tier1ExpensesServing(): boolean {
  if (!isTier1SyncActive()) return false;
  const record = tier1Store$.tripExpenses.peek();
  const hasRows = record != null && Object.keys(record).length > 0;
  return hasRows || tier1RootLoaded$.tripExpenses.peek() === true;
}

/** created_at asc (the v1 ORDER BY); unacked local creates last, then id. */
function compareTier1Expenses(a: TripExpense, b: TripExpense): number {
  const cmp = compareCreatedAtAscLocalLast(a, b);
  if (cmp !== null && cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/**
 * Pure Tier-1 selector — the v1 `useTripExpenses` queryFn contract (per-trip,
 * live rows only, created_at asc) over the store record. `tripId === null`
 * selects across ALL trips (the `useAllUserExpenses` contract). Rows are
 * shallow-copied so a consumer can never mutate the sync-attached store.
 */
export function selectTier1TripExpenses(
  record: Record<string, TripExpense>,
  tripId: Uuid | null,
): TripExpense[] {
  const out: TripExpense[] = [];
  for (const row of Object.values(record)) {
    if (!row) continue;
    if (tripId !== null && row.trip_id !== tripId) continue;
    // The engine pulls tombstones on purpose (remote-delete replication).
    if (row.deleted === true) continue;
    out.push({ ...row });
  }
  return out.sort(compareTier1Expenses);
}

/** Reactive selector shared by both read hooks: null → v1 branch serves. */
function useTier1Expenses(enabled: boolean, tripId: Uuid | null): TripExpense[] | null {
  return use$((): TripExpense[] | null => {
    // Both tracked from the first render — the first hydration write (or the
    // first empty pull completing) is what flips the facade.
    const record = tier1Store$.tripExpenses.get();
    const loaded = tier1RootLoaded$.tripExpenses.get();
    if (!enabled) return null;
    const hasRows = record != null && Object.keys(record).length > 0;
    if ((!hasRows && !loaded) || !isTier1SyncActive()) return null;
    return selectTier1TripExpenses(record ?? {}, tripId);
  });
}

// ===========================================================================
// Hooks
// ===========================================================================

/**
 * List `trip_expenses` for a trip, sorted by `created_at` ascending so the
 * UI shows entries in the order the user added them. Returns an empty
 * array when the trip has no expenses recorded. Tombstoned rows are never
 * returned (both branches).
 *
 * RLS gates this read by the parent trip's `user_id`; an unauthorized
 * caller will receive an empty result rather than a 403.
 */
export function useTripExpenses(tripId: Uuid | undefined): UseQueryResult<TripExpense[], Error> {
  // [Hook 1/2] Tier-1 selector.
  const tier1Expenses = useTier1Expenses(Boolean(tripId), tripId ?? null);
  const tier1Serves = tier1Expenses !== null;

  // [Hook 2/2] The v1 query — paused (not unmounted) while Tier-1 serves.
  const query = useQuery<TripExpense[]>({
    queryKey: tripId ? tripExpensesKeys.forTrip(tripId) : ['trip-expenses', 'none'],
    enabled: Boolean(tripId) && !tier1Serves,
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_expenses')
        .select('*')
        .eq('trip_id', tripId)
        // X2.5: flag-on clients tombstone instead of hard-deleting — keep
        // flag-off / fallback readers from resurrecting deleted expenses.
        // Lockstep with selectTier1TripExpenses above.
        .eq('deleted', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Cast (not parse) per project policy: a row from a future category
      // enum degrades to stale UI rather than crashing the whole list.
      return (data ?? []) as TripExpense[];
    },
  });

  if (!tier1Serves) return query;
  return tier1SuccessResult(query, tier1Expenses as TripExpense[]);
}

/**
 * Insert a `trip_expenses` row for a trip. Mutation invalidates the
 * per-trip expenses cache AND the trip detail cache, because the trip's
 * derived totals (sum across categories, comparison against
 * `total_budget`) depend on this data.
 *
 * Flag-on (root serving): an offline-safe optimistic create through the
 * sync engine — the row is in every `useTripExpenses` consumer synchronously
 * and the INSERT is queued (survives reload when persistence is attached).
 */
export function useCreateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, CreateTripExpenseInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = createTripExpenseSchema.parse(input);
      if (tier1ExpensesServing()) {
        const id = syncCreateExpense({
          trip_id: parsed.trip_id,
          category: parsed.category,
          amount: parsed.amount,
          kind: parsed.kind,
          day_index: parsed.day_index ?? null,
          label: parsed.label ?? null,
        });
        const row = tier1Store$.tripExpenses[id]?.peek() as TripExpense; // just written — present
        return dressTier1Return(row);
      }
      const { data, error } = await supabase
        .from('trip_expenses')
        .insert(parsed)
        .select('*')
        .single();
      if (error) throw error;
      return tripExpenseRowSchema.parse(data) as TripExpense;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripExpensesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

/**
 * Patch a `trip_expenses` row by id. We strip `undefined` values from
 * the payload so the UPDATE only touches columns the caller named.
 *
 * Flag-on (row in the store): sync write; the UndoEntry is discarded —
 * generic field edits are not in the undo catalog (mirrors useUpdateTripPlace).
 */
export function useUpdateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, UpdateTripExpenseInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = updateTripExpenseSchema.parse(input);
      const { id, ...patch } = parsed;
      const payload = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      if (tier1ExpenseRow(id)) {
        // Every key this schema can produce is in EXPENSE_PATCH_FIELDS.
        syncUpdateExpense(id, payload as ExpenseWritePatch);
        const row = tier1Store$.tripExpenses[id]?.peek() as TripExpense; // present — gate just checked
        return dressTier1Return(row);
      }
      const { data, error } = await supabase
        .from('trip_expenses')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return tripExpenseRowSchema.parse(data) as TripExpense;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: tripExpensesKeys.forTrip(row.trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(row.trip_id) });
    },
  });
}

/**
 * Delete a `trip_expenses` row by id. The mutation requires the parent
 * `trip_id` so we can invalidate the right cache scope on success.
 *
 * Flag-on (row in the store): TOMBSTONE through the sync layer (offline-safe;
 * replicates through incremental pulls) with its UndoEntry pushed onto the
 * session undo stack ("Remove expense"). Otherwise the v1 hard delete.
 */
export function useDeleteTripExpense() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, { id: Uuid; trip_id: Uuid }>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async ({ id }) => {
      if (tier1ExpenseRow(id)) {
        getSessionUndoStack().push(syncTombstoneExpense(id));
        return id;
      }
      const { error } = await supabase.from('trip_expenses').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (_id, { trip_id }) => {
      qc.invalidateQueries({ queryKey: tripExpensesKeys.forTrip(trip_id) });
      qc.invalidateQueries({ queryKey: tripsKeys.detail(trip_id) });
    },
  });
}

// ===========================================================================
// Phase 24 Step 24.12: all expenses across every accessible trip (analytics)
// ===========================================================================

/**
 * Every live `trip_expenses` row the current user can see (across all trips
 * they own or collaborate on). RLS restricts the legacy read to accessible
 * trips; the Tier-1 store is RLS-scoped the same way at hydration.
 *
 * Powers the analytics screen's live spending fallback. X2.5: tombstones
 * are excluded in both branches — lockstep with the 0029 migration's
 * `expense_totals` filter on the nightly MV.
 */
export function useAllUserExpenses(): UseQueryResult<TripExpense[], Error> {
  const tier1Expenses = useTier1Expenses(true, null);
  const tier1Serves = tier1Expenses !== null;
  const query = useQuery<TripExpense[]>({
    queryKey: [...tripExpensesKeys.all, 'mine'] as const,
    enabled: !tier1Serves,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_expenses')
        .select('*')
        .eq('deleted', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TripExpense[];
    },
  });
  if (!tier1Serves) return query;
  return tier1SuccessResult(query, tier1Expenses as TripExpense[]);
}

// ===========================================================================
// Phase 21 Step 3: budget rollup (per-category + total)
// ===========================================================================
//
// `useTripExpenseRollup` is a *derived* hook — it reads from the existing
// `useTripExpenses` and `useTrip` query caches and reduces the rows into a
// per-category breakdown plus trip-wide totals. It does NOT issue its own
// network request, so adding it has zero cost on the request budget; the
// React Query cache stays the single source of truth for both raw expenses
// and the computed rollup.
//
// Why a hook (not a selector on `useTripExpenses`):
//   - The rollup needs the trip's `total_budget`, which lives on a different
//     query (`useTrip`). Composing both inside a hook keeps the call site
//     free of plumbing.
//   - We want one stable, memoized result object per (expenses, budget)
//     pair so consumers can pass it as a prop without triggering downstream
//     re-renders on every parent render.
//
// Memoization key: the source query's `data` array reference (TanStack
// returns a new reference only when the data actually changed) plus the
// scalar `total_budget`. That keeps the reduce O(n) only when something
// real changed.

const EXPENSE_CATEGORIES: readonly TripExpenseCategory[] = [
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
] as const;

/**
 * Per-category subtotal: planning estimate, recorded actual, and the
 * residual `estimated - actual` (positive => still budgeted, negative =>
 * overspent vs. plan). Phase 21 Step 3 surfaces this on the trip detail
 * budget card; Phase 21 Step 4+ may reuse the same shape for variance
 * tooling.
 */
export interface TripExpenseCategoryRollup {
  estimated: number;
  actual: number;
  /** `estimated - actual`. Sign is meaningful — see field docs above. */
  remaining: number;
}

/**
 * Shape returned by `useTripExpenseRollup`. `byCategory` is keyed by the
 * full enum so consumers can render a fixed grid without null-checking
 * each slot — categories with no expenses get zero/zero/zero.
 *
 * `budget` mirrors `trips.total_budget`: `null` means "no ceiling
 * configured". `remaining` (top-level) is `budget - totalActual`, also
 * `null` when no budget is set; the UI surfaces "no budget set" copy in
 * that case rather than rendering a misleading 0.
 */
export interface TripExpenseRollup {
  byCategory: Record<TripExpenseCategory, TripExpenseCategoryRollup>;
  totalEstimated: number;
  totalActual: number;
  budget: number | null;
  remaining: number | null;
  hasBudget: boolean;
}

function emptyByCategory(): Record<TripExpenseCategory, TripExpenseCategoryRollup> {
  // Build a fresh object each call; consumers may pass the rollup down as a
  // prop and we don't want shared mutable state if anyone (in tests, say)
  // ever mutated the result.
  const out = {} as Record<TripExpenseCategory, TripExpenseCategoryRollup>;
  for (const cat of EXPENSE_CATEGORIES) {
    out[cat] = { estimated: 0, actual: 0, remaining: 0 };
  }
  return out;
}

/**
 * Derived budget rollup for a trip. Reads the existing `useTripExpenses`
 * + `useTrip` caches and reduces them; emits no extra network request.
 *
 * Returns a stable, memoized `TripExpenseRollup`. Empty state
 * (no expenses, no budget) is a valid result — every numeric field is
 * `0`, `budget`/`remaining` are `null`, and `hasBudget` is `false`.
 *
 * Defensive choices:
 *   - Categories not in `EXPENSE_CATEGORIES` are silently dropped. The
 *     DB CHECK constraint prevents inserts outside the enum, so this only
 *     matters if the server-side enum widens before the client ships a
 *     matching update — preferable to crashing the trip detail screen.
 *   - `kind` is treated as a strict 'estimated' | 'actual' switch; rows
 *     with an unknown kind are skipped (same forward-compat reasoning).
 */
export function useTripExpenseRollup(tripId: Uuid | undefined): TripExpenseRollup {
  const expensesQuery = useTripExpenses(tripId);
  const tripQuery = useTrip(tripId);

  const expenses = expensesQuery.data;
  const budget = tripQuery.data?.total_budget ?? null;

  return useMemo<TripExpenseRollup>(() => {
    const byCategory = emptyByCategory();
    let totalEstimated = 0;
    let totalActual = 0;

    if (expenses) {
      for (const row of expenses) {
        const slot = byCategory[row.category];
        if (!slot) continue; // unknown category — see fn-level comment
        const amount = Number(row.amount);
        if (!Number.isFinite(amount)) continue;
        if (row.kind === 'estimated') {
          slot.estimated += amount;
          totalEstimated += amount;
        } else if (row.kind === 'actual') {
          slot.actual += amount;
          totalActual += amount;
        }
      }
      // Second pass: derive `remaining` per category. Done after the row
      // loop so a category that gets both an estimated and an actual row
      // computes correctly regardless of insertion order.
      for (const cat of EXPENSE_CATEGORIES) {
        const slot = byCategory[cat];
        slot.remaining = slot.estimated - slot.actual;
      }
    }

    const hasBudget = budget !== null && Number.isFinite(budget);
    const remaining = hasBudget ? (budget as number) - totalActual : null;

    return {
      byCategory,
      totalEstimated,
      totalActual,
      budget: hasBudget ? (budget as number) : null,
      remaining,
      hasBudget,
    };
  }, [expenses, budget]);
}
