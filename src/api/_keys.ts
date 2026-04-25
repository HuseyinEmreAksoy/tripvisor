/**
 * Shared TanStack Query key factories.
 *
 * Why this file exists
 * --------------------
 * Several `src/api/*.ts` modules need to invalidate each other's query keys
 * after a mutation (e.g. `useReorderDay` in `trip-places.ts` invalidates
 * `tripLegsKeys.forTrip(tripId)`; `useOptimizeTrip` in `routes.ts`
 * invalidates `tripPlacesKeys.forTrip(tripId)`). When each module owned its
 * own key factory and imported its peer, Metro produced a circular-require
 * warning:
 *
 *   Require cycle: src/api/trip-places.ts -> src/api/routes.ts
 *     -> src/api/trip-places.ts
 *
 * The fix is mechanical: hoist the cross-referenced key factories into one
 * leaf module that nobody else inside `src/api/*.ts` imports back from. The
 * source-of-truth lives here; the per-module files re-export the symbols
 * for backwards compatibility so existing call sites
 * (`import { tripPlacesKeys } from './trip-places'`) keep working.
 *
 * Naming convention
 * -----------------
 * Each factory has:
 *   - `all`       — the prefix for blanket invalidations
 *   - `forTrip`   — the per-trip list / detail key
 *   - additional shape-specific helpers (e.g. `byTripIds` for the cost
 *     sort batch fetch on `tripLegsKeys`)
 */

import type { Uuid } from './types';

// ---------------------------------------------------------------------------
// trips
// ---------------------------------------------------------------------------
export const tripsKeys = {
  all: ['trips'] as const,
  list: (opts: { archived: boolean } = { archived: false }) =>
    [...tripsKeys.all, 'list', { archived: opts.archived }] as const,
  detail: (id: Uuid) => [...tripsKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// trip-places
// ---------------------------------------------------------------------------
export const tripPlacesKeys = {
  all: ['trip-places'] as const,
  forTrip: (tripId: Uuid) => [...tripPlacesKeys.all, tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-days
// ---------------------------------------------------------------------------
export const tripDaysKeys = {
  all: ['trip-days'] as const,
  forTrip: (tripId: Uuid) => [...tripDaysKeys.all, 'list', { tripId }] as const,
};

// ---------------------------------------------------------------------------
// trip-legs
// ---------------------------------------------------------------------------
export const tripLegsKeys = {
  all: ['trip-legs'] as const,
  forTrip: (tripId: Uuid) => [...tripLegsKeys.all, tripId] as const,
  /**
   * Cache key for the multi-trip batch fetch used by the trips list cost
   * sort (Phase 12). The id list is sorted at key-construction time so
   * `[a, b]` and `[b, a]` collapse to one cache entry.
   */
  byTripIds: (tripIds: readonly Uuid[]) =>
    [...tripLegsKeys.all, 'by-trips', [...tripIds].sort().join(',')] as const,
};

// ---------------------------------------------------------------------------
// trip-expenses (Phase 20 Step 6)
// ---------------------------------------------------------------------------
export const tripExpensesKeys = {
  all: ['trip-expenses'] as const,
  forTrip: (tripId: Uuid) => [...tripExpensesKeys.all, tripId] as const,
};
