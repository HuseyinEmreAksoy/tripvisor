# Smoke log — Phase 24

**Phase**: 24 — Analytics + place reactions + use-my-location routing
**Date**: 2026-04-26
**Status**: DEFERRED — automated tests (Step 24.15) and live smoke (Step 24.14) explicitly skipped per user direction on 2026-04-26. Same policy as Phases 21, 22, and 23. Reviewer pass (Step 24.13) also skipped per user direction.

## Deferred state

The user directed the team to skip automated tests (Step 24.15), the reviewer pass (Step 24.13), and live smoke (Step 24.14) for this phase. No browser golden-path walk was performed and no platform verification was recorded.

This file exists to make the deferred state visible. The per-feature docs (`docs/features/reactions.md`, `docs/features/analytics.md`, `docs/features/location-routing.md`) carry empty platform-verified boxes — none were ticked in Phase 24.

## Code-complete, unverified deliverables

The following items shipped at the code level in Phase 24 and are considered code-complete but unverified by smoke:

### Place reactions
- **`trip_place_reactions` table** (`supabase/migrations/0017_trip_place_reactions.sql`) — unique `(trip_place_id, user_id)`, `reaction` CHECK IN (`liked`, `disliked`), `ON DELETE CASCADE` on both FKs, `set_updated_at` trigger, four RLS policies (SELECT via `user_can_access_trip` join; INSERT/UPDATE/DELETE pinned to `user_id = auth.uid()`).
- **`src/api/trip-place-reactions.ts`** — `useTripPlaceReaction`, `useTripReactions`, `useAllUserReactions`, `useSetTripPlaceReaction` (upsert + DELETE on null, optimistic + rollback). Query keys in `src/api/_keys.ts` (`tripPlaceReactionsKeys`).
- **`src/components/ReactionChip.tsx`** — two sizes (`sm` for itinerary rows, `lg` for place detail); active state highlighted; tapping active toggles to null.
- **ItineraryTab `PlaceRow`** — small ReactionChip on the right of each row.
- **Place detail screen** (`app/(app)/place/[placeId].tsx`) — large ReactionChip when reached with `tripPlaceId` + `tripId` query params.
- **Settings tab catalog sections** — "You liked" and "You didn't like" lists; hidden when empty.

### Analytics / Insights
- **`app/(app)/analytics.tsx`** — four chart sections (spending per trip, spending by category, liked vs. disliked per trip, spending over time); two place catalogs (most liked / most disliked, top 5); desktop-aware layout via `useBreakpoint`.
- **Trips list entry point** (`app/(app)/trips.tsx`) — "Insights" button in header navigates to `/analytics`.
- **`src/components/charts/BarChart.tsx`**, **`PieChart.tsx`**, **`LineChart.tsx`** — hand-rolled SVG charts using `react-native-svg`. `victory-native@41` was rejected: requires `@shopify/react-native-skia >= 1.2.3` which requires React 19; project is on React 18.
- **`src/api/trip-expenses.ts`** — `useAllUserExpenses()` cross-trip aggregation hook added.

### Location-aware routing
- **`src/hooks/useCurrentLocation.ts`** — cross-platform lazy geolocation hook; web uses `navigator.geolocation`, native uses `expo-location` via lazy `require()`; status machine `idle | requesting | granted | denied | unavailable`; session-level coordinate cache; no persistence.
- **`src/hooks/useTripUseMyLocation.ts`** — AsyncStorage-backed boolean toggle per trip; key `tripvisor:useMyLocation:<tripId>`; default false.
- **MapTab "From my location" toggle** — wired to `useCurrentLocation` + `useTripUseMyLocation`; renders virtual polyline from GPS fix to active day's first place via `directions-polyline` Edge Function; never writes to `trip_legs`.
- **`app.json`** — Android `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` added; iOS `NSLocationWhenInUseUsageDescription` widened.

## Action required before feature status can advance to "Done"

1. Run automated tests: `npm test` covering reactions optimistic rollback, ReactionChip interactions, `useCurrentLocation` state machine, analytics aggregations.
2. Walk web golden paths in a real browser and record PASS / FAIL per the 10-step checklist in Step 24.14 of `plan.md`.
3. Tick platform-verified boxes in `docs/features/reactions.md`, `docs/features/analytics.md`, and `docs/features/location-routing.md` only after smoke passes on each platform.
4. Conduct reviewer pass (Step 24.13) covering RLS policies, location privacy, ToS compliance, and navigation affordances.
