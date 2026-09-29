/**
 * src/api/trip-place-reactions.ts — per-place / per-trip / cross-trip reads
 * and the set-or-clear reaction mutation with optimistic cache surgery.
 *
 * `../supabase` is a recording PostgREST-chain fake (`from()` logs builder
 * ops; each resolves to `mockResultFor(table)`, which may be a deferred
 * promise so the optimistic state can be observed mid-flight) plus
 * `auth.getUser` (mutationFn) / `auth.getSession` (onMutate, local only).
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
      for (const m of ['select', 'eq', 'order', 'upsert', 'delete', 'single', 'maybeSingle']) {
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
  tripPlaceReactionsKeys,
  useAllUserReactions,
  useSetTripPlaceReaction,
  useTripPlaceReaction,
  useTripReactions,
  type TripPlaceReaction,
} from '../trip-place-reactions';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const PLACE = '00000000-0000-4000-8000-0000000000b1';
const OTHER_PLACE = '00000000-0000-4000-8000-0000000000b2';
const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '99999999-9999-4999-8999-999999999999';

const reaction = (extra: Partial<TripPlaceReaction> = {}): TripPlaceReaction => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  trip_place_id: PLACE,
  user_id: ME,
  reaction: 'liked',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
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

describe('useTripPlaceReaction', () => {
  it('reads the caller’s single row for the place and validates it', async () => {
    mockResultFor.mockReturnValue({ data: reaction(), error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripPlaceReaction(PLACE, ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(reaction());
    expect(mockCalls[0]!.table).toBe('trip_place_reactions');
    const ops = mockCalls[0]!.ops;
    expect(ops.slice(1)).toEqual([
      ['eq', ['trip_place_id', PLACE]],
      ['eq', ['user_id', ME]],
      ['maybeSingle', []],
    ]);
  });

  it('returns null (not an error) when the user has not reacted', async () => {
    mockResultFor.mockReturnValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripPlaceReaction(PLACE, ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('fails the query on an unknown reaction value or a PostgREST error', async () => {
    mockResultFor.mockReturnValueOnce({ data: reaction({ reaction: 'meh' as 'liked' }), error: null });
    const a = setup();
    const bad = renderHook(() => useTripPlaceReaction(PLACE, ME), { wrapper: a.wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));

    const err = { message: 'boom' };
    mockResultFor.mockReturnValueOnce({ data: null, error: err });
    const b = setup();
    const failed = renderHook(() => useTripPlaceReaction(PLACE, ME), { wrapper: b.wrapper });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    expect(failed.result.current.error).toBe(err);
  });

  it('keys the cache by user so an account switch never serves another user’s reaction', async () => {
    mockResultFor.mockReturnValueOnce({ data: reaction(), error: null });
    const { client, wrapper } = setup();
    const first = renderHook(() => useTripPlaceReaction(PLACE, ME), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(tripPlaceReactionsKeys.forTripPlaceUser(PLACE, ME))).toEqual(reaction());

    // Same device, same QueryClient, a different signed-in user.
    const gate = deferred<MockResult>();
    mockResultFor.mockReturnValueOnce(gate.promise);
    const second = renderHook(() => useTripPlaceReaction(PLACE, FRIEND), { wrapper });
    await act(async () => {});
    expect(second.result.current.data).toBeUndefined();
    await run(async () => {
      gate.resolve({ data: null, error: null });
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toBeNull();
    expect(mockCalls[1]!.ops).toContainEqual(['eq', ['user_id', FRIEND]]);
  });

  it('stays idle until the user id is known', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripPlaceReaction(PLACE, undefined), { wrapper });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useTripReactions', () => {
  it('inner-joins trip_places, excludes tombstoned places and strips the embed', async () => {
    const raw = [
      { ...reaction(), trip_places: { trip_id: TRIP } },
      { ...reaction({ id: '00000000-0000-4000-8000-0000000000e2', user_id: FRIEND, reaction: 'disliked' }), trip_places: { trip_id: TRIP } },
    ];
    mockResultFor.mockReturnValue({ data: raw, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripReactions(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const ops = mockCalls[0]!.ops;
    expect(String(ops[0]![1][0])).toContain('trip_places!inner(trip_id)');
    expect(ops.slice(1)).toEqual([
      ['eq', ['trip_places.trip_id', TRIP]],
      ['eq', ['trip_places.deleted', false]],
      ['order', ['created_at', { ascending: true }]],
    ]);
    expect(result.current.data).toEqual([
      reaction(),
      reaction({ id: '00000000-0000-4000-8000-0000000000e2', user_id: FRIEND, reaction: 'disliked' }),
    ]);
    expect(result.current.data![0]).not.toHaveProperty('trip_places');
  });

  it('surfaces errors', async () => {
    const err = { message: 'boom' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripReactions(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(err);
  });
});

describe('useAllUserReactions', () => {
  it('reads the signed-in user’s reactions, most recently updated first', async () => {
    mockResultFor.mockReturnValue({ data: [reaction()], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAllUserReactions(ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([reaction()]);
    expect(mockCalls[0]!.ops.slice(1)).toEqual([
      ['eq', ['user_id', ME]],
      ['order', ['updated_at', { ascending: false }]],
    ]);
  });

  it('stays idle without querying when signed out', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAllUserReactions(undefined), { wrapper });
    await act(async () => {});
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(mockCalls).toHaveLength(0);
  });

  it('keys the list by user so an account switch refetches instead of reusing the cache', async () => {
    mockResultFor.mockReturnValue({ data: [reaction()], error: null });
    const { client, wrapper } = setup();
    const mine = renderHook(() => useAllUserReactions(ME), { wrapper });
    await waitFor(() => expect(mine.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(tripPlaceReactionsKeys.mineFor(ME))).toEqual([reaction()]);

    mockResultFor.mockReturnValue({ data: [], error: null });
    const theirs = renderHook(() => useAllUserReactions(FRIEND), { wrapper });
    await waitFor(() => expect(theirs.result.current.isSuccess).toBe(true));
    expect(theirs.result.current.data).toEqual([]);
    expect(mockCalls[1]!.ops).toContainEqual(['eq', ['user_id', FRIEND]]);
  });
});

describe('useSetTripPlaceReaction', () => {
  const placeKey = tripPlaceReactionsKeys.forTripPlaceUser(PLACE, ME);
  const tripKey = tripPlaceReactionsKeys.forTrip(TRIP);

  it('upserts on (trip_place_id, user_id) and predicts the new state in both caches', async () => {
    const gate = deferred<MockResult>();
    mockResultFor.mockReturnValue(gate.promise);
    const { client, wrapper, invalidatedKeys } = setup();
    const friendRow = reaction({ id: '00000000-0000-4000-8000-0000000000e9', user_id: FRIEND });
    const mine = reaction({ reaction: 'disliked' });
    client.setQueryData(placeKey, mine);
    client.setQueryData(tripKey, [friendRow, mine]);
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: 'liked' });
      await flush();
    });

    // Optimistic: my row flips in place (id + created_at preserved), friend untouched.
    const place = client.getQueryData<TripPlaceReaction>(placeKey)!;
    expect(place).toMatchObject({ id: mine.id, reaction: 'liked', created_at: mine.created_at, user_id: ME });
    const trip = client.getQueryData<TripPlaceReaction[]>(tripKey)!;
    expect(trip.map((r) => [r.user_id, r.reaction])).toEqual([
      [FRIEND, 'liked'],
      [ME, 'liked'],
    ]);

    const upsert = mockCalls[0]!.ops.find(([m]) => m === 'upsert')!;
    expect(upsert[1]).toEqual([
      { trip_place_id: PLACE, user_id: ME, reaction: 'liked' },
      { onConflict: 'trip_place_id,user_id', ignoreDuplicates: false },
    ]);

    const saved = reaction({ reaction: 'liked', updated_at: '2026-09-29T12:00:00Z' });
    const out = await run(async () => {
      gate.resolve({ data: saved, error: null });
      return pending;
    });
    expect(out).toEqual({ kind: 'upserted', row: saved });
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        tripPlaceReactionsKeys.forTripPlace(PLACE),
        tripKey,
        tripPlaceReactionsKeys.mine(),
      ]),
    );
  });

  it('appends a synthesized row to the trip cache for a first reaction', async () => {
    const gate = deferred<MockResult>();
    mockResultFor.mockReturnValue(gate.promise);
    const { client, wrapper } = setup();
    client.setQueryData(tripKey, []);
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: 'disliked' });
      await flush();
    });
    const trip = client.getQueryData<TripPlaceReaction[]>(tripKey)!;
    expect(trip).toHaveLength(1);
    expect(trip[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(trip[0]!.id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(trip[0]).toMatchObject({
      trip_place_id: PLACE,
      user_id: ME,
      reaction: 'disliked',
    });
    await run(async () => {
      gate.resolve({ data: reaction({ reaction: 'disliked' }), error: null });
      return pending;
    });
  });

  it('mints distinct temp ids for concurrent first reactions', async () => {
    const gate = deferred<MockResult>();
    mockResultFor.mockReturnValue(gate.promise);
    const { client, wrapper } = setup();
    client.setQueryData(tripKey, []);
    const a = renderHook(() => useSetTripPlaceReaction(), { wrapper });
    const b = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    let pa!: Promise<unknown>;
    let pb!: Promise<unknown>;
    await act(async () => {
      pa = a.result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: 'liked' });
      pb = b.result.current.mutateAsync({ tripPlaceId: OTHER_PLACE, tripId: TRIP, reaction: 'liked' });
      await flush();
    });
    const ids = client.getQueryData<TripPlaceReaction[]>(tripKey)!.map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    await run(async () => {
      gate.resolve({ data: reaction(), error: null });
      await Promise.all([pa, pb]);
    });
  });

  it('writes the optimistic state from the local session without waiting on getUser', async () => {
    // getUser (network) hangs, e.g. offline. The optimistic write must not.
    mockGetUser.mockReturnValue(new Promise<UserResult>(() => undefined));
    const { client, wrapper } = setup();
    client.setQueryData(placeKey, null);
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });
    await act(async () => {
      void result.current
        .mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: 'liked' })
        .catch(() => undefined);
      await flush();
    });
    expect(mockGetSession).toHaveBeenCalled();
    expect(client.getQueryData<TripPlaceReaction>(placeKey)).toMatchObject({ reaction: 'liked', user_id: ME });
    expect(mockCalls).toHaveLength(0);
  });

  it('clears with a scoped DELETE and drops my row from both caches', async () => {
    mockResultFor.mockReturnValue({ data: null, error: null });
    const { client, wrapper } = setup();
    const friendRow = reaction({ id: '00000000-0000-4000-8000-0000000000e9', user_id: FRIEND });
    const mineOther = reaction({ id: '00000000-0000-4000-8000-0000000000e8', trip_place_id: OTHER_PLACE });
    client.setQueryData(placeKey, reaction());
    client.setQueryData(tripKey, [friendRow, reaction(), mineOther]);
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    const out = await run(() =>
      result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: null }),
    );

    expect(out).toEqual({ kind: 'deleted', tripPlaceId: PLACE });
    expect(mockCalls[0]!.ops).toEqual([
      ['delete', []],
      ['eq', ['trip_place_id', PLACE]],
      ['eq', ['user_id', ME]],
    ]);
    // Caches were invalidated afterwards, but the optimistic data stays until a refetch.
    expect(client.getQueryData(placeKey)).toBeNull();
    expect(client.getQueryData<TripPlaceReaction[]>(tripKey)!.map((r) => r.id)).toEqual([
      friendRow.id,
      mineOther.id,
    ]);
  });

  it('rolls both caches back when the write fails', async () => {
    const err = { message: 'new row violates row-level security policy', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { client, wrapper, invalidate } = setup();
    const before = reaction({ reaction: 'disliked' });
    client.setQueryData(placeKey, before);
    client.setQueryData(tripKey, [before]);
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    await expect(
      run(() => result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: 'liked' })),
    ).rejects.toBe(err);

    expect(client.getQueryData(placeKey)).toEqual(before);
    expect(client.getQueryData(tripKey)).toEqual([before]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('throws not_authenticated and leaves caches untouched when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { client, wrapper } = setup();
    client.setQueryData(placeKey, reaction());
    const { result } = renderHook(() => useSetTripPlaceReaction(), { wrapper });

    await expect(
      run(() => result.current.mutateAsync({ tripPlaceId: PLACE, tripId: TRIP, reaction: null })),
    ).rejects.toThrow('not_authenticated');
    expect(mockCalls).toHaveLength(0);
    expect(client.getQueryData(placeKey)).toEqual(reaction());
  });
});
