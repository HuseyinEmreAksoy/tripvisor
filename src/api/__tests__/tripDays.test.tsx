/**
 * src/api/trip-days.ts — per-day row reads + the partial-upsert mutation.
 *
 * `../supabase` is a recording PostgREST-chain fake: every `from()` call logs
 * its builder ops and resolves to whatever `mockResultFor(table)` returns.
 * Asserts:
 *   - useTripDays builds the trip-scoped, day_index-ordered query and
 *     surfaces PostgREST errors;
 *   - useUpdateTripDay only SENDS the fields present on the input (so a
 *     start-time write can't clobber notes), upserts on (trip_id, day_index),
 *     invalidates the days list + trip detail, and rejects bad input before
 *     any network call.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type MockResult = { data: unknown; error: unknown };
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockResultFor = jest.fn<(table: string) => MockResult>();
const mockGetUser = jest.fn<() => Promise<{ data: { user: { id: string } | null }; error: unknown }>>();

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      mockCalls.push(rec);
      const result = mockResultFor(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'upsert', 'single']) {
        chain[m] = (...args: unknown[]) => {
          rec.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
    auth: { getUser: () => mockGetUser() },
  },
}));

/* eslint-disable import/first */
import { tripDaysKeys, useTripDays, useUpdateTripDay } from '../trip-days';
import { tripsKeys } from '../_keys';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const USER = '11111111-1111-4111-8111-111111111111';

const dayRow = (dayIndex: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000010${dayIndex}`,
  trip_id: TRIP,
  day_index: dayIndex,
  start_place_id: null,
  end_place_id: null,
  notes: null,
  start_time: null,
  transport_mode: null,
  ...extra,
});

// Runs a mutation inside act() and lets TanStack's deferred observer
// notification (setTimeout 0) land before act() exits, so no update escapes.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function run<T>(fn: () => Promise<T>): Promise<T> {
  let out!: Promise<T>;
  await act(async () => {
    out = fn();
    await out.catch(() => undefined);
    await flush();
  });
  return out;
}

const clients: QueryClient[] = [];
function setup() {
  // gcTime Infinity: no 5-minute GC timer may outlive a test.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper, invalidate };
}

beforeEach(() => {
  mockCalls.splice(0);
  mockResultFor.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('tripDaysKeys', () => {
  it('scopes the per-trip list under the shared prefix', () => {
    expect(tripDaysKeys.forTrip(TRIP)).toEqual(['trip-days', 'list', { tripId: TRIP }]);
    expect(tripDaysKeys.forTrip(TRIP).slice(0, 1)).toEqual([...tripDaysKeys.all]);
  });
});

describe('useTripDays', () => {
  it('reads trip_days for the trip ordered by day_index ascending', async () => {
    const rows = [dayRow(0), dayRow(1, { notes: 'Museum day' })];
    mockResultFor.mockReturnValue({ data: rows, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDays(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(rows);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]!.table).toBe('trip_days');
    expect(mockCalls[0]!.ops).toEqual([
      ['select', ['*']],
      ['eq', ['trip_id', TRIP]],
      ['order', ['day_index', { ascending: true }]],
    ]);
  });

  it('maps a null payload to an empty list', async () => {
    mockResultFor.mockReturnValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDays(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces a PostgREST error as a failed query', async () => {
    const err = { message: 'permission denied', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDays(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(err);
  });

  it('stays idle (no request) without a trip id', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDays(undefined), { wrapper });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useUpdateTripDay', () => {
  function upsertPayload() {
    const upsert = mockCalls[0]!.ops.find(([m]) => m === 'upsert');
    return upsert![1];
  }

  it('upserts only the provided fields on (trip_id, day_index) and invalidates caches', async () => {
    const saved = dayRow(2, { start_time: '08:30' });
    mockResultFor.mockReturnValue({ data: saved, error: null });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });

    const returned = await run(() =>
      result.current.mutateAsync({ trip_id: TRIP, day_index: 2, start_time: '08:30' }),
    );

    expect(returned).toEqual(saved);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    // notes / transport_mode were omitted → absent from the payload (not null).
    expect(upsertPayload()).toEqual([
      { trip_id: TRIP, day_index: 2, start_time: '08:30' },
      { onConflict: 'trip_id,day_index' },
    ]);
    expect(mockCalls[0]!.ops.map(([m]) => m)).toEqual(['upsert', 'select', 'single']);

    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(expect.arrayContaining([tripDaysKeys.forTrip(TRIP), tripsKeys.detail(TRIP)]));
  });

  it('forwards an explicit null to clear a field, alongside other fields', async () => {
    mockResultFor.mockReturnValue({ data: dayRow(0), error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await run(() =>
      result.current.mutateAsync({ trip_id: TRIP, day_index: 0, notes: null, transport_mode: 'walking' }),
    );
    expect(upsertPayload()[0]).toEqual({ trip_id: TRIP, day_index: 0, notes: null, transport_mode: 'walking' });
  });

  it('rejects an invalid start_time before touching auth or PostgREST', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ trip_id: TRIP, day_index: 0, start_time: '25:00' })),
    ).rejects.toThrow(/HH:MM/);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockCalls).toHaveLength(0);
  });

  it('rejects flight/ferry as a per-day transport mode', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await expect(
      run(() =>
        result.current.mutateAsync({
          trip_id: TRIP,
          day_index: 0,
          transport_mode: 'flight' as unknown as 'driving',
        }),
      ),
    ).rejects.toBeTruthy();
    expect(mockCalls).toHaveLength(0);
  });

  it('fails with "Not authenticated" when there is no session user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ trip_id: TRIP, day_index: 0, notes: 'x' })),
    ).rejects.toThrow('Not authenticated');
    expect(mockCalls).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('rethrows an auth error as-is', async () => {
    const authErr = new Error('JWT expired');
    mockGetUser.mockResolvedValue({ data: { user: null }, error: authErr });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ trip_id: TRIP, day_index: 0, notes: 'x' })),
    ).rejects.toBe(authErr);
  });

  it('surfaces an upsert error and skips invalidation', async () => {
    const err = { message: 'violates check constraint', code: '23514' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTripDay(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ trip_id: TRIP, day_index: 0, notes: 'x' })),
    ).rejects.toBe(err);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
