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
  /** Prefix for every user's cached reaction on one place (invalidation). */
  forTripPlace: (tripPlaceId: Uuid) =>
    [...tripPlaceReactionsKeys.all, 'for-trip-place', tripPlaceId] as const,
  /**
   * One user's reaction on one place. User-scoped so an account switch on
   * the same device never serves the previous user's cached reaction.
   */
  forTripPlaceUser: (tripPlaceId: Uuid, userId: Uuid) =>
    [...tripPlaceReactionsKeys.forTripPlace(tripPlaceId), userId] as const,
  forTrip: (tripId: Uuid) =>
    [...tripPlaceReactionsKeys.all, 'for-trip', tripId] as const,
  /** Prefix for every user's cross-trip reaction list (invalidation). */
  mine: () => [...tripPlaceReactionsKeys.all, 'mine'] as const,
  /** The given user's cross-trip reaction list (user-scoped, see above). */
  mineFor: (userId: Uuid) => [...tripPlaceReactionsKeys.mine(), userId] as const,
};

// ---------------------------------------------------------------------------
// trip-place-comments (v2 Phase N2 — BUILD-LOG 2.6)
// ---------------------------------------------------------------------------
//
// `forTripPlace(tripPlaceId)` keys the per-place thread read (place card /
// detail sheet, ascending created_at). `forTrip(tripId)` keys the per-trip
// batch read that powers comment-count badges across the itinerary without
// an N-per-place query fan-out. Mutations in `trip-place-comments.ts`
// invalidate both.
export const tripPlaceCommentsKeys = {
  all: ['trip-place-comments'] as const,
  forTripPlace: (tripPlaceId: Uuid) =>
    [...tripPlaceCommentsKeys.all, 'for-trip-place', tripPlaceId] as const,
  forTrip: (tripId: Uuid) =>
    [...tripPlaceCommentsKeys.all, 'for-trip', tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-packing (v2 Phase P2 — BUILD-LOG P2.2)
// ---------------------------------------------------------------------------
//
// One key per trip: the whole checklist loads in a single query and every
// mutation (bulk seed, toggle, delete) invalidates `forTrip`.
export const tripPackingKeys = {
  all: ['trip-packing'] as const,
  forTrip: (tripId: Uuid) => [...tripPackingKeys.all, tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-documents (v2 Phase P2 — BUILD-LOG P2.3)
// ---------------------------------------------------------------------------
//
// Keys the per-trip METADATA list (`trip_documents` rows). Signed URLs are
// deliberately NOT cached under a query key — they expire in 60s, so
// `useTripDocumentUrl` is a mutation that mints a fresh one per view click.
export const tripDocumentsKeys = {
  all: ['trip-documents'] as const,
  forTrip: (tripId: Uuid) => [...tripDocumentsKeys.all, tripId] as const,
};

// ---------------------------------------------------------------------------
// trip-collaborators (Phase 21 Steps 21.5 / 21.6)
// ---------------------------------------------------------------------------
//
// `forTrip(tripId)` is the owner-side list of collaborators on a single
// trip (powers the "manage collaborators" UI). The `mine` key (which
// powered the deprecated `useCollaboratedTrips`) was deleted in v2 Phase
// 0.5b — "Shared with me" rides the `useTrips()` UNION under `tripsKeys`.
export const tripCollaboratorsKeys = {
  all: ['trip-collaborators'] as const,
  forTrip: (tripId: Uuid) => [...tripCollaboratorsKeys.all, 'for-trip', tripId] as const,
};
