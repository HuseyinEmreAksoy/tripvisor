# optimization

**Status**: 🚧 In progress (code + tests complete; awaiting live Routes API smoke). Advisory lock upgraded in Phase 12; replaced with row-mutex in Phase 13.
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
- Concurrency guard (Phase 13): `claim_trip_optimize(p_trip_id uuid, p_ttl_seconds int default 300) returns boolean` / `release_trip_optimize(p_trip_id uuid) returns void` SECURITY DEFINER RPCs in `supabase/migrations/0008_trip_optimize_mutex.sql`. Row-mutex on `trips.optimizing_at timestamptz null`; each is a single atomic UPDATE, immune to PgBouncer connection swaps. Granted to `service_role` only. Replaces the Phase 12 `try_lock_trip` / `unlock_trip` advisory-lock pair (dropped in migration `0008`).

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

### Resolved limitations

#### ~~C1 — PgBouncer connection-swap weakens session-scoped lock~~ — Closed in Phase 13

The Phase 12 advisory-lock pair (`try_lock_trip` / `unlock_trip`) used `pg_try_advisory_lock` / `pg_advisory_unlock`, which are session-scoped. Under PgBouncer transaction pooling the two RPC calls could land on different backend connections, causing the lock to leak.

Closed in Phase 13 by replacing the advisory-lock pair with a row-mutex on `trips.optimizing_at`. Each of `claim_trip_optimize` and `release_trip_optimize` is a single atomic `UPDATE` statement; PgBouncer cannot route different parts of one statement to different backends, so the connection-swap failure mode is structurally eliminated. The `unlock_session_mismatch` log stage was removed (the failure mode no longer exists). Migration `0008_trip_optimize_mutex.sql` drops the old RPCs and adds the new ones.
