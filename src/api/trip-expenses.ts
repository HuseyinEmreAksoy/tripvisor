import { useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, UseQueryResult } from '@tanstack/react-query';
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
  type MoneySummariesResult,
  type WarmFxReport,
  loadTripMoneyContext,
  requestFxReconcile,
  resolveEntryFxRate,
  useMoneySummaries,
  warmFxRates,
} from './expense-fx';
import {
  type CurrencyCode,
  type RateMode,
  type TripMoneySummary,
  isIsoDate,
  localIsoDate,
  normalizeCurrency,
  rateNeeds,
  wantedRateDate,
} from '@/lib/money';
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

// ── M5 Y2.2 money fields (0034, ADR-0012) ────────────────────────────────
// Mirrors of the DB CHECKs (and of src/sync/mutations.ts assertExpenseValues,
// which re-checks every Tier-1 write): ISO shape, rate > 0, real calendar date.
const currencyCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 code like "EUR"'));
const fxRateSchema = z.number().finite().positive();
const fxDateSchema = z.string().refine((v) => isIsoDate(v), 'fx_date must be a real YYYY-MM-DD date');

/** A frozen rate is only meaningful with its currency, date and target home (DB CHECK trip_expenses_fx_frozen_check). */
function refineFrozenRate(
  v: { fx_rate?: number | null; currency?: string | null; fx_date?: string | null; fx_home_currency?: string | null },
  ctx: z.RefinementCtx,
  requireCurrency: boolean,
): void {
  if (typeof v.fx_rate !== 'number') return;
  if (requireCurrency && v.currency == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currency'], message: 'A frozen fx_rate needs its currency' });
  }
  if (v.fx_date == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fx_date'], message: 'A frozen fx_rate needs fx_date' });
  }
  if (v.fx_home_currency == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fx_home_currency'],
      message: 'A frozen fx_rate needs fx_home_currency (the home it converts into)',
    });
  }
}

// Row read-back (legacy PostgREST path). M5: the money columns and the
// tombstone flag used to be STRIPPED here (zod drops unknown keys); they are
// now declared, and `.passthrough()` keeps any future additive column too.
// Lenient on purpose (no ISO/positivity checks): the write already succeeded,
// a surprising value must not turn it into a failed mutation.
const tripExpenseRowSchema = z
  .object({
    id: z.string().uuid(),
    trip_id: z.string().uuid(),
    category: tripExpenseCategoryEnum,
    amount: z.number().nonnegative(),
    kind: tripExpenseKindEnum,
    day_index: z.number().int().min(0).nullable(),
    label: z.string().max(200).nullable(),
    deleted: z.boolean().optional(),
    currency: z.string().nullable().optional(),
    fx_rate: z.number().nullable().optional(),
    fx_date: z.string().nullable().optional(),
    fx_home_currency: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

// Insert payload: server fills id / created_at / updated_at, kind defaults
// to 'estimated' on the DB side; client may omit it for the common case
// (planning a trip).
//
// M5 Y2.2 money semantics (see TripExpense in ./types for the model):
//   currency omitted / null → legacy shape: stored NULL and filled
//                             server-side with the trip home currency at rate
//                             1 (0034 §3d). Pre-M5 callers are unchanged.
//   currency set, fx_rate omitted (the normal M5 call)
//                           → the facade FREEZES the rate: identity for the
//                             home currency, else the cached last-known rate,
//                             else fx-rates (4 s budget), else "rate pending"
//                             (fx_rate null) + background reconciler.
//   currency set, fx_rate: null
//                           → explicitly pending (fx_date/fx_home_currency
//                             still filled).
//   currency set, fx_rate: number
//                           → caller-frozen (e.g. the rate the live preview
//                             showed); fx_date + fx_home_currency required.
const createTripExpenseObject = z.object({
  trip_id: z.string().uuid(),
  category: tripExpenseCategoryEnum,
  amount: z.number().nonnegative(),
  kind: tripExpenseKindEnum.optional(),
  day_index: z.number().int().min(0).nullish(),
  label: z.string().max(200).nullish(),
  currency: currencyCodeSchema.nullish(),
  fx_rate: fxRateSchema.nullish(),
  fx_date: fxDateSchema.nullish(),
  fx_home_currency: currencyCodeSchema.nullish(),
});
const createTripExpenseSchema = createTripExpenseObject.superRefine((v, ctx) => refineFrozenRate(v, ctx, true));

export type CreateTripExpenseInput = z.input<typeof createTripExpenseObject>;

// Update payload: id is required (we route the UPDATE by id under RLS);
// every other field is optional. We don't allow `trip_id` to change — moving
// an expense between trips is a delete + create, not an in-place update.
//
// M5 Y2.2: changing `currency` WITHOUT an fx_rate re-freezes the rate for the
// new currency (a rate for the old currency would be silently wrong). An
// amount / day / label edit keeps the frozen rate (it is frozen at entry).
// `currency` cannot be cleared to null here; `fx_rate: null` marks pending.
const updateTripExpenseObject = z.object({
  id: z.string().uuid(),
  category: tripExpenseCategoryEnum.optional(),
  amount: z.number().nonnegative().optional(),
  kind: tripExpenseKindEnum.optional(),
  day_index: z.number().int().min(0).nullish(),
  label: z.string().max(200).nullish(),
  currency: currencyCodeSchema.optional(),
  fx_rate: fxRateSchema.nullish(),
  fx_date: fxDateSchema.nullish(),
  fx_home_currency: currencyCodeSchema.nullish(),
});
const updateTripExpenseSchema = updateTripExpenseObject.superRefine((v, ctx) => refineFrozenRate(v, ctx, false));

export type UpdateTripExpenseInput = z.input<typeof updateTripExpenseObject>;

/** The four money columns as written (create) — null = not set. */
interface ExpenseMoneyFields {
  currency: CurrencyCode | null;
  fx_rate: number | null;
  fx_date: string | null;
  fx_home_currency: CurrencyCode | null;
}

const NO_MONEY: ExpenseMoneyFields = { currency: null, fx_rate: null, fx_date: null, fx_home_currency: null };

/**
 * Decide the money columns for a new row (or a currency change): see the
 * create-schema comment for the four input shapes. Never throws for rate
 * trouble — the worst case is "rate pending".
 */
async function resolveExpenseMoney(
  qc: QueryClient,
  input: {
    trip_id: Uuid;
    currency?: CurrencyCode | null;
    fx_rate?: number | null;
    fx_date?: string | null;
    fx_home_currency?: CurrencyCode | null;
    day_index?: number | null;
    created_at?: string;
  },
): Promise<ExpenseMoneyFields> {
  const currency = normalizeCurrency(input.currency);
  if (!currency) return NO_MONEY;
  if (typeof input.fx_rate === 'number') {
    // Caller-frozen; the schema guaranteed the companions.
    return {
      currency,
      fx_rate: input.fx_rate,
      fx_date: input.fx_date ?? null,
      fx_home_currency: normalizeCurrency(input.fx_home_currency),
    };
  }
  const ctx = input.trip_id ? await loadTripMoneyContext(qc, input.trip_id) : null;
  const home = ctx?.home ?? normalizeCurrency(input.fx_home_currency);
  const today = localIsoDate();
  const wanted = wantedRateDate(
    { fx_date: input.fx_date ?? null, day_index: input.day_index ?? null, created_at: input.created_at },
    { tripStartDate: ctx?.startDate ?? null, today },
  );
  if (home && currency === home) return { currency, fx_rate: 1, fx_date: wanted, fx_home_currency: home };
  if (input.fx_rate === null) return { currency, fx_rate: null, fx_date: wanted, fx_home_currency: home };
  const res = await resolveEntryFxRate(qc, { from: currency, to: home, wantedDate: wanted, today });
  if (res.status === 'resolved' && home) {
    return { currency, fx_rate: res.rate, fx_date: res.fxDate, fx_home_currency: home };
  }
  return { currency, fx_rate: null, fx_date: res.fxDate, fx_home_currency: home };
}

/** One row by id from the server (legacy path, when no cache has it). null offline / not found. */
async function fetchExpenseRow(id: Uuid): Promise<TripExpense | null> {
  try {
    const { data, error } = await supabase.from('trip_expenses').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return data as TripExpense;
  } catch {
    return null;
  }
}

/** Find a row the UI already has (Tier-1 store or any cached expenses list). */
function cachedExpenseRow(qc: QueryClient, id: Uuid): TripExpense | undefined {
  const inStore = tier1ExpenseRow(id);
  if (inStore) return inStore;
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: tripExpensesKeys.all })) {
    if (!Array.isArray(data)) continue;
    const hit = (data as TripExpense[]).find((r) => r && r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

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
 *
 * M5 Y2.2: pass `currency` (ISO 4217) and the facade freezes `fx_rate` /
 * `fx_date` / `fx_home_currency` before writing — or saves "rate pending"
 * (fx_rate null) when no rate is reachable; the background reconciler
 * (expense-fx.ts) fills it later. See the create-schema comment.
 */
export function useCreateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, CreateTripExpenseInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = createTripExpenseSchema.parse(input);
      // M5 Y2.2: freeze the rate (or mark it pending) BEFORE the write, so the
      // row lands complete. Offline this answers without waiting.
      const money = await resolveExpenseMoney(qc, parsed);
      if (money.currency !== null && money.fx_rate === null) requestFxReconcile();
      if (tier1ExpensesServing()) {
        const id = syncCreateExpense({
          trip_id: parsed.trip_id,
          category: parsed.category,
          amount: parsed.amount,
          kind: parsed.kind,
          day_index: parsed.day_index ?? null,
          label: parsed.label ?? null,
          ...money,
        });
        const row = tier1Store$.tripExpenses[id]?.peek() as TripExpense; // just written — present
        return dressTier1Return(row);
      }
      const insert = {
        trip_id: parsed.trip_id,
        category: parsed.category,
        amount: parsed.amount,
        ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
        ...(parsed.day_index !== undefined ? { day_index: parsed.day_index } : {}),
        ...(parsed.label !== undefined ? { label: parsed.label } : {}),
        // Legacy shape (no currency) stays byte-identical: the DB fills it (0034 §3d).
        ...(money.currency !== null ? money : {}),
      };
      const { data, error } = await supabase
        .from('trip_expenses')
        .insert(insert)
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
 *
 * M5 Y2.2: the four money columns are writable; a `currency` change without
 * an `fx_rate` re-freezes the rate (see the update-schema comment).
 */
export function useUpdateTripExpense() {
  const qc = useQueryClient();
  return useMutation<TripExpense, Error, UpdateTripExpenseInput>({
    // Offline Tier-1 writes must run immediately — see TIER1_MUTATION_NETWORK_MODE.
    networkMode: TIER1_MUTATION_NETWORK_MODE,
    mutationFn: async (input) => {
      const parsed = updateTripExpenseSchema.parse(input);
      const { id, ...patch } = parsed;
      const payload: Record<string, unknown> = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      // M5 Y2.2: a currency change without a rate re-freezes the rate for the
      // new currency (keeping the old one would convert with a wrong rate).
      if (patch.currency !== undefined && patch.fx_rate === undefined) {
        const current = cachedExpenseRow(qc, id) ?? (await fetchExpenseRow(id));
        const changed = !current || normalizeCurrency(current.currency) !== patch.currency;
        if (changed) {
          const money = await resolveExpenseMoney(qc, {
            trip_id: (current?.trip_id ?? '') as Uuid,
            currency: patch.currency,
            // An explicit date wins; else keep the entry date (the expense did not move in time).
            fx_date: patch.fx_date ?? current?.fx_date ?? null,
            day_index: patch.day_index ?? current?.day_index ?? null,
            created_at: current?.created_at,
          });
          Object.assign(payload, money);
          if (money.fx_rate === null) requestFxReconcile();
        }
      }
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
  /*
   * M5 Y2.2 (additive, optional so existing fixtures still type-check):
   * every number above is in `currency` (the trip HOME currency), converted
   * with the frozen-rate order and rounded to its minor units. Rows whose
   * rate is still pending are NOT in any total — they are counted here and
   * summed per ORIGINAL currency (show a "rate pending" chip).
   */
  /** The home currency the totals are in (null until the trip row is known). */
  currency?: CurrencyCode | null;
  pendingCount?: number;
  /** { [original ISO]: amount } of pending actual rows. */
  pendingActualByCurrency?: Record<CurrencyCode, number>;
  /** Same for pending estimated rows. */
  pendingEstimatedByCurrency?: Record<CurrencyCode, number>;
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
 * Map a money summary onto the Phase-21 rollup shape (display numbers,
 * already rounded to the home currency's minor units). Pure; exported for tests.
 */
export function rollupFromMoneySummary(
  summary: TripMoneySummary | undefined,
  budget: number | null,
): TripExpenseRollup {
  const byCategory = emptyByCategory();
  const hasBudget = budget !== null && Number.isFinite(budget);
  if (!summary) {
    // Trip row not known yet: nothing can be converted honestly. Zeros, not
    // a 1:1 sum of mixed currencies.
    return {
      byCategory,
      totalEstimated: 0,
      totalActual: 0,
      budget: hasBudget ? budget : null,
      remaining: hasBudget ? budget : null,
      hasBudget,
      currency: null,
      pendingCount: 0,
      pendingActualByCurrency: {},
      pendingEstimatedByCurrency: {},
    };
  }
  for (const cat of EXPENSE_CATEGORIES) {
    const slot = summary.byCategory[cat];
    byCategory[cat] = { estimated: slot.estimated.value, actual: slot.actual.value, remaining: slot.remaining.value };
  }
  const values = (record: Record<string, { value: number }>) =>
    Object.fromEntries(Object.entries(record).map(([code, money]) => [code, money.value]));
  return {
    byCategory,
    totalEstimated: summary.total.estimated.value,
    totalActual: summary.total.actual.value,
    budget: hasBudget ? budget : null,
    remaining: hasBudget ? (summary.remaining?.value ?? null) : null,
    hasBudget,
    currency: summary.home,
    pendingCount: summary.pending.count,
    pendingActualByCurrency: values(summary.pending.actualByCurrency),
    pendingEstimatedByCurrency: values(summary.pending.estimatedByCurrency),
  };
}

/**
 * Derived budget rollup for a trip, in the trip's HOME currency.
 *
 * M5 Y2.2: now currency-aware (it used to add raw amounts of every currency
 * together 1:1). Built on {@link useTripMoneySummary}: rows convert with the
 * frozen-rate order (src/lib/money), totals are exact and rounded once, and
 * rows whose rate is still pending are EXCLUDED and reported through
 * `pendingCount` / `pending*ByCurrency`. Signature and shape are unchanged
 * (the M5 fields are optional additions).
 *
 * Returns a stable, memoized `TripExpenseRollup`. Empty state
 * (no expenses, no budget) is a valid result — every numeric field is
 * `0`, `budget`/`remaining` are `null`, and `hasBudget` is `false`.
 *
 * Defensive choices:
 *   - Categories not in `EXPENSE_CATEGORIES` fold into 'other' (so the
 *     grid still sums to the total). The DB CHECK prevents them today.
 *   - `kind` is treated as a strict 'estimated' | 'actual' switch; rows
 *     with an unknown kind are skipped (same forward-compat reasoning).
 */
export function useTripExpenseRollup(tripId: Uuid | undefined): TripExpenseRollup {
  const { data: summary, budget } = useTripMoneySummaryInternal(tripId, {});
  return useMemo<TripExpenseRollup>(() => rollupFromMoneySummary(summary, budget), [summary, budget]);
}

// ===========================================================================
// M5 Y2.2: multi-currency summary + FX warm-up hooks (Y3.2 consumers)
// ===========================================================================

export interface UseTripMoneySummaryOptions {
  /** 'entry' (default): frozen rates. 'today': today's rate for every foreign row. */
  rateMode?: RateMode;
  /** Let the summary ask fx-rates to fill table days it needs (default true). */
  autoWarm?: boolean;
}

export interface TripMoneySummaryResult
  extends Pick<MoneySummariesResult, 'isFetchingRates' | 'ratesError' | 'todayRatesUnavailable'> {
  /**
   * Home-currency totals (by kind / category / day), the per-currency
   * breakdown, the pending report and per-row outcomes. undefined while the
   * trip or its expenses are loading.
   */
  data: TripMoneySummary | undefined;
  /** The trip's home currency (`trips.currency`), once known. */
  home: CurrencyCode | null;
  isLoading: boolean;
  /** Expenses or trip read failed. */
  error: Error | null;
}

function useTripMoneySummaryInternal(
  tripId: Uuid | undefined,
  options: UseTripMoneySummaryOptions,
): TripMoneySummaryResult & { budget: number | null } {
  const expensesQuery = useTripExpenses(tripId);
  const tripQuery = useTrip(tripId);
  const trip = tripQuery.data ?? null;
  const tripInput = useMemo(
    () => (trip ? [{ id: trip.id, currency: trip.currency, total_budget: trip.total_budget }] : undefined),
    [trip?.id, trip?.currency, trip?.total_budget], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const summaries = useMoneySummaries(tripInput, expensesQuery.data, {
    rateMode: options.rateMode,
    autoWarm: options.autoWarm,
    enabled: Boolean(tripId),
  });
  const budget = trip?.total_budget ?? null;
  return {
    data: tripId ? summaries.data?.[tripId] : undefined,
    home: normalizeCurrency(trip?.currency),
    isLoading: expensesQuery.isLoading || tripQuery.isLoading,
    error: (expensesQuery.error as Error | null) ?? (tripQuery.error as Error | null) ?? null,
    isFetchingRates: summaries.isFetchingRates,
    ratesError: summaries.ratesError,
    todayRatesUnavailable: summaries.todayRatesUnavailable,
    budget: budget !== null && Number.isFinite(budget) ? budget : null,
  };
}

/**
 * Everything the multi-currency budget UI needs for one trip, in its home
 * currency: `data.total` (actual/estimated, converted rows only),
 * `data.byCategory`, `data.byDay`, `data.byCurrency` (per original currency:
 * original totals, converted totals, pending slice), `data.pending`
 * (count + amounts per original currency — the "rate pending" chip),
 * `data.budget/remaining`, and `data.rows[id]` (per-row converted amount /
 * pending reason for the expense list). `rateMode: 'today'` re-converts every
 * foreign row at today's rate (the "at today's rate" toggle).
 *
 * Values are MoneyValue: `value` is display-rounded (pass to
 * `formatMoney(value, currency)`), `exact` is for further math via the lib.
 * While mounted, the background reconciler fills pending rates.
 */
export function useTripMoneySummary(
  tripId: Uuid | undefined,
  options: UseTripMoneySummaryOptions = {},
): TripMoneySummaryResult {
  const { budget: _budget, ...result } = useTripMoneySummaryInternal(tripId, options);
  return result;
}

export interface WarmFxForTripInput {
  /**
   * The home currency to warm for. Pass the NEW code right after changing
   * `trips.currency` (the trip query may not have refetched yet); defaults
   * to the trip's current home.
   */
  homeCurrency?: string;
}

export interface WarmFxForTripResult extends WarmFxReport {
  /** The home currency that was warmed for (null: trip unknown). */
  home: CurrencyCode | null;
}

/**
 * Warm the `fx_rates` table for every distinct `fx_date` of the trip's
 * expenses that step 3 needs under the (new) home currency — the Y3.2
 * home-currency-change flow (0038 CORRECTION). Afterwards the summary
 * re-derives those rows instead of showing them pending, and the nightly MV
 * converts them too. Online (Tier-2) mutation; fills count against the
 * per-user fx quota, so the report says when it ran out (`quotaExceeded`).
 *
 *   const warm = useWarmFxForTrip(tripId);
 *   await updateTrip.mutateAsync({ currency: 'EUR' });
 *   warm.mutate({ homeCurrency: 'EUR' });
 */
export function useWarmFxForTrip(tripId: Uuid | undefined) {
  const qc = useQueryClient();
  const { data: expenses } = useTripExpenses(tripId);
  const { data: trip } = useTrip(tripId);
  const latest = useRef({ expenses, trip });
  latest.current = { expenses, trip };
  return useMutation<WarmFxForTripResult, Error, WarmFxForTripInput | void>({
    mutationFn: async (vars) => {
      const home = normalizeCurrency((vars && vars.homeCurrency) ?? latest.current.trip?.currency);
      if (!tripId || !home) {
        return { home: null, needs: [], warmed: [], failed: [], quotaExceeded: false, offline: false };
      }
      let rows = latest.current.expenses;
      if (!rows) {
        const { data, error } = await supabase
          .from('trip_expenses')
          .select('*')
          .eq('trip_id', tripId)
          .eq('deleted', false);
        if (error) throw error;
        rows = (data ?? []) as TripExpense[];
      }
      const report = await warmFxRates(qc, rateNeeds(rows, home));
      requestFxReconcile();
      return { ...report, home };
    },
  });
}
