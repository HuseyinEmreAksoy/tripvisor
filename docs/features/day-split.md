# day-split

**Status**: 🚧 In progress (code complete)
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: optimization

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a planner, I want the app to propose how to split my places across days based on the time I'm willing to spend each day, so I don't have to manually juggle the clock.

## UI
- Itinerary tab in trip detail (`app/(app)/trip/[id]/index.tsx`) — SectionList-style per-day grouping
- Day header has a colored left-border matching the day color on the map
- Travel-time annotation between consecutive places (`↓ 12 min · 5 km`)
- "Unscheduled" bucket surfaced when `day_index` is null (e.g. brand-new place before next optimize)

## Data
- `trip_places.day_index` + `trip_places.order_in_day` — written by `optimize-trip`
- `trip_legs` — used to display travel time/distance in the itinerary

## Settings
- Daily hours budget (2–14h slider in Settings tab) drives cluster count
- Transport mode (drive/walk/transit SegmentedControl) affects travel times

## Edge cases
- Budget change mid-trip: auto-optimize fires 500ms after the slider settles
- Zero places: placeholder "Add your first destination" copy
- Places with no day_index after a failed optimize: render in "Unscheduled"

## Test plan
- Unit: day-split branching covered by optimizer property tests
- Component: pending (future regression test for ItineraryTab grouping)
