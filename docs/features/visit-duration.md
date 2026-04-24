# visit-duration

**Status**: 🚧 Code complete · pending live smoke
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: place-search (sets initial default), optimization (consumes the value)

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a planner, I want to override how long I'll spend at a place so the optimizer respects my real schedule, not just category defaults.

## UI
- `VisitDurationStepper` (± 15 min, min 15 min, max 12 h)
- `accessibilityRole="adjustable"` with `accessibilityValue` reflecting current minutes
- Keyboard: arrow keys on web; `accessibilityActions` for TalkBack/VoiceOver
- Lives inside `PlaceActionsSheet`, reached via long-press on a place row

## Data
- `trip_places.visit_duration_minutes` (integer, 15 to 720)
- Written by `useUpdateTripPlace`

## Defaults
- Initial value set at add-place time by `src/lib/categoryDurations.ts` (museum=120, restaurant=90, etc.)
- User overrides persist per place

## Edge cases
- Clamped at min/max; increment/decrement buttons disable at the boundary
- Triggers auto-optimize 500ms later (day split may change)

## Test plan
- Unit: `src/components/__tests__/VisitDurationStepper.test.tsx` covers increment, decrement, clamp, formatting ✅
