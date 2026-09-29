/**
 * src/api/trip-collaborators.ts — collaborator list read + the
 * `manage-collaborators` Edge Function mutations.
 *
 * `../supabase` is faked down to `from()` (a recording PostgREST chain) and
 * `functions.invoke`. Asserts the request bodies per action, the typed
 * `CollaboratorError` parsed from the `{ error: { code, message } }`
 * envelope, raw errors rethrown untouched, token currying for accept /
 * decline, the optimistic role flip + rollback, and cache invalidation.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type MockResult = { data: unknown; error: unknown };
type InvokeResult = { data: unknown; error: unknown };
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockResultFor = jest.fn<(table: string) => MockResult>();
const mockInvoke = jest.fn<(name: string, opts: { body: Record<string, unknown> }) => Promise<InvokeResult>>();

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      mockCalls.push(rec);
      const result = mockResultFor(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) {
        chain[m] = (...args: unknown[]) => {
          rec.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
    functions: {
      invoke: (name: string, opts: { body: Record<string, unknown> }) => mockInvoke(name, opts),
    },
  },
}));

/* eslint-disable import/first */
import {
  CollaboratorError,
  tripCollaboratorsKeys,
  useAcceptCollaboratorInvite,
  useDeclineCollaboratorInvite,
  useInviteCollaborator,
  useRevokeCollaborator,
  useTripCollaborators,
  useUpdateCollaborator,
  type TripCollaborator,
} from '../trip-collaborators';
import { EdgeFunctionError } from '../_errors';
import { tripsKeys } from '../_keys';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const collab = (id: string, extra: Partial<TripCollaborator> = {}): TripCollaborator => ({
  id,
  trip_id: TRIP,
  invitee_email: `${id.slice(-2)}@example.com`,
  user_id: null,
  role: 'viewer',
  status: 'accepted',
  created_at: '2026-09-29T10:00:00Z',
  accepted_at: '2026-09-29T11:00:00Z',
  revoked_at: null,
  ...extra,
});

/** A FunctionsHttpError-like error whose `.context` is the non-2xx Response. */
function httpError(status: number, body: unknown, message = 'Edge Function returned a non-2xx status code') {
  return Object.assign(new Error(message), {
    context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  });
}

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

function invokedBodies() {
  return mockInvoke.mock.calls.map(([name, opts]) => ({ name, body: opts.body }));
}

beforeEach(() => {
  mockCalls.splice(0);
  mockResultFor.mockReset();
  mockInvoke.mockReset();
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('useTripCollaborators', () => {
  it('reads the explicit projection (never invite_token) ordered by created_at', async () => {
    const rows = [collab(C1), collab(C2, { status: 'pending', accepted_at: null })];
    mockResultFor.mockReturnValue({ data: rows, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripCollaborators(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(rows);
    expect(mockCalls[0]!.table).toBe('trip_collaborators');
    const [select, eq, order] = mockCalls[0]!.ops;
    expect(select![0]).toBe('select');
    expect(String(select![1][0])).not.toContain('invite_token');
    expect(String(select![1][0])).toContain('invitee_email');
    expect(eq).toEqual(['eq', ['trip_id', TRIP]]);
    expect(order).toEqual(['order', ['created_at', { ascending: true }]]);
  });

  it('surfaces a read error; stays idle without a trip id', async () => {
    const err = { message: 'boom' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const a = setup();
    const bad = renderHook(() => useTripCollaborators(TRIP), { wrapper: a.wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBe(err);

    mockCalls.splice(0);
    const b = setup();
    const idle = renderHook(() => useTripCollaborators(undefined), { wrapper: b.wrapper });
    await act(async () => {});
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useInviteCollaborator', () => {
  const ok = {
    ok: true,
    collaboratorId: C1,
    status: 'pending',
    role: 'editor',
    emailSent: true,
    inviteUrl: 'https://tripvisor.app/invite/abc',
  };

  it('invokes manage-collaborators with the invite body and invalidates the trip’s list', async () => {
    mockInvoke.mockResolvedValue({ data: ok, error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useInviteCollaborator(), { wrapper });

    const res = await run(() =>
      result.current.mutateAsync({ tripId: TRIP, inviteeEmail: 'friend@example.com', role: 'editor' }),
    );

    expect(res).toEqual(ok);
    expect(invokedBodies()).toEqual([
      {
        name: 'manage-collaborators',
        body: { action: 'invite', tripId: TRIP, inviteeEmail: 'friend@example.com', role: 'editor' },
      },
    ]);
    expect(invalidatedKeys()).toEqual([tripCollaboratorsKeys.forTrip(TRIP)]);
  });

  it('omits role from the body when not given (server default applies)', async () => {
    mockInvoke.mockResolvedValue({ data: ok, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteCollaborator(), { wrapper });
    await run(() => result.current.mutateAsync({ tripId: TRIP, inviteeEmail: 'f@example.com' }));
    expect(invokedBodies()[0]!.body).toEqual({ action: 'invite', tripId: TRIP, inviteeEmail: 'f@example.com' });
    expect('role' in invokedBodies()[0]!.body).toBe(false);
  });

  it('parses the error envelope into a typed CollaboratorError', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: { code: 'already_invited', message: 'Already invited' } }),
    });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useInviteCollaborator(), { wrapper });

    const err = await run(() =>
      result.current.mutateAsync({ tripId: TRIP, inviteeEmail: 'f@example.com' }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CollaboratorError);
    expect(err).toBeInstanceOf(EdgeFunctionError);
    expect(err).toMatchObject({ name: 'CollaboratorError', code: 'already_invited', status: 409, message: 'Already invited' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('rethrows a non-envelope (network) error untouched', async () => {
    const netErr = new Error('Failed to send a request to the Edge Function');
    mockInvoke.mockResolvedValue({ data: null, error: netErr });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteCollaborator(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, inviteeEmail: 'f@example.com' })),
    ).rejects.toBe(netErr);
  });

  it('turns an empty 2xx response into internal_error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useInviteCollaborator(), { wrapper });
    const err = await run(() =>
      result.current.mutateAsync({ tripId: TRIP, inviteeEmail: 'f@example.com' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CollaboratorError);
    expect(err).toMatchObject({ code: 'internal_error', status: 500 });
  });
});

describe('useAcceptCollaboratorInvite', () => {
  it('uses the curried token and refreshes the trip + trips list', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, tripId: TRIP, role: 'viewer' }, error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useAcceptCollaboratorInvite('tok-hook'), { wrapper });

    await run(() => result.current.mutateAsync());

    expect(invokedBodies()).toEqual([
      { name: 'manage-collaborators', body: { action: 'accept', token: 'tok-hook' } },
    ]);
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([tripCollaboratorsKeys.forTrip(TRIP), tripsKeys.detail(TRIP), tripsKeys.all]),
    );
  });

  it('prefers a call-time token over the curried one', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, tripId: TRIP, role: 'viewer' }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptCollaboratorInvite('tok-hook'), { wrapper });
    await run(() => result.current.mutateAsync({ token: 'tok-call' }));
    expect(invokedBodies()[0]!.body).toEqual({ action: 'accept', token: 'tok-call' });
  });

  it('fails fast without any token', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptCollaboratorInvite(), { wrapper });
    await expect(run(() => result.current.mutateAsync())).rejects.toThrow('token required to accept an invite');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('surfaces invite_expired as a typed error', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(410, { error: { code: 'invite_expired', message: '' } }, 'gone'),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptCollaboratorInvite('t'), { wrapper });
    const err = await run(() => result.current.mutateAsync()).catch((e: unknown) => e);
    // Empty envelope message → falls back to the invoke error's message.
    expect(err).toMatchObject({ code: 'invite_expired', status: 410, message: 'gone' });
  });
});

describe('useDeclineCollaboratorInvite', () => {
  it('declines with the token and invalidates the trip list + trips', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, tripId: TRIP }, error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useDeclineCollaboratorInvite(), { wrapper });

    await run(() => result.current.mutateAsync({ token: 'tok-d' }));

    expect(invokedBodies()[0]!.body).toEqual({ action: 'decline', token: 'tok-d' });
    expect(invalidatedKeys()).toEqual([tripCollaboratorsKeys.forTrip(TRIP), tripsKeys.all]);
  });

  it('fails fast without any token', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineCollaboratorInvite(), { wrapper });
    await expect(run(() => result.current.mutateAsync())).rejects.toThrow('token required to decline an invite');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('useRevokeCollaborator', () => {
  it('revokes by collaborator id and invalidates the trip list + trips', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, collaboratorId: C1, status: 'revoked' },
      error: null,
    });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useRevokeCollaborator(), { wrapper });

    await run(() => result.current.mutateAsync({ collaboratorId: C1, tripId: TRIP }));

    expect(invokedBodies()[0]!.body).toEqual({ action: 'revoke', collaboratorId: C1 });
    expect(invalidatedKeys()).toEqual([tripCollaboratorsKeys.forTrip(TRIP), tripsKeys.all]);
  });
});

describe('useUpdateCollaborator', () => {
  it('flips the role optimistically, then invalidates on success', async () => {
    const gate = deferred<InvokeResult>();
    mockInvoke.mockReturnValue(gate.promise);
    const { client, wrapper, invalidatedKeys } = setup();
    const key = tripCollaboratorsKeys.forTrip(TRIP);
    client.setQueryData<TripCollaborator[]>(key, [collab(C1), collab(C2)]);
    const { result } = renderHook(() => useUpdateCollaborator(), { wrapper });

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.mutateAsync({ collaboratorId: C1, tripId: TRIP, role: 'editor' });
      await flush();
    });
    // Mid-flight: only C1 changed.
    expect(client.getQueryData<TripCollaborator[]>(key)!.map((r) => r.role)).toEqual(['editor', 'viewer']);
    expect(invokedBodies()[0]!.body).toEqual({ action: 'update', collaboratorId: C1, role: 'editor' });

    await run(async () => {
      gate.resolve({ data: { ok: true, collaboratorId: C1, role: 'editor' }, error: null });
      return pending;
    });
    expect(invalidatedKeys()).toEqual([key]);
  });

  it('rolls the cache back to the snapshot on error', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: { code: 'not_owner', message: 'Only the owner can do that' } }),
    });
    const { client, wrapper, invalidate } = setup();
    const key = tripCollaboratorsKeys.forTrip(TRIP);
    const before = [collab(C1), collab(C2)];
    client.setQueryData<TripCollaborator[]>(key, before);
    const { result } = renderHook(() => useUpdateCollaborator(), { wrapper });

    const err = await run(() =>
      result.current.mutateAsync({ collaboratorId: C1, tripId: TRIP, role: 'editor' }),
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: 'not_owner', status: 403 });
    expect(client.getQueryData(key)).toEqual(before);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('skips the optimistic write when the list is not cached', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, collaboratorId: C1, role: 'viewer' }, error: null });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useUpdateCollaborator(), { wrapper });
    await run(() => result.current.mutateAsync({ collaboratorId: C1, tripId: TRIP, role: 'viewer' }));
    expect(client.getQueryData(tripCollaboratorsKeys.forTrip(TRIP))).toBeUndefined();
  });
});
