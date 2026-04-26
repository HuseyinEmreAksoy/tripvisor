# optimization

**Status**: 🚧 In progress (code + tests complete; awaiting live Routes API smoke). Advisory lock upgraded in Phase 12; replaced with row-mutex in Phase 13. Phase 23: manual mode + transit fallback + bicycling + `route_render_mode` toggle; smoke deferred per user direction.
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, place-search

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ✅ Web — Phase 20 smoke green 2026-04-25 (`phase-2-optimize.spec.ts` passes; `EdgeFunctionError` refactor is shared client code, no platform-specific surface)

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
- Edge Function: `optimize-trip { tripId, mode?: 'optimized' | 'manual' }` → returns stateHash + days + counts. Returns HTTP 409 `already_optimizing` when a concurrent optimize for the same trip holds the lock. Returns HTTP 400 `manual_mode_no_assignments` when mode is `'manual'` but no places have a `day_index` assigned.
- Internally calls: `distance-matrix`, `directions-polyline` (both for optimized and manual modes). `directions-polyline` returns `polyline: null` for transit legs.
- Client hooks:
  - `useOptimizeTrip({ tripId, mode? })` (TanStack Query mutation); auto-fired debounced 500ms after add/remove/settings changes; `mode` defaults to `'optimized'`.
  - `useUpdateRouteRenderMode(tripId)` — updates `trips.route_render_mode` and synchronously triggers `useOptimizeTrip` with the new mode. Omits the owner-only `user_id` filter so editors can toggle.
- Concurrency guard (Phase 13): `claim_trip_optimize(p_trip_id uuid, p_ttl_seconds int default 300) returns boolean` / `release_trip_optimize(p_trip_id uuid) returns void` SECURITY DEFINER RPCs in `supabase/migrations/0008_trip_optimize_mutex.sql`. Row-mutex on `trips.optimizing_at timestamptz null`; each is a single atomic UPDATE, immune to PgBouncer connection swaps. Granted to `service_role` only. Replaces the Phase 12 `try_lock_trip` / `unlock_trip` advisory-lock pair (dropped in migration `0008`).

## Route render modes (Phase 23)

### Optimized mode (`route_render_mode: 'optimized'`)

Default mode. The Edge Function runs k-means clustering + 2-opt to reorder `trip_places` into an efficient multi-day sequence. `apply_optimization` RPC writes `day_index` + `order_in_day` back onto `trip_places`. One `directions-polyline` call per day computes the encoded polyline and stores it in `trip_legs`.

### Manual mode (`route_render_mode: 'manual'`)

The optimizer skips clustering and 2-opt. Reads the user's existing `(day_index, order_in_day)` as authoritative — does NOT call `apply_optimization`. Groups places by `day_index` and runs per-day `directions-polyline` calls to refresh leg durations (so `DaySummaryCard` travel totals stay accurate). `stateHash` in manual mode includes the full `(id, day_index, order_in_day, visit_duration_minutes)` signature so manual reorders trigger a leg refresh.

### UI toggle

`RouteRenderModeControl` segmented control above the day chips in `MapTab` of `app/(app)/trip/[id]/index.tsx`. Segments: "Best route" (optimized) / "My order" (manual). Viewer role is read-only via `useTripRole`. Bound to `useUpdateRouteRenderMode`.

## Transport mode support (Phase 23)

| Mode | Distance matrix | Directions polyline | Map rendering |
|---|---|---|---|
| `driving` | DRIVE enum | DRIVE enum | Solid polyline |
| `walking` | WALK enum | WALK enum | Solid polyline |
| `transit` | TRANSIT enum | TRANSIT enum — returns `polyline: null` | Dashed straight-line + "Plan transit" deep link |
| `bicycling` | BICYCLE enum | BICYCLE enum | Solid polyline |

For transit legs: `directions-polyline` still calls the Routes API and stores `duration_seconds` + `distance_meters` (realistic transit estimates), but sets `polyline: null` in the stored `trip_legs` row. The client synthesizes dashed straight-line polylines from the ordered `trip_places` coordinates. A "Plan transit on Google Maps" deep link is added to each leg connector in the itinerary.

The `SettingsTab` transport mode picker now includes `bicycling` as a fourth option.

## Cost discipline
- `trip_legs` rows < 30 days old are reused — only missing pairs hit Distance Matrix
- One Distance Matrix call per state change, not one per leg
- Polyline only fetched for days with ≥ 2 places
- Trip capped at 25 places for MVP (Routes API element billing scales quadratically)

## Error surfacing (Phase 16 + Phase 20)

The Edge Function has returned structured envelopes (`{ error: { code, message } }`) since Phase 2. Phase 16 wires up client-side parsing so the UI can show accurate status instead of a generic red pill.

**`EdgeFunctionError`** — `src/api/_errors.ts` (Phase 20). Shared base class: `class EdgeFunctionError extends Error { constructor(public code: string, public message: string, public status: number) }`. Extracted in Phase 20 to eliminate circular imports between `routes.ts` and `places.ts`. Query keys for all tables also moved to the new `src/api/_keys.ts` leaf module.

**`OptimizeError`** — `src/api/routes.ts`. Extends `EdgeFunctionError` (changed from raw `Error` in Phase 20). Re-exported via `src/api/index.ts`. The JSDoc in that file is the canonical list of all 8 known codes (mirroring `supabase/functions/optimize-trip/index.ts`).

**`pillForOptimizeError(err)`** — `app/(app)/trip/[id]/index.tsx`. Maps known codes to `(tone, label)` pairs for `<StatusPill>`:
- `already_optimizing` → info / "Optimizing in progress…" (the common 409 double-click race; not a failure)
- `too_many_places` → danger / "Trip is too large"
- `matrix_failed` → danger / "Routing service unavailable"
- `not_found` → danger / "Trip not found"
- `rpc_failed` / `db_error` / `invalid_input` / `method_not_allowed` → danger / "Optimize failed"
- Unknown code or non-`OptimizeError` → danger / "Optimize failed"

If a new code is added to the Edge Function, update (1) the `OptimizeError` JSDoc in `src/api/routes.ts` and (2) the mapping in `pillForOptimizeError`.

## Edge cases
- Trip with 0–1 places: optimizer returns no days; no Google calls issued
- All legs cached: zero external calls
- `directions-polyline` failure for a day: that day rendered as straight-line segments with a "degraded" flag (not yet surfaced in UI — Phase 3)
- Concurrent optimize calls (double-click): Edge Function returns 409 `already_optimizing`; client shows info pill "Optimizing in progress…" rather than a red error (Phase 16)

## Test plan
- Unit (Jest + fast-check): `src/lib/optimizer/__tests__/optimizer.unit.test.ts` + `.property.test.ts` — completeness, idempotence, anchor pinning, deterministic state hash, multi-day split
- Integration (Deno): `supabase/functions/distance-matrix/test.ts` + `directions-polyline/test.ts` — field masks, Routes API shape, timeout, error paths
- E2E (Playwright): deferred to Phase 4

## Known limitations

### Resolved limitations

#### ~~C1 — PgBouncer connection-swap weakens session-scoped lock~~ — Closed in Phase 13

The Phase 12 advisory-lock pair (`try_lock_trip` / `unlock_trip`) used `pg_try_advisory_lock` / `pg_advisory_unlock`, which are session-scoped. Under PgBouncer transaction pooling the two RPC calls could land on different backend connections, causing the lock to leak.

Closed in Phase 13 by replacing the advisory-lock pair with a row-mutex on `trips.optimizing_at`. Each of `claim_trip_optimize` and `release_trip_optimize` is a single atomic `UPDATE` statement; PgBouncer cannot route different parts of one statement to different backends, so the connection-swap failure mode is structurally eliminated. The `unlock_session_mismatch` log stage was removed (the failure mode no longer exists). Migration `0008_trip_optimize_mutex.sql` drops the old RPCs and adds the new ones.
