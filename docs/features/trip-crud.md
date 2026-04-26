# trip-crud

**Status**: 🚧 In progress — Phase 20 time-first copy, desktop grid, and `total_budget` column shipped 2026-04-25; web verified; native deferred. Phase 23: add-place flow rewritten (day picker + stay-on-screen + stepper); bicycling in transport picker; smoke deferred per user direction.
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: auth

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ✅ Web — Phase 20 smoke green 2026-04-25 (trips list + create form confirmed)

## User story
As a traveler, I want to create, view, and delete trips so I can organize my upcoming holidays.

## UI
- `app/(app)/trips.tsx` — list with empty / loading / error states, pull-to-refresh
- `app/(app)/trip/new.tsx` — create form (title, dates, daily budget, transport mode)
- `app/(app)/trip/[id]/index.tsx` — detail shell (metadata header + places list placeholder, map & optimization come in Phase 2)
- `src/components/TripCard.tsx` — card used on list screen
- `src/components/DateField.{native,web}.tsx` — platform-split date picker

Platform differences:
- Date picker: `@react-native-community/datetimepicker` on native, HTML `<input type="date">` on web
- Delete confirmation: `Alert.alert` on native, `window.confirm` on web

## Data
Tables: `trips`, `trip_days`, `trip_places`, `trip_legs` (schema from Phase 0); `trip_expenses` (Phase 20 — see [expenses.md](expenses.md)).
Phase 1 only writes to `trips` (create, delete) and `trip_places` (read).
Phase 20 adds `trips.total_budget numeric null` (migration `0010_trip_budget_categories.sql`) for the overall trip budget. The old `cost_per_km` column is deprecated via SQL COMMENT but not dropped.
RLS policies scope every query via `auth.uid()` / `trips.user_id`.

## Phase 23 changes

### Add-place flow rewrite (`app/(app)/trip/[id]/add.tsx`)

Complete rewrite of the add-place screen:
- **Day picker chips**: horizontal scroll row above the search input — Day 1 … Day N + "Unscheduled". Sourced from `useTripDayCount`. Default selection: Day 1 (or the day passed via `?day=N` URL param).
- **Stay-on-screen after save**: after saving a place, the screen does NOT navigate back. Instead: search input clears, `pickedId` resets, and a transient inline toast shows "Added to Day X".
- **Stepper**: `◀ Adding to Day X ▶` row below the search input after the first save. Tap arrows to cycle between Unscheduled → Day 1 … Day N → Unscheduled. Tap "Done" to navigate back (same as the previous behavior).
- **`order_in_day`**: computed client-side as `max(order_in_day) + 1` within the chosen day from `existingPlaces`. Falls back to `0` for the first place on a day.
- **`?day=N` URL param**: preselects a day chip on mount — used from day-header deep links.
- **Bicycling**: `app/(app)/trip/new.tsx` transport-mode picker now includes `bicycling` as a fourth option alongside driving / walking / transit.

## Phase 20 changes

- **Time-first copy**: new-trip form labels updated to "Destination or trip name" and "Daily plan time (hours)". Empty-state copy updated to "Where to next?" (`src/components/emptyStates.ts`).
- **Desktop trips list**: `app/(app)/trips.tsx` renders a 2-col grid at ≥1024 px and 3-col grid at ≥1440 px via `useBreakpoint`.
- **`BackButton` on new-trip**: `app/(app)/trip/new.tsx` now includes the reusable `BackButton` component.
- **`TripCard` DOM fix**: outer `Pressable` changed to `accessibilityRole="link"` to eliminate `<button>` inside `<button>` DOM nesting on web.

## APIs
- `useTrips()` — `.from('trips').select('*').order('created_at', { ascending: false })`
- `useTrip(id)` — single-row fetch; `maybeSingle()` so missing rows don't throw
- `useCreateTrip(input)` — Zod-validated insert with current user id attached
- `useDeleteTrip(id)` — delete; RLS enforces ownership

## Edge cases
- Missing `start_date` / `end_date` — allowed; TripCard omits the range display
- `end_date < start_date` — rejected client-side in NewTrip form
- Deleting a trip cascades to `trip_places` / `trip_days` / `trip_legs` via FK `on delete cascade`
- Trip list empty state promotes "Create trip"

## Test plan
- Unit: `categoryDurations` (pure fn) ✅
- Component: `TripCard` (title, date range, press) ✅, `Button` ✅, `EmptyState` ✅
- Integration: RLS two-user test ✅
- E2E: deferred to Phase 4
