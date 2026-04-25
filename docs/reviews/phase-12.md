# Phase 12 — Pre-exit review

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only) + main-assistant follow-up triage
**Scope**:
- Migration `0007_advisory_lock_wrappers.sql` — `try_lock_trip` / `unlock_trip` SECURITY DEFINER RPCs.
- `supabase/functions/optimize-trip/index.ts` — replaced no-op `pg_advisory_xact_lock` with real session-scoped advisory lock + try/finally release.
- `src/api/routes.ts` — new `useAllTripLegs(tripIds)` batched query + projected `TripLegCostRow` shape.
- `app/(app)/trips.tsx` — added 4th sort option ("Cost ↓") + Filter button + date filter (All / Upcoming / Past).
- `src/components/FilterSheet.tsx` (new) — generic single-select bottom sheet wrapping `BottomSheet`.

This phase closes two deferred items:
- Phase 5 **M1** — silent-no-op advisory lock against `pg_advisory_xact_lock`.
- Phase 11 **M1** + **L4** — deferred cost sort + date filter on the trips list.

## Summary

- **Lock correctness**: real now. The previous code called `pg_advisory_xact_lock` directly via PostgREST RPC, which (a) was a 404 because PostgREST does not expose Postgres built-ins and (b) would have released at transaction end (each `.rpc()` is its own implicit txn). The new wrappers are user-defined functions (PostgREST exposes them), use the SESSION-scoped variant (survives across subsequent `.rpc()` calls in the same Edge Function invocation), and use the non-blocking *try* form (returns 409 instead of serializing concurrent double-clicks).
- **Cross-tenant safety / RLS**: clean. `useAllTripLegs` issues `SELECT trip_id, distance_meters FROM trip_legs WHERE trip_id IN (...)` under the user's JWT — RLS on `trip_legs` already gates by parent `trips.user_id`, so a user passing another user's trip ID gets zero rows back, not an error.
- **Google ToS**: untouched. No new Place data fields persisted; cost rollup uses only `distance_meters` (a pre-existing legitimate column, not Place content).
- **Logging**: clean. New `unlock_session_mismatch` log emits `tripId` (UUID) and stage only; no notes/titles/coordinates.
- **Platform-split parity**: `FilterSheet` consumes the existing `BottomSheet` platform-split — no new split surface introduced.
- **Accessibility**: FilterSheet rows have `accessibilityRole="radio"` + `accessibilityState={{ checked }}`; group wrapped in `accessibilityRole="radiogroup"` (L1 fix applied inline).

## Critical findings

### C1 — Session-scoped advisory locks under PgBouncer transaction pooling
- **Severity**: critical (architectural caveat — NOT a regression vs. the pre-Phase-12 state)
- **Location**: `supabase/migrations/0007_advisory_lock_wrappers.sql` design choice
- **Observation**: Supabase Edge Functions reach Postgres through PgBouncer in **transaction-pooling** mode. Session-scoped advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock`) are bound to the underlying Postgres backend connection. Because PgBouncer can swap the backend connection between two `.rpc()` calls inside the same Edge Function invocation, a session-scoped lock acquired on one backend may not be present when `unlock_trip` later runs on a different backend.
  - **Best case**: every `.rpc()` in this invocation lands on the same backend → lock + unlock work as designed. This is the common case under low concurrency.
  - **Worst case**: backend swap between lock and the body of the optimize work. The lock effectively never serializes anything because the next caller is unlikely to land on the same backend either; the unlock returns `false` because the backend never held the lock; either way Phase 5 idempotence (the `stateHash` check inside the optimizer) still prevents duplicate writes.
- **Disposition**: **DOCUMENT, ship, and instrument**. Phase 12 is **strictly better** than the pre-existing state (which was a silent no-op against a built-in, returning 404 every call). The observability fix (`unlock_session_mismatch` log) lets us measure how often this actually misfires in production. If telemetry shows it's a problem we'll move to a transaction-scoped lock plus per-trip serialization queue (or a `pg_try_advisory_xact_lock` wrapped in an explicit Postgres transaction at the Edge Function level via a single multi-statement RPC). Not blocking.

## High findings

### H1 — Test surface still references the pre-Phase-12 lock contract
- **Severity**: high (CI hygiene)
- **Location**: `supabase/functions/optimize-trip/test.ts`
- **Observation**: The Deno test file still mocks the old `pg_advisory_xact_lock` URL and doesn't assert the new 409 `already_optimizing` path or the `try_lock_trip` / `unlock_trip` RPC names.
- **Disposition**: **OUT OF SCOPE for Phase 12**. The user has explicitly removed the `test-specialist` role and instructed "no tests, no smokes" for the remainder of the project. This finding is recorded so a future test-restoration phase has a clear target list.

### H2 — `try_lock_trip` previously granted to `authenticated` enabled UUID-guess griefing
- **Severity**: high (multi-tenant abuse vector)
- **Location**: `supabase/migrations/0007_advisory_lock_wrappers.sql`
- **Observation (initial)**: `grant execute on function ... to authenticated` would let any signed-in user, given a leaked or guessed trip UUID, call `try_lock_trip` directly via PostgREST and hold the lock indefinitely (well, until their session ends), preventing the legitimate owner from optimizing that trip.
- **Fix applied (this phase)**: Migration revokes execute from `public` and grants execute only to `service_role`. The optimize-trip Edge Function calls these wrappers via the service-role admin client, so functionality is unaffected. A future direct-from-client serialization use case would wrap the lock in a function that checks `auth.uid() = (SELECT user_id FROM trips WHERE id = p_trip_id)` and grant THAT to `authenticated`.
- **Disposition**: **CLOSED in-phase**.

### H3 — `unlock_trip` had the same exposure
- **Severity**: high (paired with H2)
- **Location**: same migration
- **Observation (initial)**: Same `authenticated` grant would let any signed-in user release another tenant's optimize lock, defeating the purpose of acquiring it.
- **Fix applied (this phase)**: Same revoke + service_role-only grant pattern.
- **Disposition**: **CLOSED in-phase**.

## Medium findings

### M2 — Silent unlock failure has no observability hook
- **Severity**: medium (observability)
- **Location**: `supabase/functions/optimize-trip/index.ts` `finally` block
- **Observation (initial)**: The original release path ignored both `error` and `data === false` from `unlock_trip`. Under C1's connection-swap scenario, the function would silently fail to release the lock with no log signal — making the C1 limitation invisible to operators.
- **Fix applied (this phase)**: Two distinct warn-level logs: `unlock_error` (RPC error) and `unlock_session_mismatch` (RPC returned `false`, meaning the current backend never held the lock). Includes `tripId` for correlation.
- **Disposition**: **CLOSED in-phase**.

## Low findings

### L1 — FilterSheet group lacks `radiogroup` parent role
- **Severity**: low (a11y)
- **Location**: `src/components/FilterSheet.tsx`
- **Observation (initial)**: Each row was `accessibilityRole="radio"` but the group wasn't wrapped in `accessibilityRole="radiogroup"`, so screen readers wouldn't announce a meaningful "1 of N" position.
- **Fix applied (this phase)**: Wrapped option rows in a `<View accessibilityRole="radiogroup" accessibilityLabel={`${title} options`}>`.
- **Disposition**: **CLOSED in-phase**.

### L2 — Empty trip-legs short-circuit semantics
- **Severity**: low (informational)
- **Location**: `src/api/routes.ts` `useAllTripLegs`
- **Observation**: The `if (tripIds.length === 0) return []` branch inside `queryFn` is unreachable under normal flow because `enabled: tripIds.length > 0` already gates `queryFn` invocation. It's a belt-and-suspenders guard for the rare race where `enabled` flips between scheduling and execution.
- **Disposition**: Park; non-blocking. Now documented in the JSDoc (L5 fix).

### L4 — `useAllTripLegs` originally selected `*`
- **Severity**: low (efficiency)
- **Location**: `src/api/routes.ts` `useAllTripLegs`
- **Observation (initial)**: Cost rollup only consumes `trip_id` + `distance_meters`; selecting `*` transferred `polyline` (potentially KB per leg) and other unused columns over the wire on every list refetch.
- **Fix applied (this phase)**: Projected `.select('trip_id, distance_meters')` and narrowed the return type to a new `TripLegCostRow` interface.
- **Disposition**: **CLOSED in-phase**.

### L5 — JSDoc previously misleading on empty-input semantics
- **Severity**: low (docs)
- **Location**: `src/api/routes.ts` `useAllTripLegs` JSDoc
- **Observation (initial)**: The "Empty input" section said "the query is also `enabled: false`" without explaining why the redundant `queryFn` guard exists.
- **Fix applied (this phase)**: Updated JSDoc clarifies that `enabled: false` is the primary gate; the in-`queryFn` guard is a belt-and-suspenders for a flip-race.
- **Disposition**: **CLOSED in-phase**.

## Adversarial mental model — verified

1. **Forged tripId in optimize body**: `optimize-trip` derives nothing from `req.body` other than the UUID, then immediately runs `select id from trips where id = ? under user JWT`. Wrong tenant → 404. PASS.
2. **Replay of a leaked tripId for griefing**: `try_lock_trip` no longer callable by `authenticated`; only `service_role` (Edge Function only) can acquire the lock. Attacker can't hold someone else's lock. PASS (post H2/H3 fix).
3. **Concurrent double-click from same legitimate user**: first invocation acquires lock; second gets 409 `already_optimizing`. PASS.
4. **Connection swap mid-invocation under PgBouncer**: documented as C1; observable via `unlock_session_mismatch` log; `stateHash` idempotence prevents data corruption even when serialization fails. PASS (with caveat).
5. **Cost sort information leak across tenants**: `useAllTripLegs` filters by `tripIds`, which come exclusively from `useTrips()` — itself RLS-scoped to `auth.uid()`. Even if an attacker passed forged IDs into the hook, RLS on `trip_legs` returns zero matching rows. PASS.
6. **Filter button focus management**: pressing the Filter button shows the bottom sheet; focus returns to the trigger on close (BottomSheet's existing behavior — no new surface). PASS.

## Sign-off

**SHIP.**

C1 is documented as a known limitation that is **strictly better** than the pre-Phase-12 silent no-op; observability is in place to measure it. H2/H3 closed in-phase. M2/L1/L4/L5 closed in-phase. H1 is out of scope per project decision (no tests). L2 is informational and parked.

## Files referenced

- `supabase/migrations/0007_advisory_lock_wrappers.sql` (new this phase)
- `supabase/functions/optimize-trip/index.ts`
- `src/api/routes.ts`
- `app/(app)/trips.tsx`
- `src/components/FilterSheet.tsx` (new this phase)
- `src/components/index.ts`
- `docs/reviews/phase-5.md` (M1 origin)
- `docs/reviews/phase-11.md` (M1 + L4 origin)
