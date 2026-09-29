/**
 * src/api/trip-place-comments.ts — the count helper, thread / per-trip
 * reads, and the create + soft-delete mutations with optimistic updates.
 *
 * `../supabase` is a recording PostgREST-chain fake (`from()` logs builder
 * ops; each resolves to `mockResultFor(table)`, optionally a deferred
 * promise) plus `auth.getUser`.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type MockResult = { data: unknown; error: unknown };
type UserResult = { data: { user: { id: string } | null }; error: unknown };
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockResultFor = jest.fn<(table: string) => MockResult | Promise<MockResult>>();
const mockGetUser = jest.fn<() => Promise<UserResult>>();
type SessionResult = { data: { session: { user: { id: string } } | null }; error: unknown };
const mockGetSession = jest.fn<() => Promise<SessionResult>>();

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      mockCalls.push(rec);
      const result = mockResultFor(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'insert', 'update', 'single']) {
        chain[m] = (...args: unknown[]) => {
          rec.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
    auth: { getUser: () => mockGetUser(), getSession: () => mockGetSession() },
  },
}));

/* eslint-disable import/first */
import {
  countCommentsByPlace,
  tripPlaceCommentsKeys,
  useCreateTripPlaceComment,
  useDeleteTripPlaceComment,
  useTripComments,
  useTripPlaceComments,
  type TripPlaceComment,
} from '../trip-place-comments';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const PLACE = '00000000-0000-4000-8000-0000000000b1';
const PLACE2 = '00000000-0000-4000-8000-0000000000b2';
const ME = '11111111-1111-4111-8111-111111111111';

let seq = 0;
const comment = (extra: Partial<TripPlaceComment> = {}): TripPlaceComment => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  trip_id: TRIP,
  trip_place_id: PLACE,
  author_id: ME,
  body: 'Worth the queue',
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
  deleted: false,
  ...extra,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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

const placeKey = tripPlaceCommentsKeys.forTripPlace(PLACE);
const tripKey = tripPlaceCommentsKeys.forTrip(TRIP);

beforeEach(() => {
  mockCalls.splice(0);
  mockResultFor.mockReset();
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: ME } } }, error: null });
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('countCommentsByPlace', () => {
  it('rolls a flat list up into per-place counts', () => {
    const counts = countCommentsByPlace([
      comment(),
      comment({ trip_place_id: PLACE2 }),
      comment(),
      comment(),
    ]);
    expect(counts).toBeInstanceOf(Map);
    expect(Object.fromEntries(counts)).toEqual({ [PLACE]: 3, [PLACE2]: 1 });
  });

  it('returns an empty map for no comments', () => {
    expect(countCommentsByPlace([]).size).toBe(0);
  });
});

describe('reads', () => {
  it('useTripPlaceComments reads the live thread for one place, oldest first', async () => {
    const rows = [comment(), comment({ body: 'Agreed' })];
    mockResultFor.mockReturnValue({ data: rows, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripPlaceComments(PLACE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(rows);
    expect(mockCalls[0]!.table).toBe('trip_place_comments');
    expect(mockCalls[0]!.ops.slice(1)).toEqual([
      ['eq', ['trip_place_id', PLACE]],
      ['eq', ['deleted', false]],
      ['order', ['created_at', { ascending: true }]],
    ]);
  });

  it('useTripComments batch-reads the whole trip by the denormalized trip_id', async () => {
    mockResultFor.mockReturnValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripComments(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(mockCalls[0]!.ops.slice(1)).toEqual([
      ['eq', ['trip_id', TRIP]],
      ['eq', ['deleted', false]],
      ['order', ['created_at', { ascending: true }]],
    ]);
  });

  it('both reads surface PostgREST errors', async () => {
    const err = { message: 'boom' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const a = setup();
    const one = renderHook(() => useTripPlaceComments(PLACE), { wrapper: a.wrapper });
    await waitFor(() => expect(one.result.current.isError).toBe(true));
    expect(one.result.current.error).toBe(err);
    const b = setup();
    const all = renderHook(() => useTripComments(TRIP), { wrapper: b.wrapper });
    await waitFor(() => expect(all.result.current.isError).toBe(true));
    expect(all.result.current.error).toBe(err);
  });

  it('both reads stay idle without an id', async () => {
    const { wrapper } = setup();
    const one = renderHook(() => useTripPlaceComments(undefined), { wrapper });
    const all = renderHook(() => useTripComments(undefined), { wrapper });
    await act(async () => {});
    expect(one.result.current.fetchStatus).toBe('idle');
    expect(all.result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useCreateTripPlaceComment', () => {
  it('appends an optimistic row to both caches, inserts as the session user, then invalidates', async () => {
    const gate = deferred<MockResult>();
    mockResultFor.mockReturnValue(gate.promise);
    const { client, wrapper, invalidatedKeys } = setup();
    const existing = comment();
    client.setQueryData(placeKey, [existing]);
    client.setQueryData(tripKey, [existing]);
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });

    let pending!: Promise<TripPlaceComment>;
    await act(async () => {
      pending = result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body: 'Go early' });
      await flush();
    });

    for (const key of [placeKey, tripKey]) {
      const list = client.getQueryData<TripPlaceComment[]>(key)!;
      expect(list).toHaveLength(2);
      expect(list[1]).toMatchObject({
        trip_id: TRIP,
        trip_place_id: PLACE,
        author_id: ME,
        body: 'Go early',
        updated_at: null,
        deleted: false,
      });
      expect(list[1]!.id).toMatch(/^optimistic-/);
    }
    expect(mockCalls[0]!.ops[0]).toEqual([
      'insert',
      [{ trip_id: TRIP, trip_place_id: PLACE, author_id: ME, body: 'Go early' }],
    ]);

    const saved = comment({ body: 'Go early' });
    const out = await run(async () => {
      gate.resolve({ data: saved, error: null });
      return pending;
    });
    expect(out).toEqual(saved);
    expect(invalidatedKeys()).toEqual([placeKey, tripKey]);
  });

  it.each([
    ['an empty body', '', 'Comment cannot be empty'],
    ['an over-long body', 'x'.repeat(2001), 'Comment is too long'],
  ])('rejects %s before any network call and never flashes an optimistic row', async (_label, body, message) => {
    const { client, wrapper } = setup();
    const before = [comment()];
    client.setQueryData(placeKey, before);
    client.setQueryData(tripKey, before);
    const setData = jest.spyOn(client, 'setQueryData');
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body })),
    ).rejects.toThrow(message);
    expect(mockCalls).toHaveLength(0);
    // Validation runs before the optimistic insert: no cache write at all.
    expect(setData).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(client.getQueryData(placeKey)).toEqual(before);
    expect(client.getQueryData(tripKey)).toEqual(before);
  });

  it('appends the optimistic row from the local session without waiting on getUser', async () => {
    // getUser (network) hangs, e.g. offline. The optimistic append must not.
    mockGetUser.mockReturnValue(new Promise<UserResult>(() => undefined));
    const { client, wrapper } = setup();
    client.setQueryData(placeKey, []);
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });
    await act(async () => {
      void result.current
        .mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body: 'Offline note' })
        .catch(() => undefined);
      await flush();
    });
    expect(mockGetSession).toHaveBeenCalled();
    const list = client.getQueryData<TripPlaceComment[]>(placeKey)!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ author_id: ME, body: 'Offline note' });
  });

  it('rolls both caches back on an insert error', async () => {
    const err = { message: 'rls', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { client, wrapper, invalidate } = setup();
    const before = [comment()];
    client.setQueryData(placeKey, before);
    client.setQueryData(tripKey, before);
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });

    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body: 'hi' })),
    ).rejects.toBe(err);
    expect(client.getQueryData(placeKey)).toEqual(before);
    expect(client.getQueryData(tripKey)).toEqual(before);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('throws not_authenticated when signed out, without writing optimistic rows', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { client, wrapper } = setup();
    client.setQueryData(placeKey, []);
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body: 'hi' })),
    ).rejects.toThrow('not_authenticated');
    expect(mockCalls).toHaveLength(0);
    expect(client.getQueryData(placeKey)).toEqual([]);
  });

  it('rejects a server row that fails the row schema', async () => {
    mockResultFor.mockReturnValue({ data: { ...comment(), deleted: 'no' }, error: null });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateTripPlaceComment(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, tripPlaceId: PLACE, body: 'hi' })),
    ).rejects.toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useDeleteTripPlaceComment', () => {
  it('soft-deletes (UPDATE deleted=true) by id and removes the row from both caches', async () => {
    mockResultFor.mockReturnValue({ data: { id: 'x' }, error: null });
    const { client, wrapper, invalidatedKeys } = setup();
    const keep = comment();
    const drop = comment();
    client.setQueryData(placeKey, [keep, drop]);
    client.setQueryData(tripKey, [keep, drop, comment({ trip_place_id: PLACE2 })]);
    const { result } = renderHook(() => useDeleteTripPlaceComment(), { wrapper });

    const out = await run(() =>
      result.current.mutateAsync({ commentId: drop.id, tripPlaceId: PLACE, tripId: TRIP }),
    );

    expect(out).toEqual({ commentId: drop.id });
    expect(mockCalls[0]!.ops).toEqual([
      ['update', [{ deleted: true }]],
      ['eq', ['id', drop.id]],
      ['select', ['id']],
      ['single', []],
    ]);
    expect(client.getQueryData<TripPlaceComment[]>(placeKey)!.map((c) => c.id)).toEqual([keep.id]);
    expect(client.getQueryData<TripPlaceComment[]>(tripKey)).toHaveLength(2);
    expect(invalidatedKeys()).toEqual([placeKey, tripKey]);
  });

  it('restores both caches when the (RLS 0-row) update errors', async () => {
    const err = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { client, wrapper, invalidate } = setup();
    const before = [comment(), comment()];
    client.setQueryData(placeKey, before);
    client.setQueryData(tripKey, before);
    const { result } = renderHook(() => useDeleteTripPlaceComment(), { wrapper });

    await expect(
      run(() => result.current.mutateAsync({ commentId: before[0]!.id, tripPlaceId: PLACE, tripId: TRIP })),
    ).rejects.toBe(err);
    expect(client.getQueryData(placeKey)).toEqual(before);
    expect(client.getQueryData(tripKey)).toEqual(before);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
