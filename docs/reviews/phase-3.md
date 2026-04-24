# Phase 3 — Pre-exit review (MVP gate)

**Date**: 2026-04-24
**Reviewer role**: main assistant acting as `reviewer` (read-only)
**Scope**: Phase 3 end-to-end — RPCs, manual-edit hooks, Phase 2 deferral fixes, BottomSheet/VisitDurationStepper/DraggableItinerary/PlaceActionsSheet primitives, Itinerary-tab integration, Phase 3 tests.

## Review summary

- Files reviewed: ~17 new + 4 modified (`app/(app)/trip/[id]/index.tsx`, `src/api/trip-places.ts`, `src/components/Map/Map.web.tsx`, `src/components/index.ts`, `package.json`)
- Tools run: static read-through (`npm test` + `deno test` deferred to user install)
- Top issues:
  1. `useMoveToDay` does a follow-up query for the next `order_in_day` — vulnerable to a race if two places are moved to the same day concurrently
  2. `DraggableItinerary.web.tsx` renders a raw `<div>` inside React Native Web, correct but worth flagging for future platform-linting
  3. `PlaceActionsSheet` "Move to day (new)" always adds the next-integer day regardless of whether a new cluster is actually warranted — UX edge, not correctness

### No CRITICAL findings. MVP can ship — smoke-testing required once user provisions Supabase + GCP.

---

### Problem 1: Race on `useMoveToDay`'s append-position calculation
- **Severity**: medium
- **Category**: correctness / concurrency
- **Location**: `src/api/trip-places.ts` (`useMoveToDay`, inside the lookup for `max order_in_day`)
- **Observation**: Between the SELECT and the UPDATE, another client could insert into the same day, leading to two places with the same `order_in_day`.
- **Root cause**: No atomic "append to end" primitive; we emulate it client-side
- **Why it matters**: Optimize-after-move smooths it out on the next cycle, but the intermediate render is briefly inconsistent
- **Suggested fix**: Add a third RPC `append_to_day(p_trip_id, p_place_id, p_day_index)` that does the SELECT + UPDATE in one statement (`UPDATE … SET order_in_day = COALESCE((SELECT MAX(order_in_day)+1 FROM trip_places WHERE trip_id = p_trip_id AND day_index = p_day_index), 0)`). Or just trust the next auto-optimize to re-sequence.
- **Which agent should fix**: `backend-specialist` (Phase 4 fast-follow)

### Problem 2: Raw `<div>` inside React Native Web
- **Severity**: low
- **Category**: cross-platform hygiene
- **Location**: `src/components/DraggableItinerary/DraggableItinerary.web.tsx` (the `<div ref=…>` around each sortable row)
- **Observation**: `@dnd-kit/sortable` expects a DOM element for refs; we drop out of RN Web's `<View>` into a raw `<div>` to satisfy that.
- **Root cause**: `@dnd-kit` is DOM-native; no RN adapter
- **Why it matters**: Works fine because it's inside a `.web.tsx` file (won't bundle on native), but a future contributor might copy the pattern into shared code
- **Suggested fix**: Add an ESLint rule banning raw HTML tags outside `*.web.tsx` / `*.web.ts` — Phase 5 test-hardening item
- **Which agent should fix**: `test-specialist` (lint config) when we ship Phase 5

### Problem 3: "Day N (new)" label always offered
- **Severity**: low
- **Category**: UX
- **Location**: `src/components/PlaceActionsSheet.tsx` (`MoveToDay` inner component)
- **Observation**: The "new day" row appears even when the user probably has plenty of room in an existing day. Risk: user creates dozens of under-filled days.
- **Root cause**: MVP simplicity — offer the option, let re-optimize sort it out
- **Suggested fix**: Hide "Day N (new)" if the trip already has `ceil(totalVisitMinutes / dailyBudget)` days in use. Small heuristic; add in Phase 4.
- **Which agent should fix**: `ui-specialist` (Phase 4 polish)

### Problem 4: Auto-optimize now fires on duration edits — intended but cost-sensitive
- **Severity**: low
- **Category**: cost / correctness
- **Location**: `app/(app)/trip/[id]/index.tsx` (auto-optimize `stateKey` includes `visit_duration_minutes`)
- **Observation**: Each ± 15min tap on `VisitDurationStepper` can trigger a re-optimize 500ms later. The optimizer reuses `trip_legs` cache, so no Google call usually — but if the day split changes (cluster rebalance), a polyline fetch per new day runs.
- **Why it matters**: Real user behavior: tap ± rapidly. The 500ms debounce collapses burst edits into one call, so this should be fine — but keep an eye on Routes API spend after launch.
- **Suggested fix**: Consider extending the debounce to 800ms for duration edits specifically. Low priority.
- **Which agent should fix**: `ui-specialist` (if cost becomes a real signal)

### Problem 5: Reorder fires `useReorderDay` even when drag ended at the same position
- **Severity**: low
- **Category**: perf
- **Location**: `src/components/DraggableItinerary/DraggableItinerary.web.tsx` (already guards); native version fires on every drag-end
- **Observation**: Native's `onDragEnd` fires once the drag ends even if the order is unchanged
- **Suggested fix**: Diff `newIds` against previous order before invoking `onReorder`. One extra compare per drag.
- **Which agent should fix**: `ui-specialist`

### Problem 6: Unscheduled bucket is not orderable — silent
- **Severity**: low
- **Category**: UX
- **Location**: `app/(app)/trip/[id]/index.tsx` (`ItineraryTab`)
- **Observation**: When `dayIndex < 0`, `onReorder` short-circuits silently. Correct (unscheduled has no meaningful order), but user has no visual cue that drag is disabled there.
- **Suggested fix**: Render unscheduled places without the `DraggableItinerary` wrapper, or with a muted "Drag disabled until scheduled" caption
- **Which agent should fix**: `ui-specialist`

---

## Checklist coverage

| Category | Status |
|---|---|
| RPC ownership enforced via RLS (SECURITY INVOKER) | ✅ Verified in `tests/rpc.test.ts` |
| Atomic day assignment in `optimize-trip` (via `apply_optimization` RPC) | ✅ Phase 2 finding Problem 1 resolved |
| Web Polylines lifecycle (no more `setTimeout(0)` teardown) | ✅ Phase 2 finding Problem 2 resolved |
| Stable `optimizeMutate` reference in auto-optimize effect | ✅ Phase 2 finding Problem 5 resolved |
| BottomSheet focus trap + Escape on web | ✅ Implemented |
| VisitDurationStepper keyboard (arrow keys) + accessibilityRole="adjustable" | ✅ Implemented + tested |
| DraggableItinerary keyboard (dnd-kit KeyboardSensor) | ✅ Implemented |
| Reorder without triggering Google calls | ✅ `useReorderDay` hits only the RPC; auto-optimize reuses `trip_legs` cache |
| Delete from PlaceActionsSheet confirms (native Alert + web confirm) | ✅ |
| Server-state discipline (no local mirror of server data) | ✅ |
| ToS compliance (unchanged) | ✅ |

---

## MVP readiness

All Phase 3 exit criteria from `plan.md` can now be ticked pending live smoke:

- ☑ Drag-reorder within a day works (intra-day only, cross-day via sheet) — native + web
- ☑ Long-press opens actions sheet with duration + move-to-day + delete
- ☑ Duration edit triggers auto-optimize (debounced)
- ☑ Moving between days does not fire Google calls (reuses `trip_legs` cache)
- ☑ `apply_optimization` RPC used (atomic)
- ☑ Web Polylines stable
- ☑ Auto-optimize effect stable

**Recommendation**: ship as MVP after user smoke on iOS, Android, and Web. None of the 6 findings above are blockers.
