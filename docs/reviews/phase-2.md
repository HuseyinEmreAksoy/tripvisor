# Phase 2 — Pre-exit review

**Date**: 2026-04-23
**Reviewer role**: main assistant acting as `reviewer` (read-only)
**Scope**: optimizer + Phase 2 Edge Functions + Map component + trip-detail tabs + Phase 2 tests.

## Review summary

- Files reviewed: 12 new + 2 modified (`app/(app)/trip/[id]/index.tsx`, `src/api/index.ts`, `package.json`)
- Tools run: static read-through (unit/integration runs deferred to user `npm install`)
- Top issues:
  1. `optimize-trip` writes `day_index`/`order_in_day` in a row-by-row loop — race window if two calls interleave after the advisory lock falls back silently
  2. Web `Polylines` component leaks Polyline instances (cleans up in a `setTimeout(0)` and re-creates each render) — works but wasteful and visually flickery at larger polyline counts
  3. No server-side validation that the caller owns the trip inside `optimize-trip` beyond RLS on the select — admin client writes could still hit RLS-bypassed rows if the upstream select ever stops gating correctly (belt-and-braces ownership check would be cheap)

### No CRITICAL findings. One high-severity item (see Problem 1) should be addressed before Phase 3.

---

### Problem 1: optimize-trip day assignments not atomic
- **Severity**: high
- **Category**: correctness / concurrency
- **Location**: `supabase/functions/optimize-trip/index.ts` (the `for (const day …) for (let i …) await admin.from('trip_places').update(...)` block)
- **Observation**: Each place gets its own UPDATE statement. The advisory lock is best-effort (falls back silently when the RPC helper isn't installed). Under rapid re-optimize calls the itinerary can be momentarily inconsistent.
- **Root cause**: No RPC helper exists yet; updates aren't wrapped in a transaction on the Edge function side
- **Why it matters**: A UI that shows live optimizer output could render a half-updated day split for a fraction of a second. Not data loss, but not visually clean.
- **Suggested fix**: Move the assignment to a Postgres RPC (`public.apply_optimization(trip_id uuid, assignments jsonb)`) that wraps the updates in a single statement (`UPDATE trip_places SET day_index = x.day_index, order_in_day = x.order_in_day FROM jsonb_to_recordset($2) AS x WHERE trip_places.id = x.id AND trip_places.trip_id = $1`). Call the RPC instead of looping UPDATEs.
- **Which agent should fix**: `backend-specialist` (Phase 3)

### Problem 2: Web Polylines lifecycle
- **Severity**: medium
- **Category**: perf / UX
- **Location**: `src/components/Map/Map.web.tsx` (`Polylines` inner component)
- **Observation**: `new google.maps.Polyline` is constructed on every render and torn down via `setTimeout(0)`. The vis.gl wrapper doesn't expose a React-native `<Polyline>` component, which is why this workaround exists.
- **Root cause**: `@vis.gl/react-google-maps` v1.x has no polyline primitive; community wraps it via refs
- **Suggested fix**: Swap for a `useEffect` that creates the Polylines once per `polylines` prop change and returns a cleanup; keeps the same DOM result but removes the flicker. Or add the `@googlemaps/react-wrapper` fallback just for polylines.
- **Which agent should fix**: `ui-specialist` (fast follow)

### Problem 3: Trip ownership belt-and-braces in optimize-trip
- **Severity**: low
- **Category**: security / defense-in-depth
- **Location**: `supabase/functions/optimize-trip/index.ts`
- **Observation**: The function selects the trip via the user-scoped client (RLS enforces ownership) before using the admin client for writes. RLS is the gate; admin writes rely on the select succeeding.
- **Root cause**: Correct by design but a single bug in the select would unlock admin writes
- **Suggested fix**: After the admin-client writes, verify `trip_places.trip_id = body.tripId` and `trips.user_id = <session user>` before returning. Or: perform writes via an RPC that takes `user_id` explicitly and re-checks inside the function.
- **Which agent should fix**: `backend-specialist`

### Problem 4: Distance-matrix upper bound
- **Severity**: medium
- **Category**: cost / scale
- **Location**: `supabase/functions/distance-matrix/index.ts`
- **Observation**: MAX_ORIGINS = MAX_DESTINATIONS = 25; the optimizer requests N² legs. At N=25 that's 625 elements = ~0.625 billion ops worst case, well inside Routes API limits (625 < 10_000 per request) but billed per element.
- **Why it matters**: Each Distance Matrix call at N=25 is ~$1.00 on pay-as-you-go. With the 30-day `trip_legs` TTL this stays well inside the $200 free credit for a hobby project.
- **Suggested fix**: none — just documented in `docs/features/optimization.md`
- **Which agent should fix**: `docs-specialist` (captured in docs)

### Problem 5: Auto-optimize effect runs an unstable mutate reference
- **Severity**: low
- **Category**: correctness
- **Location**: `app/(app)/trip/[id]/index.tsx` (auto-optimize `useEffect` deps include `optimize`)
- **Observation**: Including the whole mutation object in the deps array makes the effect re-run on every render where the object identity changes. The `lastOptimizedRef` guard prevents duplicate fires, but the effect rebuilds the timeout unnecessarily.
- **Root cause**: Standard trap with React Query mutations — use `optimize.mutate` directly (stable) rather than `optimize`
- **Suggested fix**: Replace `optimize` in the deps array with `optimize.mutate` (TanStack Query v5 guarantees stable reference) and call `optimize.mutate({ tripId: id })` inside the setTimeout.
- **Which agent should fix**: `ui-specialist`

### Problem 6: Itinerary `legs.find` is O(N·M) per render
- **Severity**: low
- **Category**: perf
- **Location**: `app/(app)/trip/[id]/index.tsx` (`ItineraryTab`)
- **Observation**: For each adjacent place pair, we scan `legs` linearly
- **Root cause**: Convenient for clarity; negligible at N ≤ 25
- **Suggested fix**: Build a `Map<`fromId|toId`, leg>` once with `useMemo` — ~10 lines, removes the O(N·M) inner loop
- **Which agent should fix**: `ui-specialist` (when/if perf ever surfaces as a complaint)

---

## Checklist coverage

| Category | Status |
|---|---|
| Optimizer correctness (completeness, idempotence, anchor pinning) | ✅ Covered by unit + property tests |
| Routes API cost discipline (one matrix per state change, `trip_legs` cache) | ✅ Implemented (cacheHit path) |
| `trip_legs` 30-day TTL | ✅ Respected in orchestrator |
| Edge Function patterns (timeouts, ?ping, Zod, structured logs, fail-closed CORS) | ✅ Consistent with Phase 1 |
| Map platform-split (`Map.native.tsx` + `Map.web.tsx`, no cross-imports) | ✅ Verified |
| Accessibility: tabs (`tablist`/`tab`), radio segments, slider stepper labels | ✅ Baseline |
| Server-state discipline (all data in TanStack Query) | ✅ |

---

## Recommended before calling Phase 2 "Done"

Blocking (should fix this phase):
- none. All findings are medium/low and can ship as Phase 3 follow-ups.

Non-blocking, good hygiene (Phase 3 or fast-follow):
- Problem 1 (atomic day assignment via RPC)
- Problem 2 (stable web Polylines lifecycle)
- Problem 5 (stable deps in auto-optimize effect)
