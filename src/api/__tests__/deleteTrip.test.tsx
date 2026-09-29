/**
 * Security audit #13 — `useDeleteTrip` now calls the `delete-trip` Edge
 * Function (owner-only, cleans `trip-docs/<tripId>/…` before the cascade
 * delete) instead of a direct PostgREST delete.
 *
 * Pins the client contract:
 *   - hook signature unchanged: `mutate(tripId)` resolves to the tripId;
 *   - invokes `delete-trip` with `{ tripId }` and never touches PostgREST;
 *   - D5 prune (`pruneTripFromLocalStore`) + cache cleanup run on success;
 *   - a typed `not_found` is idempotent success (parity with the old 0-row
 *     PostgREST delete), so the local prune still runs;
 *   - other typed failures surface as `DeleteTripError` with `.code`, and
 *     nothing is pruned;
 *   - non-envelope failures (network) are rethrown untouched.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type InvokeResult = { data: unknown; error: unknown };
const mockInvoke = jest.fn<(name: string, opts: { body: unknown }) => Promise<InvokeResult>>();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (name: string, opts: { body: unknown }) => mockInvoke(name, opts) },
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));

const mockPrune = jest.fn();
jest.mock('@/sync/hydrate', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { observable } = require('@legendapp/state');
  return {
    tier1RootLoaded$: observable({ trips: false }),
    isTier1SyncInitialized: () => false,
    getTier1SyncUserId: () => null,
    resyncTier1: jest.fn(),
    pruneTripFromLocalStore: (id: string) => mockPrune(id),
  };
});
jest.mock('@/sync/flags', () => ({ isTier1SyncEnabled: () => false, loadTier1SyncFlag: async () => false }));

/* eslint-disable import/first */
import { DeleteTripError, tripsKeys, useDeleteTrip } from '../trips';
import { EdgeFunctionError } from '../_errors';
/* eslint-enable import/first */

const TRIP = '11111111-1111-4111-8111-111111111111';

/** What supabase-js hands back for a non-2xx: FunctionsHttpError with the Response as `context`. */
function httpError(status: number, body: unknown) {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: { status, json: async () => body },
  });
}

const clients: QueryClient[] = [];

function setup() {
  // gcTime: Infinity → TanStack schedules no 5-minute GC timers, which would
  // otherwise keep Jest alive long after the suite finishes.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(qc);
  qc.setQueryData(tripsKeys.detail(TRIP), { id: TRIP, title: 'Doomed' });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDeleteTrip(), { wrapper });
  return { qc, result };
}

/** Run a mutation inside act and let TanStack's batched (setTimeout 0) notify flush inside it too. */
async function settle<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T;
  await act(async () => {
    out = await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
  return out;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockFrom.mockReset();
  mockPrune.mockReset();
});

afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

describe('useDeleteTrip → delete-trip Edge Function (audit #13)', () => {
  it('invokes delete-trip with { tripId }, resolves the id, prunes Tier-1 + drops the detail cache', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, tripId: TRIP, deleted: true, storage: { objectsRemoved: 2 }, meta: { contractVersion: 1 } },
      error: null,
    });
    const { qc, result } = setup();

    const resolved = await settle(() => result.current.mutateAsync(TRIP));

    expect(resolved).toBe(TRIP);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('delete-trip', { body: { tripId: TRIP } });
    expect(mockFrom).not.toHaveBeenCalled(); // no direct PostgREST delete any more
    expect(mockPrune).toHaveBeenCalledWith(TRIP);
    expect(qc.getQueryData(tripsKeys.detail(TRIP))).toBeUndefined();
  });

  it('treats a typed not_found as idempotent success (already deleted) and still prunes', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(404, { error: { code: 'not_found', message: 'Trip not found or forbidden' } }),
    });
    const { result } = setup();

    await expect(settle(() => result.current.mutateAsync(TRIP))).resolves.toBe(TRIP);
    expect(mockPrune).toHaveBeenCalledWith(TRIP);
  });

  it('surfaces not_owner as DeleteTripError (403) and does NOT prune', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: { code: 'not_owner', message: 'Only the trip owner can delete this trip' } }),
    });
    const { qc, result } = setup();

    const caught = await settle(() => result.current.mutateAsync(TRIP).catch((e: unknown) => e));

    expect(caught).toBeInstanceOf(DeleteTripError);
    expect(caught).toBeInstanceOf(EdgeFunctionError);
    expect((caught as DeleteTripError).code).toBe('not_owner');
    expect((caught as DeleteTripError).status).toBe(403);
    expect((caught as DeleteTripError).name).toBe('DeleteTripError');
    expect(mockPrune).not.toHaveBeenCalled();
    expect(qc.getQueryData(tripsKeys.detail(TRIP))).toEqual({ id: TRIP, title: 'Doomed' });
  });

  it('surfaces storage_cleanup_failed (trip kept, retryable) as DeleteTripError', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(500, { error: { code: 'storage_cleanup_failed', message: "Couldn't remove this trip's documents." } }),
    });
    const { result } = setup();

    const caught = await settle(() => result.current.mutateAsync(TRIP).catch((e: unknown) => e));
    expect((caught as DeleteTripError).code).toBe('storage_cleanup_failed');
    expect(mockPrune).not.toHaveBeenCalled();
  });

  it('rethrows a non-envelope failure (network) untouched', async () => {
    const netErr = new Error('Failed to send a request to the Edge Function');
    mockInvoke.mockResolvedValue({ data: null, error: netErr });
    const { result } = setup();

    const caught = await settle(() => result.current.mutateAsync(TRIP).catch((e: unknown) => e));
    expect(caught).toBe(netErr);
    expect(mockPrune).not.toHaveBeenCalled();
  });
});
