/**
 * M5 Y2.2 — money data layer: the expense facade freezes / pends rates, the
 * legacy path no longer strips the money columns, the reconciler fills
 * pending rates (owner/editor only), and the summary / rollup / warm hooks.
 *
 * The sync ENGINE is mocked down to its gate (as in
 * tier1Facades.expenses-packing.test.tsx); the store and the mutation layer
 * are real. fx-rates is mocked at the `../fx` fetchers; PostgREST is a
 * recording chain mock.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type Op = [string, unknown[]];
let mockActive = false;
const mockCalls: Array<{ table: string; ops: Op[] }> = [];
/** Per-table responder: (ops) → data. Default: [] (or null for single rows). */
const mockResponders: Record<string, (ops: Op[]) => unknown> = {};
/** supabase.functions.invoke (the REAL fx fetchers inside fx.ts hooks go through it). */
const mockInvoke = jest.fn<(name: string, opts: { body: Record<string, unknown> }) => Promise<unknown>>();

jest.mock('../supabase', () => {
  const makeChain = (table: string) => {
    const rec = { table, ops: [] as Op[] };
    mockCalls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'insert', 'update', 'upsert', 'delete', 'single', 'maybeSingle', 'is', 'not', 'in']) {
      chain[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => {
      const single = rec.ops.some(([m]) => m === 'single' || m === 'maybeSingle');
      const responder = mockResponders[table];
      const data = responder ? responder(rec.ops) : single ? null : [];
      return resolve({ data, error: null });
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => mockInvoke(name, opts) },
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      },
    },
  };
});

jest.mock('@/sync/hydrate', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { observable } = require('@legendapp/state');
  return {
    tier1RootLoaded$: observable({
      trips: false,
      tripPlaces: false,
      tripDays: false,
      tripExpenses: false,
      tripAccommodations: false,
      tripPlaceReactions: false,
      tripPlaceComments: false,
      tripPackingItems: false,
    }),
    isTier1SyncInitialized: () => mockActive,
    getTier1SyncUserId: () => (mockActive ? 'u1' : null),
    resyncTier1: jest.fn(),
    pruneTripFromLocalStore: jest.fn(),
  };
});
jest.mock('@/sync/flags', () => ({ isTier1SyncEnabled: () => true, loadTier1SyncFlag: async () => true }));

const mockFetchFxRate = jest.fn<(from: string, to: string, date?: string) => Promise<unknown>>();
const mockFetchFxRates = jest.fn<(params: Record<string, unknown>) => Promise<unknown>>();
jest.mock('../fx', () => {
  const actual = jest.requireActual<typeof import('../fx')>('../fx');
  return {
    ...actual,
    fetchFxRate: (from: string, to: string, date?: string) => mockFetchFxRate(from, to, date),
    fetchFxRates: (params: Record<string, unknown>) => mockFetchFxRates(params),
  };
});

/* eslint-disable import/first */
import { tier1Store$ } from '@/sync/store';
import { tier1RootLoaded$ } from '@/sync/hydrate';
import { FxError, fxKeys } from '../fx';
import {
  _resetFxReconcilerForTests,
  _resetFxWarmMemoForTests,
  acquireFxReconciler,
  getLastFxReconcileReport,
  requestFxReconcile,
  classifyFxFailure,
  findCachedFxRate,
  reconcilePendingFxRates,
  resolveEntryFxRate,
  useExpenseFxPreview,
} from '../expense-fx';
import {
  rollupFromMoneySummary,
  useCreateTripExpense,
  useTripExpenseRollup,
  useTripMoneySummary,
  useUpdateTripExpense,
  useWarmFxForTrip,
} from '../trip-expenses';
import type { Trip, TripExpense } from '../types';
import { localIsoDate } from '@/lib/money';
/* eslint-enable import/first */

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const E1 = '55555555-5555-4555-8555-555555555555';
const TODAY = localIsoDate();

function makeClient(): QueryClient {
  // gcTime Infinity everywhere: no GC timer may outlive a test (mutation GC defaults to 5 min).
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
}

const clients: QueryClient[] = [];
function wrapperFor(qc: QueryClient) {
  clients.push(qc);
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function trip(id: string, over: Partial<Trip> = {}): Trip {
  return {
    id,
    user_id: 'u1',
    title: 'Trip',
    start_date: '2025-01-01',
    end_date: '2025-01-10',
    daily_hours_budget: 8,
    anchor_place_id: null,
    transport_mode: 'driving',
    timezone: null,
    archived_at: null,
    currency: 'TRY',
    total_budget: 1000,
    route_render_mode: 'optimized',
    cover_photo_google_place_id: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

function expense(id: string, over: Partial<TripExpense> = {}): TripExpense {
  return {
    id,
    trip_id: T1,
    category: 'food',
    amount: 10,
    kind: 'actual',
    day_index: null,
    label: null,
    deleted: false,
    currency: 'TRY',
    fx_rate: 1,
    fx_date: '2025-01-02',
    fx_home_currency: 'TRY',
    created_at: '2025-01-02T10:00:00Z',
    updated_at: '2025-01-02T10:00:00Z',
    ...over,
  };
}

function pair(from: string, to: string, rate: number, date = TODAY) {
  return { from, to, rate, date, rateDate: date, source: 'frankfurter-ecb', stale: false };
}

function calls(table: string) {
  return mockCalls.filter((c) => c.table === table);
}

function serveTier1(trips: Trip[], rows: TripExpense[] = []) {
  mockActive = true;
  tier1RootLoaded$.tripExpenses.set(true);
  tier1Store$.trips.set(Object.fromEntries(trips.map((t) => [t.id, t])));
  tier1Store$.tripExpenses.set(Object.fromEntries(rows.map((r) => [r.id, r])));
}

function storedRows(): TripExpense[] {
  return Object.values(tier1Store$.tripExpenses.peek() ?? {}) as TripExpense[];
}

beforeEach(() => {
  mockActive = false;
  mockCalls.length = 0;
  for (const k of Object.keys(mockResponders)) delete mockResponders[k];
  mockFetchFxRate.mockReset();
  mockFetchFxRates.mockReset();
  mockInvoke.mockReset();
  tier1Store$.tripExpenses.set({});
  tier1Store$.trips.set({});
  tier1RootLoaded$.tripExpenses.set(false);
  onlineManager.setOnline(true);
  _resetFxReconcilerForTests();
  _resetFxWarmMemoForTests();
});

afterEach(() => {
  onlineManager.setOnline(true);
  // Unmount FIRST: an unmount after clear() would re-schedule the hooks' 24 h GC timers.
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('create: the rate is frozen at entry (or pending)', () => {
  it('foreign currency, online → fx-rates rate frozen with its date and the trip home', async () => {
    serveTier1([trip(T1)]);
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 35.2));
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 12.5, kind: 'actual', currency: 'eur' });
    });
    expect(mockFetchFxRate).toHaveBeenCalledWith('EUR', 'TRY', 'latest');
    const [row] = storedRows();
    expect(row).toMatchObject({ currency: 'EUR', fx_rate: 35.2, fx_date: TODAY, fx_home_currency: 'TRY', amount: 12.5 });
    expect(calls('trip_expenses')).toHaveLength(0);
  });

  it('home currency → rate 1, no network', async () => {
    serveTier1([trip(T1)]);
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 3, currency: 'TRY' });
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(storedRows()[0]).toMatchObject({ currency: 'TRY', fx_rate: 1, fx_home_currency: 'TRY', fx_date: TODAY });
  });

  it('offline → saved immediately as "rate pending" (fx_rate null, home + wanted date kept)', async () => {
    serveTier1([trip(T1)]);
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    act(() => {
      result.current.mutate({ trip_id: T1, category: 'transport', amount: 3.2, kind: 'actual', currency: 'EUR' });
    });
    await waitFor(() => expect(storedRows()).toHaveLength(1));
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(storedRows()[0]).toMatchObject({ currency: 'EUR', fx_rate: null, fx_home_currency: 'TRY', fx_date: TODAY });
  });

  it('rates_unavailable / quota → pending, never a 1:1 guess', async () => {
    serveTier1([trip(T1)]);
    mockFetchFxRate.mockRejectedValueOnce(new FxError('rates_unavailable', 'down', 503));
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 5, currency: 'USD' });
    });
    expect(storedRows()[0]).toMatchObject({ currency: 'USD', fx_rate: null, fx_home_currency: 'TRY' });
  });

  it('uses the cached last-known rate (the preview’s entry) without a request', async () => {
    serveTier1([trip(T1)]);
    const qc = makeClient();
    qc.setQueryData(fxKeys.pair('EUR', 'TRY', 'latest'), pair('EUR', 'TRY', 36.1));
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 1, currency: 'EUR' });
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(storedRows()[0]).toMatchObject({ fx_rate: 36.1, fx_home_currency: 'TRY' });
  });

  it('a past trip day asks for that day’s rate (start_date + day_index)', async () => {
    serveTier1([trip(T1, { start_date: '2025-01-01' })]);
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 36.9, '2025-01-03'));
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 1, currency: 'EUR', day_index: 2 });
    });
    expect(mockFetchFxRate).toHaveBeenCalledWith('EUR', 'TRY', '2025-01-03');
    expect(storedRows()[0]).toMatchObject({ fx_rate: 36.9, fx_date: '2025-01-03' });
  });

  it('caller-frozen rate passes through; an incomplete frozen rate is rejected by the schema', async () => {
    serveTier1([trip(T1)]);
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({
        trip_id: T1,
        category: 'food',
        amount: 2,
        currency: 'EUR',
        fx_rate: 34,
        fx_date: '2025-01-05',
        fx_home_currency: 'TRY',
      });
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(storedRows()[0]).toMatchObject({ fx_rate: 34, fx_date: '2025-01-05', fx_home_currency: 'TRY' });
    await expect(
      result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 2, currency: 'EUR', fx_rate: 34 }),
    ).rejects.toThrow(/fx_date|fx_home_currency/);
    await expect(
      result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 2, currency: 'EURO' }),
    ).rejects.toThrow(/ISO 4217/);
  });

  it('legacy path: the money columns are INSERTED and survive the row read-back', async () => {
    const qc = makeClient();
    qc.setQueryData(['trips', 'detail', T1], trip(T1));
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 35));
    mockResponders.trip_expenses = () =>
      expense(E1, { currency: 'EUR', fx_rate: 35, fx_date: TODAY, fx_home_currency: 'TRY' });
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(qc) });
    let row!: TripExpense;
    await act(async () => {
      row = await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 10, currency: 'EUR' });
    });
    const insert = calls('trip_expenses')[0]!.ops.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(insert).toMatchObject({ currency: 'EUR', fx_rate: 35, fx_date: TODAY, fx_home_currency: 'TRY' });
    expect(row).toMatchObject({ currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY', deleted: false });
  });

  it('legacy path without a currency keeps the pre-M5 payload (DB fills it)', async () => {
    mockResponders.trip_expenses = () => expense(E1, { currency: 'TRY' });
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 1 });
    });
    const insert = calls('trip_expenses')[0]!.ops.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(Object.keys(insert).sort()).toEqual(['amount', 'category', 'trip_id']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('update', () => {
  it('a currency change re-freezes the rate for the new currency on the entry date', async () => {
    serveTier1([trip(T1)], [expense(E1, { currency: 'EUR', fx_rate: 35, fx_date: '2025-01-02' })]);
    mockFetchFxRate.mockResolvedValueOnce(pair('USD', 'TRY', 32, '2025-01-02'));
    const { result } = renderHook(() => useUpdateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ id: E1, currency: 'USD' });
    });
    expect(mockFetchFxRate).toHaveBeenCalledWith('USD', 'TRY', '2025-01-02');
    expect(tier1Store$.tripExpenses[E1]!.peek()).toMatchObject({
      currency: 'USD',
      fx_rate: 32,
      fx_date: '2025-01-02',
      fx_home_currency: 'TRY',
    });
  });

  it('an amount edit keeps the frozen rate (no request)', async () => {
    serveTier1([trip(T1)], [expense(E1, { currency: 'EUR', fx_rate: 35 })]);
    const { result } = renderHook(() => useUpdateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      await result.current.mutateAsync({ id: E1, amount: 20 });
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(tier1Store$.tripExpenses[E1]!.peek()).toMatchObject({ amount: 20, fx_rate: 35, currency: 'EUR' });
  });

  it('legacy update returns the money columns instead of stripping them', async () => {
    mockResponders.trip_expenses = () => expense(E1, { currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY' });
    const { result } = renderHook(() => useUpdateTripExpense(), { wrapper: wrapperFor(makeClient()) });
    let row!: TripExpense;
    await act(async () => {
      row = await result.current.mutateAsync({ id: E1, label: 'x' });
    });
    expect(row).toMatchObject({ currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY', fx_date: '2025-01-02' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('reconciler', () => {
  it('fills pending rows on the owner’s trips through the sync layer', async () => {
    serveTier1([trip(T1)], [
      expense('p1', { currency: 'EUR', fx_rate: null, fx_date: '2025-01-03' }),
      expense('p2', { currency: 'EUR', fx_rate: null, fx_date: '2025-01-03' }),
      expense('ok', { currency: 'EUR', fx_rate: 35 }),
    ]);
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 36.5, '2025-01-03'));
    const qc = makeClient();
    clients.push(qc);
    const report = await reconcilePendingFxRates(qc);
    expect(report).toMatchObject({ groups: 1, filled: 2, failed: 0, skipped: 0 });
    expect(mockFetchFxRate).toHaveBeenCalledTimes(1);
    expect(mockFetchFxRate).toHaveBeenCalledWith('EUR', 'TRY', '2025-01-03');
    expect(tier1Store$.tripExpenses.p1!.peek()).toMatchObject({ fx_rate: 36.5, fx_date: '2025-01-03', fx_home_currency: 'TRY' });
    expect(tier1Store$.tripExpenses.p2!.peek()?.fx_rate).toBe(36.5);
    expect(calls('trip_expenses')).toHaveLength(0);
  });

  it('never writes on a trip where the user is a viewer (RLS would reject → infinite retry)', async () => {
    serveTier1([trip(T2, { user_id: 'someone-else' })], [expense('v1', { trip_id: T2, currency: 'EUR', fx_rate: null })]);
    mockResponders.trip_collaborators = () => [{ trip_id: T2, role: 'viewer' }];
    const qc = makeClient();
    clients.push(qc);
    const report = await reconcilePendingFxRates(qc);
    expect(report).toMatchObject({ groups: 1, filled: 0, skipped: 1 });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(tier1Store$.tripExpenses.v1!.peek()?.fx_rate).toBeNull();
  });

  it('editors may fill', async () => {
    serveTier1([trip(T2, { user_id: 'someone-else' })], [expense('e1', { trip_id: T2, currency: 'EUR', fx_rate: null })]);
    mockResponders.trip_collaborators = () => [{ trip_id: T2, role: 'editor' }];
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 36, '2025-01-02'));
    const qc = makeClient();
    clients.push(qc);
    const report = await reconcilePendingFxRates(qc);
    expect(report.filled).toBe(1);
  });

  it('transient failures leave rows pending; unsupported codes are not retried this session', async () => {
    serveTier1([trip(T1)], [
      expense('a', { currency: 'EUR', fx_rate: null }),
      expense('b', { currency: 'XXX', fx_rate: null }),
    ]);
    mockFetchFxRate.mockImplementation(async (from: string) => {
      if (from === 'XXX') throw new FxError('unsupported_currency', 'no', 422);
      throw new FxError('rates_unavailable', 'down', 503);
    });
    const qc = makeClient();
    clients.push(qc);
    const first = await reconcilePendingFxRates(qc);
    expect(first).toMatchObject({ groups: 2, filled: 0, failed: 1, skipped: 1 });
    mockFetchFxRate.mockClear();
    await reconcilePendingFxRates(qc);
    expect(mockFetchFxRate.mock.calls.map(([from]) => from)).toEqual(['EUR']);
    expect(tier1Store$.tripExpenses.a!.peek()?.fx_rate).toBeNull();
  });

  it('stops at quota_exceeded and does nothing offline', async () => {
    serveTier1([trip(T1)], [
      expense('a', { currency: 'EUR', fx_rate: null }),
      expense('b', { currency: 'USD', fx_rate: null }),
    ]);
    mockFetchFxRate.mockRejectedValue(new FxError('quota_exceeded', 'cap', 429));
    const qc = makeClient();
    clients.push(qc);
    const report = await reconcilePendingFxRates(qc);
    expect(report.quotaExceeded).toBe(true);
    expect(mockFetchFxRate).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(false);
    mockFetchFxRate.mockClear();
    expect(await reconcilePendingFxRates(qc)).toMatchObject({ offline: true, groups: 0 });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
  });

  it('legacy (flag-off) rows are filled with a conditional PostgREST update', async () => {
    const qc = makeClient();
    clients.push(qc);
    qc.setQueryData(['trips', 'detail', T1], trip(T1));
    qc.setQueryData(['trip-expenses', T1], [expense('L1', { currency: 'EUR', fx_rate: null })]);
    mockFetchFxRate.mockResolvedValueOnce(pair('EUR', 'TRY', 35.5, '2025-01-02'));
    const report = await reconcilePendingFxRates(qc);
    expect(report.filled).toBe(1);
    const update = calls('trip_expenses').find((c) => c.ops.some(([m]) => m === 'update'))!;
    expect(update.ops).toContainEqual(['update', [{ fx_rate: 35.5, fx_date: '2025-01-02', fx_home_currency: 'TRY' }]]);
    expect(update.ops).toContainEqual(['is', ['fx_rate', null]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('summary, rollup and warm hooks', () => {
  it('useTripMoneySummary: home totals, per-currency breakdown, pending report', async () => {
    serveTier1([trip(T1)], [
      expense('a', { currency: 'TRY', amount: 100 }),
      expense('b', { currency: 'EUR', amount: 10, fx_rate: 35 }),
      expense('c', { currency: 'USD', amount: 20, fx_rate: null, fx_date: '2025-01-04' }),
    ]);
    // The table has no USD for that day yet → c stays pending (auto-warm is off here).
    mockResponders.fx_rates = () => [];
    const { result } = renderHook(() => useTripMoneySummary(T1, { autoWarm: false }), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const s = result.current.data!;
    expect(result.current.home).toBe('TRY');
    expect(s.total.actual.value).toBe(450);
    expect(s.pending).toMatchObject({ count: 1, ids: ['c'] });
    expect(s.pending.actualByCurrency.USD!.value).toBe(20);
    expect(s.byCurrency.map((c) => c.currency)).toEqual(['TRY', 'EUR', 'USD']);
    expect(s.budget!.value).toBe(1000);
    expect(s.remaining!.value).toBe(550);
    // The fx_rates table was asked for exactly that day and code set.
    await waitFor(() => expect(calls('fx_rates').length).toBeGreaterThan(0));
    expect(calls('fx_rates')[0]!.ops).toEqual(
      expect.arrayContaining([
        ['eq', ['base', 'EUR']],
        ['in', ['rate_date', ['2025-01-04']]],
        ['in', ['quote', ['TRY', 'USD']]],
      ]),
    );
  });

  it('step 3: table rates on fx_date re-derive a pending row', async () => {
    serveTier1([trip(T1)], [expense('c', { currency: 'USD', amount: 20, fx_rate: null, fx_date: '2025-01-04' })]);
    mockResponders.fx_rates = () => [
      { quote: 'TRY', rate: 40, rate_date: '2025-01-04' },
      { quote: 'USD', rate: 1.25, rate_date: '2025-01-04' },
    ];
    const { result } = renderHook(() => useTripMoneySummary(T1), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.data?.pending.count).toBe(0));
    expect(result.current.data!.total.actual.value).toBe(640); // 20 × 40 / 1.25
    expect(result.current.data!.rows.c).toMatchObject({ status: 'converted', method: 'rederived' });
  });

  it('useTripExpenseRollup is currency-aware (no more 1:1 sums)', async () => {
    serveTier1([trip(T1)], [
      expense('a', { currency: 'TRY', amount: 100, category: 'food' }),
      expense('b', { currency: 'EUR', amount: 10, fx_rate: 35, category: 'food' }),
      expense('c', { currency: 'USD', amount: 20, fx_rate: null, fx_date: null, kind: 'estimated' }),
    ]);
    const { result } = renderHook(() => useTripExpenseRollup(T1), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.totalActual).toBe(450));
    expect(result.current.byCategory.food.actual).toBe(450);
    expect(result.current.totalEstimated).toBe(0);
    expect(result.current).toMatchObject({
      currency: 'TRY',
      budget: 1000,
      remaining: 550,
      hasBudget: true,
      pendingCount: 1,
      pendingEstimatedByCurrency: { USD: 20 },
    });
  });

  it('rollupFromMoneySummary without a trip row is all zeros (never a mixed-currency sum)', () => {
    expect(rollupFromMoneySummary(undefined, null)).toMatchObject({
      totalActual: 0,
      totalEstimated: 0,
      budget: null,
      remaining: null,
      hasBudget: false,
      currency: null,
    });
  });

  it('useWarmFxForTrip warms every distinct fx_date the new home needs', async () => {
    serveTier1([trip(T1)], [
      expense('a', { currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY', fx_date: '2025-01-02' }),
      expense('b', { currency: 'TRY', fx_rate: 1, fx_date: '2025-01-03' }),
      expense('c', { currency: 'USD', fx_rate: 1, fx_home_currency: 'USD', fx_date: '2025-01-04' }),
    ]);
    mockFetchFxRates.mockImplementation(async (params) => ({
      base: 'EUR',
      date: params.date,
      rateDate: params.date,
      rates: Object.fromEntries((params.quotes as string[]).map((q) => [q, 2])),
      source: 'frankfurter-ecb',
      stale: false,
      meta: { contractVersion: 1, cache: 'hit' },
    }));
    const { result } = renderHook(() => useWarmFxForTrip(T1), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(storedRows()).toHaveLength(3));
    let report!: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      report = await result.current.mutateAsync({ homeCurrency: 'USD' });
    });
    // a (EUR frozen into TRY) and b (TRY) need the table under USD; c is USD already.
    expect(mockFetchFxRates.mock.calls.map(([p]) => [p.date, p.quotes])).toEqual([
      ['2025-01-02', ['USD']],
      ['2025-01-03', ['TRY', 'USD']],
    ]);
    expect(report).toMatchObject({ home: 'USD', warmed: ['2025-01-02', '2025-01-03'], quotaExceeded: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('helpers', () => {
  it('classifyFxFailure', () => {
    expect(classifyFxFailure(new FxError('rates_unavailable', '', 503))).toBe('unavailable');
    expect(classifyFxFailure(new FxError('quota_unavailable', '', 503))).toBe('unavailable');
    expect(classifyFxFailure(new FxError('quota_exceeded', '', 429))).toBe('quota');
    expect(classifyFxFailure(new FxError('unsupported_currency', '', 422))).toBe('unsupported');
    expect(classifyFxFailure(new FxError('invalid_input', '', 400))).toBe('error');
    expect(classifyFxFailure(new TypeError('Network request failed'))).toBe('offline');
    expect(classifyFxFailure(new Error('boom'))).toBe('error');
  });

  it('findCachedFxRate reads pairs, EUR tables (rebased) and fx_rates books', () => {
    const qc = makeClient();
    clients.push(qc);
    qc.setQueryData(fxKeys.rates({ base: 'EUR', date: '2025-01-02', quotes: ['TRY', 'USD'] }), {
      base: 'EUR',
      date: '2025-01-02',
      rateDate: '2025-01-02',
      rates: { TRY: 40, USD: 1.25 },
      source: 'frankfurter-ecb',
      stale: false,
      meta: { contractVersion: 1, cache: 'hit' },
    });
    expect(findCachedFxRate(qc, 'USD', 'TRY', '2025-01-02', '2025-02-01')).toEqual({ rate: 32, date: '2025-01-02' });
    qc.setQueryData(['fx', 'book', '2025-01-05', 'JPY,TRY'], { '2025-01-05': { JPY: 160, TRY: 40 } });
    expect(findCachedFxRate(qc, 'JPY', 'TRY', '2025-01-05', '2025-02-01')).toEqual({ rate: 0.25, date: '2025-01-05' });
    // A 'latest' pair older than a week is not frozen into a new expense.
    qc.setQueryData(fxKeys.pair('GBP', 'TRY', 'latest'), pair('GBP', 'TRY', 45, '2025-01-01'));
    expect(findCachedFxRate(qc, 'GBP', 'TRY', 'latest', '2025-02-01')).toBeNull();
    expect(findCachedFxRate(qc, 'GBP', 'TRY', 'latest', '2025-01-05')).toEqual({ rate: 45, date: '2025-01-01' });
  });

  it('resolveEntryFxRate never throws and marks unknown homes pending', async () => {
    const qc = makeClient();
    clients.push(qc);
    expect(await resolveEntryFxRate(qc, { from: 'EUR', to: null, wantedDate: TODAY })).toMatchObject({
      status: 'pending',
      reason: 'no_home',
    });
    mockFetchFxRate.mockRejectedValueOnce(new Error('boom'));
    expect(await resolveEntryFxRate(qc, { from: 'EUR', to: 'TRY', wantedDate: TODAY })).toMatchObject({
      status: 'pending',
      reason: 'error',
    });
  });

  it('useExpenseFxPreview shows the rate the save will freeze', async () => {
    // useFxRate (fx.ts) calls the REAL fetcher → functions.invoke.
    mockInvoke.mockResolvedValue({
      data: {
        base: 'EUR',
        date: TODAY,
        rateDate: TODAY,
        rates: { TRY: 35.2134 },
        rate: 35.2134,
        source: 'frankfurter-ecb',
        stale: false,
        meta: { contractVersion: 1, cache: 'hit' },
      },
      error: null,
    });
    const qc = makeClient();
    const { result } = renderHook(
      () => useExpenseFxPreview({ amount: '12.5', currency: 'EUR', home: 'TRY' }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.converted).not.toBeNull());
    expect(result.current.converted).toEqual({ currency: 'TRY', exact: '440.1675', value: 440.17 });
    expect(result.current.rate).toBe(35.2134);
    // …and the save finds it in the cache.
    expect(findCachedFxRate(qc, 'EUR', 'TRY', 'latest')).toEqual({ rate: 35.2134, date: TODAY });
    const same = renderHook(() => useExpenseFxPreview({ amount: 5, currency: 'TRY', home: 'TRY' }), {
      wrapper: wrapperFor(makeClient()),
    });
    expect(same.result.current).toMatchObject({ sameCurrency: true, rate: 1, converted: { value: 5 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('reconciler scheduling (ref-counted; focus / reconnect / backoff)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a first pass shortly after acquire, reruns on reconnect, stops on release', async () => {
    serveTier1([trip(T1)], [expense('p1', { currency: 'EUR', fx_rate: null, fx_date: '2025-01-03' })]);
    mockFetchFxRate.mockRejectedValue(new FxError('rates_unavailable', 'down', 503));
    const qc = makeClient();
    clients.push(qc);
    const release = acquireFxReconciler(qc);
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1600);
    expect(mockFetchFxRate).toHaveBeenCalledTimes(1);
    expect(getLastFxReconcileReport()).toMatchObject({ groups: 1, failed: 1 });

    // Upstream back; a reconnect forces a pass right away (no 60 s backoff wait).
    mockFetchFxRate.mockReset();
    mockFetchFxRate.mockResolvedValue(pair('EUR', 'TRY', 36.2, '2025-01-03'));
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await jest.advanceTimersByTimeAsync(10);
    expect(tier1Store$.tripExpenses.p1!.peek()?.fx_rate).toBe(36.2);

    release();
    mockFetchFxRate.mockClear();
    requestFxReconcile({ force: true }); // no holder → no-op
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockFetchFxRate).not.toHaveBeenCalled();
  });

  it('a second holder shares the reconciler; the last release detaches it', async () => {
    const qc = makeClient();
    clients.push(qc);
    const a = acquireFxReconciler(qc);
    const b = acquireFxReconciler(qc);
    a();
    a(); // idempotent
    serveTier1([trip(T1)], [expense('p2', { currency: 'EUR', fx_rate: null, fx_date: '2025-01-03' })]);
    mockFetchFxRate.mockResolvedValue(pair('EUR', 'TRY', 36, '2025-01-03'));
    await jest.advanceTimersByTimeAsync(1600);
    expect(tier1Store$.tripExpenses.p2!.peek()?.fx_rate).toBe(36);
    b();
  });
});
