# optimization

**Status**: 🚧 In progress (code + tests complete; awaiting live Routes API smoke)
**Owner agents**: backend-specialist
**Depends on**: trip-crud, place-search

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a traveler, I want the app to arrange my saved places into an efficient multi-day route so I don't waste time criss-crossing the city.

## Algorithm
See [ADR-0001](../adr/0001-kmeans-2opt-over-or-tools.md).

1. `k = ceil(totalVisitMinutes / dailyBudget)`
2. k-means clustering with farthest-point seeding, anchored to `trips.anchor_place_id` if set
3. Post-pass rebalance: move boundary places between clusters until each is within budget (8 passes max)
4. 2-opt per cluster with three random restarts, pinning `day_start_place_id` / `day_end_place_id` when provided
5. Persist `day_index` + `order_in_day` on `trip_places`; fetch polyline per day via `directions-polyline`, write into `trip_legs`

## Data
- Reads: `trips`, `trip_places`, `trip_legs` (cache-hit check)
- Writes: `trip_places.day_index`, `trip_places.order_in_day`, new rows in `trip_legs`

## APIs
- Edge Function: `optimize-trip { tripId }` → returns stateHash + days + counts
- Internally calls: `distance-matrix`, `directions-polyline`
- Client hook: `useOptimizeTrip()` (TanStack Query mutation); auto-fired debounced 500ms after add/remove/settings changes

## Cost discipline
- `trip_legs` rows < 30 days old are reused — only missing pairs hit Distance Matrix
- One Distance Matrix call per state change, not one per leg
- Polyline only fetched for days with ≥ 2 places
- Trip capped at 25 places for MVP (Routes API element billing scales quadratically)

## Edge cases
- Trip with 0–1 places: optimizer returns no days; no Google calls issued
- All legs cached: zero external calls
- `directions-polyline` failure for a day: that day rendered as straight-line segments with a "degraded" flag (not yet surfaced in UI — Phase 3)

## Test plan
- Unit (Jest + fast-check): `src/lib/optimizer/__tests__/optimizer.unit.test.ts` + `.property.test.ts` — completeness, idempotence, anchor pinning, deterministic state hash, multi-day split
- Integration (Deno): `supabase/functions/distance-matrix/test.ts` + `directions-polyline/test.ts` — field masks, Routes API shape, timeout, error paths
- E2E (Playwright): deferred to Phase 4
