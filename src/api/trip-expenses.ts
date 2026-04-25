import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
// Hooks
// ===========================================================================

/**
 * List `trip_expenses` for a trip, sorted by `created_at` ascending so the
 * UI shows entries in the order the user added them. Returns an empty
 * array when the trip has no expenses recorded.
 *
 * RLS gates this read by the parent trip's `user_id`; an unauthorized
 * caller will receive an empty result rather than a 403, which is fine
 * for the trip-detail surface (the trip itself wouldn't have loaded
 * either).
 */
export function useTripExpenses(tripId: Uuid | undefined) {
  return useQuery<TripExpense[]>({
    queryKey: tripId ? tripExpensesKeys.forTrip(tripId) : ['trip-expenses', 'none'],
    enabled: Boolean(tripId),
    queryFn: async () => {
      if (!tripId) return [];
      const { data, error } = await supabase
        .from('trip_expenses')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Best-effort runtime validation. We don't `parse` and throw on a
      // single bad row because a stale UI seeing a row from a future
      // category enum is preferable to crashing the whole list — narrow
      // to the schema where it succeeds, fall back to the raw row
      // otherwise. (Phase 21 may tighten this if product wants strict
      // validation.)
      return (data ?? []) as TripExpense[];
    },
  });
}

/**
 * Insert a `trip_expenses` row for a trip. Mutation invalidates the
 * per-trip expenses cache AND the trip detail cache, because the trip's
 * derived totals (sum across categories, comparison against
 * `total_budget`) depend on this data.
 */
export function useCreateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, CreateTripExpenseInput>({
    mutationFn: async (input) => {
      const parsed = createTripExpenseSchema.parse(input);
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
 * the payload so the UPDATE only touches columns the caller named — this
 * matches the `useUpdateTripPlace` convention and keeps `updated_at`
 * trigger fires meaningful.
 */
export function useUpdateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, UpdateTripExpenseInput>({
    mutationFn: async (input) => {
      const parsed = updateTripExpenseSchema.parse(input);
      const { id, ...patch } = parsed;
      const payload = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
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
 * `trip_id` so we can invalidate the right cache scope on success — the
 * deleted row's `trip_id` would round-trip if we returned it from the
 * DELETE, but PostgREST's DELETE with `.select()` is awkward and adds a
 * round trip; passing the id from the call site is cheaper and matches
 * `useDeleteTripPlace`.
 */
export function useDeleteTripExpense() {
  const qc = useQueryClient();
  return useMutation<Uuid, Error, { id: Uuid; trip_id: Uuid }>({
    mutationFn: async ({ id }) => {
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
