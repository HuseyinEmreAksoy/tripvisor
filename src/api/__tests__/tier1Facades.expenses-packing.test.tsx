/**
 * M4 X2.5 — the expense + packing Tier-1 facades (src/api/trip-expenses.ts,
 * src/api/trip-packing.ts).
 *
 * The sync ENGINE is mocked down to its gate (active flag + the per-root
 * `tier1RootLoaded$` signal); the store and the mutation layer are real.
 * Asserts: the serving gate (rows OR first-load-done), tombstone filtering,
 * sort contracts, writes landing in the store with no network call when
 * serving, the legacy path (with `deleted = false`) otherwise, and delete →
 * tombstone + undo entry.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
let mockActive = false;
const mockFromCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockLegacyRows: Record<string, unknown> = {};

jest.mock('../supabase', () => {
  const makeChain = (table: string) => {
    const rec = { table, ops: [] as Array<[string, unknown[]]> };
    mockFromCalls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single', 'is', 'not', 'in']) {
      chain[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: mockLegacyRows[table] ?? [], error: null });
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      auth: { getUser: async () => ({ data: { user: null } }) },
    },
  };
});

jest.mock('@/sync/hydrate', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

/* eslint-disable import/first */
import { tier1Store$ } from '@/sync/store';
import { tier1RootLoaded$ } from '@/sync/hydrate';
import { getSessionUndoStack, _resetSessionUndoStackForTests } from '@/sync/undo';
import {
  selectTier1TripExpenses,
  useAllUserExpenses,
  useCreateTripExpense,
  useDeleteTripExpense,
  useTripExpenses,
  useUpdateTripExpense,
} from '../trip-expenses';
import {
  selectTier1PackingItems,
  useCreateTripPackingItems,
  useDeleteTripPackingItem,
  useTripPackingItems,
  useUpdateTripPackingItem,
} from '../trip-packing';
import { useArchiveTrip } from '../trips';
import { useCreateTripPlace } from '../trip-places';
import type { Trip, TripExpense, TripPlace } from '../types';
import type { TripPackingItem } from '../trip-packing';
/* eslint-enable import/first */

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
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
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...over,
  };
}

function packing(id: string, over: Partial<TripPackingItem> = {}): TripPackingItem {
  return {
    id,
    trip_id: T1,
    label: 'Item',
    category: null,
    checked: false,
    auto: false,
    deleted: false,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...over,
  };
}

function legacyCalls(table: string) {
  return mockFromCalls.filter((c) => c.table === table);
}

beforeEach(() => {
  mockActive = false;
  mockFromCalls.length = 0;
  for (const k of Object.keys(mockLegacyRows)) delete mockLegacyRows[k];
  tier1Store$.tripExpenses.set({});
  tier1Store$.tripPackingItems.set({});
  tier1Store$.trips.set({});
  tier1Store$.tripPlaces.set({});
  tier1RootLoaded$.tripExpenses.set(false);
  tier1RootLoaded$.tripPackingItems.set(false);
  _resetSessionUndoStackForTests();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('pure selectors', () => {
  it('selectTier1TripExpenses: per-trip, tombstones out, created_at asc, local creates last', () => {
    const local = { ...expense('e-local') } as Partial<TripExpense>;
    delete local.created_at;
    delete local.updated_at;
    const rows = {
      b: expense('b', { created_at: '2026-09-02T00:00:00Z' }),
      a: expense('a', { created_at: '2026-09-01T00:00:00Z' }),
      dead: expense('dead', { deleted: true }),
      other: expense('other', { trip_id: T2 }),
      'e-local': local as TripExpense,
    };
    expect(selectTier1TripExpenses(rows, T1).map((r) => r.id)).toEqual(['a', 'b', 'e-local']);
    // null trip = all trips (useAllUserExpenses)
    expect(selectTier1TripExpenses(rows, null).map((r) => r.id)).toEqual(['a', 'other', 'b', 'e-local']);
    // shallow copies: mutating a result never touches the store row
    const out = selectTier1TripExpenses(rows, T1);
    out[0]!.amount = 999;
    expect(rows.a.amount).toBe(10);
  });

  it('selectTier1PackingItems: created_at then label; a local seed batch renders alphabetically', () => {
    const strip = (r: TripPackingItem) => {
      const x = { ...r } as Partial<TripPackingItem>;
      delete x.created_at;
      delete x.updated_at;
      return x as TripPackingItem;
    };
    const rows = {
      z: packing('z', { label: 'Zipper bags' }),
      a: packing('a', { label: 'Adapter' }),
      dead: packing('dead', { label: 'Gone', deleted: true }),
      l2: strip(packing('l2', { label: 'Sunscreen' })),
      l1: strip(packing('l1', { label: 'Passport' })),
    };
    expect(selectTier1PackingItems(rows, T1).map((r) => r.label)).toEqual([
      'Adapter',
      'Zipper bags',
      'Passport',
      'Sunscreen',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('useTripExpenses serving gate', () => {
  it('engine inactive → legacy query, filtered on deleted = false', async () => {
    mockLegacyRows.trip_expenses = [expense('srv')];
    const { result } = renderHook(() => useTripExpenses(T1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id)).toEqual(['srv']);
    const call = legacyCalls('trip_expenses')[0]!;
    expect(call.ops).toContainEqual(['eq', ['deleted', false]]);
  });

  it('active but root empty and not yet loaded → legacy (D2 hydration window)', async () => {
    mockActive = true;
    mockLegacyRows.trip_expenses = [expense('cached')];
    const { result } = renderHook(() => useTripExpenses(T1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id)).toEqual(['cached']);
  });

  it('active + empty root whose first pull finished → Tier-1 serves [] (no network read)', async () => {
    mockActive = true;
    tier1RootLoaded$.tripExpenses.set(true);
    const { result } = renderHook(() => useTripExpenses(T1), { wrapper: wrapper() });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(legacyCalls('trip_expenses')).toHaveLength(0);
  });

  it('active + rows → store rows (tombstones hidden); flips reactively on hydration', async () => {
    mockActive = true;
    const { result } = renderHook(() => useTripExpenses(T1), { wrapper: wrapper() });
    act(() => {
      tier1Store$.tripExpenses.set({ a: expense('a'), dead: expense('dead', { deleted: true }) });
    });
    await waitFor(() => expect(result.current.data?.map((r) => r.id)).toEqual(['a']));
  });

  it('useAllUserExpenses legacy branch filters deleted = false too', async () => {
    const { result } = renderHook(() => useAllUserExpenses(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(legacyCalls('trip_expenses')[0]!.ops).toContainEqual(['eq', ['deleted', false]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('expense writes', () => {
  it('create while serving → store row, no network, dressed return (store keeps no created_at)', async () => {
    mockActive = true;
    tier1RootLoaded$.tripExpenses.set(true);
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapper() });
    let row!: TripExpense;
    await act(async () => {
      row = await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 4.5, kind: 'actual' });
    });
    expect(legacyCalls('trip_expenses')).toHaveLength(0);
    expect(typeof row.created_at).toBe('string');
    const stored = tier1Store$.tripExpenses[row.id]!.peek() as unknown as Record<string, unknown>;
    expect(stored.amount).toBe(4.5);
    expect('created_at' in stored).toBe(false);
  });

  it('create while NOT serving → legacy insert', async () => {
    // the chain mock resolves this payload for `.single()` too: one row object
    mockLegacyRows.trip_expenses = expense('33333333-3333-4333-8333-333333333333');
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ trip_id: T1, category: 'food', amount: 1 });
    });
    expect(legacyCalls('trip_expenses')[0]!.ops[0]![0]).toBe('insert');
  });

  it('update with the row in the store → sync write', async () => {
    mockActive = true;
    const E = '55555555-5555-4555-8555-555555555555'; // the update schema requires a uuid id
    tier1Store$.tripExpenses.set({ [E]: expense(E) });
    const { result } = renderHook(() => useUpdateTripExpense(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: E, amount: 77 });
    });
    expect(legacyCalls('trip_expenses')).toHaveLength(0);
    expect(tier1Store$.tripExpenses[E]!.peek()?.amount).toBe(77);
  });

  it('delete with the row in the store → tombstone + undo entry (no hard DELETE)', async () => {
    mockActive = true;
    tier1Store$.tripExpenses.set({ e1: expense('e1') });
    const { result } = renderHook(() => useDeleteTripExpense(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', trip_id: T1 });
    });
    expect(legacyCalls('trip_expenses')).toHaveLength(0);
    expect(tier1Store$.tripExpenses.e1!.peek()?.deleted).toBe(true);
    expect(getSessionUndoStack().peekLabel).toBe('Remove expense');
    await getSessionUndoStack().undoLast();
    expect(tier1Store$.tripExpenses.e1!.peek()?.deleted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('packing facade', () => {
  it('inactive → legacy read filtered on deleted = false', async () => {
    const { result } = renderHook(() => useTripPackingItems(T1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(legacyCalls('trip_packing_items')[0]!.ops).toContainEqual(['eq', ['deleted', false]]);
  });

  it('bulk seed while serving → one batch in the store, rows returned, no network', async () => {
    mockActive = true;
    tier1RootLoaded$.tripPackingItems.set(true);
    const hook = renderHook(
      () => ({ list: useTripPackingItems(T1), create: useCreateTripPackingItems() }),
      { wrapper: wrapper() },
    );
    let rows!: TripPackingItem[];
    await act(async () => {
      rows = await hook.result.current.create.mutateAsync({
        tripId: T1,
        items: [
          { label: 'Sunscreen', category: 'toiletries', auto: true },
          { label: 'Adapter', category: 'tech', auto: true },
        ],
      });
    });
    expect(rows).toHaveLength(2);
    expect(legacyCalls('trip_packing_items')).toHaveLength(0);
    await waitFor(() =>
      expect(hook.result.current.list.data?.map((r) => r.label)).toEqual(['Adapter', 'Sunscreen']),
    );
  });

  it('tick + delete while the row is in the store → sync write / tombstone + undo', async () => {
    mockActive = true;
    tier1Store$.tripPackingItems.set({ k1: packing('k1', { label: 'Passport' }) });
    const hook = renderHook(
      () => ({ update: useUpdateTripPackingItem(), del: useDeleteTripPackingItem() }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await hook.result.current.update.mutateAsync({ itemId: 'k1', tripId: T1, patch: { checked: true } });
    });
    expect(tier1Store$.tripPackingItems.k1!.peek()?.checked).toBe(true);
    await act(async () => {
      await hook.result.current.del.mutateAsync({ itemId: 'k1', tripId: T1 });
    });
    expect(tier1Store$.tripPackingItems.k1!.peek()?.deleted).toBe(true);
    expect(getSessionUndoStack().peekLabel).toBe('Remove packing item');
    expect(legacyCalls('trip_packing_items')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reviewer fix: TanStack v5 mutations default to networkMode 'online', which
// PAUSES before mutationFn while onlineManager reports offline (web: the
// window `offline` event) — the Tier-1 store write would never run. Every
// Tier-1-capable mutation now sets networkMode 'always'. These use
// `mutate` + waitFor (not mutateAsync) so a regression fails as an
// assertion instead of hanging on a paused promise.
describe('offline (onlineManager offline) — Tier-1 writes still run', () => {
  beforeEach(() => {
    onlineManager.setOnline(false);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('expense create lands in the store while offline', async () => {
    mockActive = true;
    tier1RootLoaded$.tripExpenses.set(true);
    const { result } = renderHook(() => useCreateTripExpense(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ trip_id: T1, category: 'food', amount: 12, kind: 'actual' });
    });
    await waitFor(() => expect(Object.keys(tier1Store$.tripExpenses.peek() ?? {})).toHaveLength(1));
    const [row] = Object.values(tier1Store$.tripExpenses.peek() ?? {}) as TripExpense[];
    expect(row!.amount).toBe(12);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(legacyCalls('trip_expenses')).toHaveLength(0);
  });

  it('packing tick lands in the store while offline', async () => {
    mockActive = true;
    tier1Store$.tripPackingItems.set({ k1: packing('k1') });
    const { result } = renderHook(() => useUpdateTripPackingItem(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ itemId: 'k1', tripId: T1, patch: { checked: true } });
    });
    await waitFor(() => expect(tier1Store$.tripPackingItems.k1!.peek()?.checked).toBe(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(legacyCalls('trip_packing_items')).toHaveLength(0);
  });

  it('place create lands in the store while offline', async () => {
    mockActive = true;
    const existing = {
      id: 'p-existing',
      trip_id: T1,
      google_place_id: 'g0',
      lat: 1,
      lng: 2,
      deleted: false,
    } as unknown as TripPlace;
    tier1Store$.tripPlaces.set({ 'p-existing': existing });
    const { result } = renderHook(() => useCreateTripPlace(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ trip_id: T1, google_place_id: 'g-new', lat: 41, lng: 29 });
    });
    await waitFor(() => expect(Object.keys(tier1Store$.tripPlaces.peek() ?? {})).toHaveLength(2));
    const created = (Object.values(tier1Store$.tripPlaces.peek() ?? {}) as TripPlace[]).find(
      (r) => r.google_place_id === 'g-new',
    );
    expect(created).toBeDefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(legacyCalls('trip_places')).toHaveLength(0);
  });

  it('trip archive lands in the store while offline', async () => {
    mockActive = true;
    const trip = {
      id: T1,
      user_id: 'u1',
      title: 'Istanbul',
      archived_at: null,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
    } as unknown as Trip;
    tier1Store$.trips.set({ [T1]: trip });
    const { result } = renderHook(() => useArchiveTrip(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate(T1);
    });
    await waitFor(() => expect(tier1Store$.trips[T1]!.peek()?.archived_at).toEqual(expect.any(String)));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(legacyCalls('trips')).toHaveLength(0);
  });
});
