/**
 * _tier1Facade.ts — shared plumbing for the Tier-1 read/write facades
 * (trips, trip-places, trip-expenses, trip-packing).
 *
 * Hoisted in M4 X2.5 when the third and fourth facades appeared (the
 * trips.ts / trip-places.ts copies carried a "hoist when a third facade
 * appears" note). Semantics are unchanged from those copies.
 */

import type { RefetchOptions, UseQueryResult } from '@tanstack/react-query';
import { resyncTier1 } from '@/sync/hydrate';

/**
 * Dress Tier-1-served data in the `UseQueryResult` shape consumers already
 * destructure (`data`, `isLoading`, `error`, `refetch`, `isRefetching`, …).
 * The paused legacy query is spread first so fetch-state fields stay live;
 * the success-state fields are overridden because the store IS the data.
 *
 * `refetch` (pull-to-refresh) does both: forces an incremental Tier-1 pull
 * AND delegates to the legacy refetch — the latter still fetches even while
 * `enabled: false` (TanStack contract), which keeps the D2 fallback cache
 * warm and drives the caller's `isRefetching` spinner.
 */
export function tier1SuccessResult<T>(
  paused: UseQueryResult<T, Error>,
  data: T,
): UseQueryResult<T, Error> {
  return {
    ...paused,
    data,
    error: null,
    status: 'success',
    isPending: false,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    isError: false,
    isSuccess: true,
    isPlaceholderData: false,
    refetch: async (options?: RefetchOptions) => {
      resyncTier1();
      return paused.refetch(options);
    },
  } as UseQueryResult<T, Error>;
}

/**
 * Dress a Tier-1 store row for a mutation's RETURN value. Unacked local
 * creates omit `created_at`/`updated_at` (created_at absence is the sync
 * plugin's create/update discriminator — it must NEVER be set client-side);
 * the placeholders exist ONLY in this return value so it satisfies the row
 * contract for callers. Nothing here writes them back into the store.
 */
export function dressTier1Return<T extends { created_at: string; updated_at: string }>(row: T): T {
  const nowIso = new Date().toISOString();
  return {
    ...row,
    created_at: (row.created_at as string | undefined) ?? nowIso,
    updated_at: (row.updated_at as string | undefined) ?? nowIso,
  };
}

/**
 * Tie-break for "created_at asc" lists over the store: hydrated rows compare
 * by created_at; unacked local creates (no created_at) sort LAST — they are
 * the newest — and `null` is returned for two local creates so the caller
 * can apply its own secondary key.
 */
export function compareCreatedAtAscLocalLast(
  a: { created_at: string },
  b: { created_at: string },
): number | null {
  const aCreated = a.created_at as string | undefined;
  const bCreated = b.created_at as string | undefined;
  if (aCreated === undefined || bCreated === undefined) {
    if (aCreated !== undefined) return -1;
    if (bCreated !== undefined) return 1;
    return null;
  }
  return aCreated.localeCompare(bCreated);
}

/**
 * `networkMode` for every mutation whose `mutationFn` can take the Tier-1
 * (sync-store) branch.
 *
 * TanStack v5 mutations default to `networkMode: 'online'`: while
 * `onlineManager` reports offline (web: the window `offline` event), the
 * mutation runs `onMutate` and then PAUSES before `mutationFn` — so the
 * Tier-1 store write inside `mutationFn` would never happen until reconnect,
 * defeating the offline-first contract. `'always'` runs `mutationFn`
 * immediately regardless of connectivity: the Tier-1 branch writes the store
 * synchronously (the engine queues the server write), and the legacy
 * PostgREST branch simply fails fast offline (surfacing via `onError`, with
 * the usual optimistic rollback) instead of hanging in a paused state.
 *
 * Mutations that are online-only by construction (RPCs, hard deletes,
 * Edge Function calls) keep the default.
 */
export const TIER1_MUTATION_NETWORK_MODE = 'always' as const;
