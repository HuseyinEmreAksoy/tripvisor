# optimization

**Status**: 🚧 In progress (code + tests complete; awaiting live Routes API smoke). Advisory lock upgraded in Phase 12.
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
- Edge Function: `optimize-trip { tripId }` → returns stateHash + days + counts. Returns HTTP 409 `already_optimizing` when a concurrent optimize for the same trip holds the lock.
- Internally calls: `distance-matrix`, `directions-polyline`
- Client hook: `useOptimizeTrip()` (TanStack Query mutation); auto-fired debounced 500ms after add/remove/settings changes
- Concurrency guard (Phase 12): `try_lock_trip(uuid)` / `unlock_trip(uuid)` SECURITY DEFINER RPCs in `supabase/migrations/0007_advisory_lock_wrappers.sql`. Wrap `pg_try_advisory_lock` / `pg_advisory_unlock` keyed by `hashtextextended(trip_id::text, 0)`. Granted to `service_role` only.

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

## Known limitations

### C1 — PgBouncer connection-swap weakens session-scoped lock (Phase 12, parked-with-mitigation)

`try_lock_trip` / `unlock_trip` use `pg_try_advisory_lock` / `pg_advisory_unlock`, which are session-scoped. When Supabase is configured with PgBouncer in transaction-pooling mode the two RPC calls may land on different backend connections; the lock acquired by the first call is then invisible to the unlock call, so the lock leaks until the original session closes.

Mitigation in place: the `finally` block in `optimize-trip` emits a `unlock_session_mismatch` warn log when `pg_advisory_unlock` returns `false` (indicating it unlocked a lock it did not hold, or found nothing to unlock). Monitor this log in Supabase Edge Function logs to measure swap frequency.

This state is strictly better than the previous silent no-op. A future phase may consolidate lock + work + unlock into a single multi-statement RPC to eliminate the inter-call connection-swap window.
