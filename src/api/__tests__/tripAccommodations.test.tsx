/**
 * src/api/trip-accommodations.ts — schemas, list read and CRUD mutations.
 *
 * `../supabase` is a recording PostgREST-chain fake: every `from()` call logs
 * its builder ops and resolves to whatever `mockResultFor(table)` returns.
 * Asserts the query built, the Zod cross-field invariants (check-out after
 * check-in; a google_place_id needs coordinates) rejecting BEFORE any
 * network call, undefined-stripping on update, errors surfaced, and the
 * per-trip + trip-detail cache invalidation.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type MockResult = { data: unknown; error: unknown };
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockResultFor = jest.fn<(table: string) => MockResult>();

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      mockCalls.push(rec);
      const result = mockResultFor(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single']) {
        chain[m] = (...args: unknown[]) => {
          rec.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  },
}));

/* eslint-disable import/first */
import {
  tripAccommodationSchema,
  tripAccommodationsKeys,
  useCreateTripAccommodation,
  useDeleteTripAccommodation,
  useTripAccommodations,
  useUpdateTripAccommodation,
} from '../trip-accommodations';
import { tripsKeys } from '../_keys';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const STAY = '00000000-0000-4000-8000-0000000000a1';

const row = (extra: Record<string, unknown> = {}) => ({
  id: STAY,
  trip_id: TRIP,
  name: 'Hotel Artemide',
  google_place_id: null,
  address: 'Via Nazionale 22, Rome',
  lat: null,
  lng: null,
  check_in_date: '2026-10-01',
  check_out_date: '2026-10-04',
  notes: null,
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
  ...extra,
});

// Runs a mutation inside act() and lets TanStack's deferred observer
// notification (setTimeout 0) land before act() exits.
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
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
  return { client, wrapper, invalidate, invalidatedKeys };
}

function opsOf(i = 0) {
  return mockCalls[i]!.ops;
}

beforeEach(() => {
  mockCalls.splice(0);
  mockResultFor.mockReset();
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('tripAccommodationSchema', () => {
  it('accepts a well-formed row', () => {
    expect(tripAccommodationSchema.parse(row())).toEqual(row());
  });

  it('rejects check_out_date on or before check_in_date', () => {
    const res = tripAccommodationSchema.safeParse(row({ check_out_date: '2026-10-01' }));
    expect(res.success).toBe(false);
    expect(res.error!.issues[0]!.path).toEqual(['check_out_date']);
  });

  it('rejects a google_place_id without both coordinates', () => {
    const res = tripAccommodationSchema.safeParse(row({ google_place_id: 'ChIJ123', lat: 41.9, lng: null }));
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.path)).toContainEqual(['lat']);
    expect(
      tripAccommodationSchema.safeParse(row({ google_place_id: 'ChIJ123', lat: 41.9, lng: 12.5 })).success,
    ).toBe(true);
  });
});

describe('useTripAccommodations', () => {
  it('reads the trip’s stays ordered by check-in date', async () => {
    const rows = [row(), row({ id: '00000000-0000-4000-8000-0000000000a2', check_in_date: '2026-10-04', check_out_date: '2026-10-06' })];
    mockResultFor.mockReturnValue({ data: rows, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripAccommodations(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(rows);
    expect(mockCalls[0]!.table).toBe('trip_accommodations');
    expect(opsOf()).toEqual([
      ['select', ['*']],
      ['eq', ['trip_id', TRIP]],
      ['order', ['check_in_date', { ascending: true }]],
    ]);
  });

  it('maps null data to [] and surfaces errors', async () => {
    mockResultFor.mockReturnValueOnce({ data: null, error: null });
    const a = setup();
    const ok = renderHook(() => useTripAccommodations(TRIP), { wrapper: a.wrapper });
    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(ok.result.current.data).toEqual([]);

    const err = { message: 'boom', code: 'XX000' };
    mockResultFor.mockReturnValueOnce({ data: null, error: err });
    const b = setup();
    const bad = renderHook(() => useTripAccommodations(TRIP), { wrapper: b.wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBe(err);
  });

  it('does not query without a trip id', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripAccommodations(undefined), { wrapper });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useCreateTripAccommodation', () => {
  const input = {
    trip_id: TRIP,
    name: 'Hotel Artemide',
    check_in_date: '2026-10-01',
    check_out_date: '2026-10-04',
    google_place_id: 'ChIJ123',
    lat: 41.9,
    lng: 12.49,
  };

  it('inserts the validated payload, returns the parsed row and invalidates caches', async () => {
    const saved = row({ google_place_id: 'ChIJ123', lat: 41.9, lng: 12.49 });
    mockResultFor.mockReturnValue({ data: saved, error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useCreateTripAccommodation(), { wrapper });

    const out = await run(() => result.current.mutateAsync(input));

    expect(out).toEqual(saved);
    expect(opsOf()).toEqual([
      ['insert', [input]],
      ['select', ['*']],
      ['single', []],
    ]);
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([tripAccommodationsKeys.forTrip(TRIP), tripsKeys.detail(TRIP)]),
    );
  });

  it.each([
    ['check-out before check-in', { check_out_date: '2026-09-30' }, 'check_out_date must be after check_in_date'],
    ['place id without coordinates', { lng: null }, 'lat and lng are required'],
    ['empty name', { name: '' }, ''],
  ])('rejects %s before any network call', async (_label, patch, message) => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync({ ...input, ...patch }))).rejects.toThrow(message);
    expect(mockCalls).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces an insert error without invalidating', async () => {
    const err = { message: 'new row violates row-level security policy', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync(input))).rejects.toBe(err);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('rejects a server row that fails the row schema', async () => {
    mockResultFor.mockReturnValue({ data: { ...row(), id: 'not-a-uuid' }, error: null });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync(input))).rejects.toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useUpdateTripAccommodation', () => {
  it('updates by id, sending only the named columns', async () => {
    mockResultFor.mockReturnValue({ data: row({ name: 'Renamed' }), error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useUpdateTripAccommodation(), { wrapper });

    const out = await run(() =>
      result.current.mutateAsync({ id: STAY, name: 'Renamed', notes: undefined, address: null }),
    );

    expect(out.name).toBe('Renamed');
    // `notes: undefined` is stripped; an explicit null clear is kept.
    expect(opsOf()).toEqual([
      ['update', [{ name: 'Renamed', address: null }]],
      ['eq', ['id', STAY]],
      ['select', ['*']],
      ['single', []],
    ]);
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([tripAccommodationsKeys.forTrip(TRIP), tripsKeys.detail(TRIP)]),
    );
  });

  it('lets a single-date patch through to the server (cross-field check needs both)', async () => {
    mockResultFor.mockReturnValue({ data: row({ check_out_date: '2026-10-05' }), error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripAccommodation(), { wrapper });
    await run(() => result.current.mutateAsync({ id: STAY, check_out_date: '2026-10-05' }));
    expect(opsOf()[0]).toEqual(['update', [{ check_out_date: '2026-10-05' }]]);
  });

  it.each([
    ['inverted date pair', { check_in_date: '2026-10-05', check_out_date: '2026-10-05' }],
    ['place id with a null coordinate', { google_place_id: 'ChIJ9', lat: 1, lng: null }],
  ])('rejects a %s client-side', async (_label, patch) => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync({ id: STAY, ...patch }))).rejects.toBeTruthy();
    expect(mockCalls).toHaveLength(0);
  });

  it('surfaces an update error', async () => {
    const err = { message: 'check constraint', code: '23514' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUpdateTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync({ id: STAY, name: 'x' }))).rejects.toBe(err);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useDeleteTripAccommodation', () => {
  it('deletes by id and invalidates the parent trip’s caches', async () => {
    mockResultFor.mockReturnValue({ data: null, error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useDeleteTripAccommodation(), { wrapper });

    const out = await run(() => result.current.mutateAsync({ id: STAY, trip_id: TRIP }));

    expect(out).toBe(STAY);
    expect(opsOf()).toEqual([
      ['delete', []],
      ['eq', ['id', STAY]],
    ]);
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([tripAccommodationsKeys.forTrip(TRIP), tripsKeys.detail(TRIP)]),
    );
  });

  it('surfaces a delete error', async () => {
    const err = { message: 'denied', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useDeleteTripAccommodation(), { wrapper });
    await expect(run(() => result.current.mutateAsync({ id: STAY, trip_id: TRIP }))).rejects.toBe(err);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
