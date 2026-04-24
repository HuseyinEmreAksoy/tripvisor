# manual-edit

**Status**: 🚧 Code complete · pending live smoke
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: day-split, optimization

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a trip planner, I want to drag places to reorder them within a day and long-press to move a place to a different day or change its visit duration — so the optimizer's output is a starting point I can tweak.

## UI
- `src/components/DraggableItinerary/*` — platform-split drag list (`react-native-draggable-flatlist` native, `@dnd-kit/sortable` web)
- `src/components/PlaceActionsSheet.tsx` — long-press → bottom sheet with duration stepper + "Move to day" picker + delete
- `src/components/BottomSheet.{native,web}.tsx` — Modal on native, overlay+focus-trap on web

## Data
- `trip_places.day_index`, `trip_places.order_in_day`, `trip_places.visit_duration_minutes`
- Written via: `useReorderDay` (calls `apply_manual_day_order` RPC), `useMoveToDay`, `useUpdateTripPlace`

## APIs
- **No Google calls fired by manual edits.** The next auto-optimize reuses `trip_legs` cache; polylines are re-fetched only when day membership actually changes.
- Postgres RPCs: `apply_optimization(trip_id, assignments jsonb)` and `apply_manual_day_order(trip_id, day_index, ordered_ids uuid[])` — both `SECURITY INVOKER`, so RLS still gates ownership.

## Edge cases
- Unscheduled bucket (`day_index = null`) is not reorderable — drag is a no-op there
- Duration edit triggers auto-optimize 500ms later (the day split may change)
- `useMoveToDay` computes "append position" with a SELECT + UPDATE (small race, smoothed by next optimize — see Phase 3 review Problem 1)
- "Move to day" sheet always offers "new day" as an option — can over-fragment trips if user taps eagerly

## Test plan
- Unit: `src/components/__tests__/VisitDurationStepper.test.tsx` ✅
- Integration: `tests/rpc.test.ts` — RLS-enforced ownership on both RPCs ✅
- E2E: deferred to Phase 4
