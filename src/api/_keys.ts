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
 *   - additional shape-specific helpers (e.g. `byTripIds` for the
 *     duration-sort batch fetch on `tripLegsKeys`)
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
   * Cache key for the multi-trip batch fetch used by the trips list
   * duration sort (Phase 12, repointed in v2 Phase 0.1). The id list is
   * sorted at key-construction time so `[a, b]` and `[b, a]` collapse to
   * one cache entry.
   *
   * `by-trips-v2`: the projection changed from `distance_meters` (retired
   * per-km cost sort) to `duration_seconds` in v2 Phase 0.1. Bumping the
   * key segment guarantees the AsyncStorage-persisted cache (24h gcTime)
   * can never rehydrate old-shape rows into the new sort — old `by-trips`
   * entries simply age out.
   */
  byTripIds: (tripIds: readonly Uuid[]) =>
    [...tripLegsKeys.all, 'by-trips-v2', [...tripIds].sort().join(',')] as const,
};

// ---------------------------------------------------------------------------
// trip-expenses (Phase 20 Step 6)
// ---------------------------------------------------------------------------
export const tripExpensesKeys = {
  all: ['trip-expenses'] as const,
  forTrip: (tripId: Uuid) => [...tripExpensesKeys.all, tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-accommodations (Phase 21 Steps 21.8 / 21.9)
// ---------------------------------------------------------------------------
export const tripAccommodationsKeys = {
  all: ['trip-accommodations'] as const,
  forTrip: (tripId: Uuid) => [...tripAccommodationsKeys.all, tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-place-reactions (Phase 24 Step 24.2)
// ---------------------------------------------------------------------------
//
// `forTripPlace(tripPlaceId)` keys the per-place lookup used by the place-
// detail card to read the current user's reaction. `forTrip(tripId)` keys
// the cross-trip-place batch read used by the trip detail catalog
// sections (e.g. "places liked by your travel companions"). `mine()` keys
// the cross-trip catalog used by the analytics screen — every reaction
// the current user has placed across every trip.
export const tripPlaceReactionsKeys = {
  all: ['trip-place-reactions'] as const,
  forTripPlace: (tripPlaceId: Uuid) =>
    [...tripPlaceReactionsKeys.all, 'for-trip-place', tripPlaceId] as const,
  forTrip: (tripId: Uuid) =>
    [...tripPlaceReactionsKeys.all, 'for-trip', tripId] as const,
  mine: () => [...tripPlaceReactionsKeys.all, 'mine'] as const,
};

// ---------------------------------------------------------------------------
// trip-collaborators (Phase 21 Steps 21.5 / 21.6)
// ---------------------------------------------------------------------------
//
// `forTrip(tripId)` is the owner-side list of collaborators on a single
// trip (powers the "manage collaborators" UI). `mine` is the per-user
// list of trips where the caller has an accepted collaborator row
// (powers `useCollaboratedTrips` and the future "Shared with me" badge
// in the trips list, deferred to Step 21.7).
export const tripCollaboratorsKeys = {
  all: ['trip-collaborators'] as const,
  forTrip: (tripId: Uuid) => [...tripCollaboratorsKeys.all, 'for-trip', tripId] as const,
  mine: () => [...tripCollaboratorsKeys.all, 'mine'] as const,
};
