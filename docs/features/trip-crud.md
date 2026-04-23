# trip-crud

**Status**: 🚧 In progress (code complete, awaiting live Supabase smoke)
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: auth

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

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
Tables: `trips`, `trip_days`, `trip_places`, `trip_legs` (schema from Phase 0).
Phase 1 only writes to `trips` (create, delete) and `trip_places` (read).
RLS policies scope every query via `auth.uid()` / `trips.user_id`.

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
