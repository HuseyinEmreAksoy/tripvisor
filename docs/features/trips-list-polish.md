# trips-list-polish

**Status**: Done (Web). Native deferred to user smoke.
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: trip-lifecycle (Phase 7 — Active/Archived tab segmented control)
**Shipped on**: 2026-04-25 — Phase 11 (search + 3-key sort); Phase 12 (Cost sort + date filter)

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25 (search input, sort cycle, empty-results state all render correctly)

## Intent

Make the trips list usable as the number of trips grows beyond a handful of entries. A user with 10–50 trips should be able to find a specific trip by name and order the list by a meaningful criterion without navigating away from the list screen.

## Scope

### Shipped (Phase 11)
- **Search input**: `TextInput` at the top of the trips list, debounced 200ms, case-insensitive substring match on `trip.title`. Shows a clear (×) button when non-empty. Filtering is pure client-side — no new API call.
- **Sort tap-to-cycle** (3 keys): a `Pressable` label cycling through:
  - Recent — descending creation order (default, matches the API's existing ordering)
  - A-Z — locale-aware ascending by `title` via `Intl.Collator`
  - Start date — ascending by `start_date`; trips with `null start_date` sort to the bottom
- **Tab-switch reset**: switching between the Active and Archived tabs resets search, sort, and date filter to defaults.
- **Empty-results state**: when the filtered list is empty but the underlying trip list is non-empty, renders "No trips match your search" in place of the list.

### Shipped (Phase 12)
- **Cost sort** (4th sort key) — batched `useAllTripLegs(tripIds)` hook in `src/api/routes.ts` issues a single `select trip_id, distance_meters from trip_legs where trip_id in (...)` with a sorted, stable query key (`TripLegCostRow` type). Trips with no legs sink to the bottom of the list.
- **Date filter** — `FilterSheet` (`src/components/FilterSheet.tsx`) exposes All / Upcoming / Past options. Applied after search, before sort. `FilterSheet` wraps the existing platform-split `BottomSheet`; uses `accessibilityRole="radiogroup"` on the list and `radio` + `accessibilityState={{ checked }}` per row. Tab-switch resets the filter to All alongside search/sort reset.

## API surface

Phase 11: pure UI change — no new Edge Functions, no new hooks, no schema changes.

Phase 12 addition: `useAllTripLegs(tripIds: readonly Uuid[])` in `src/api/routes.ts`. Batched Supabase query (`select trip_id, distance_meters from trip_legs where trip_id in (...)`); sorted query key for cache stability. Returns `{ ...query, byTripId: Map<Uuid, TripLegCostRow[]> }`. No Edge Function; no schema change.

## Data

- **Tables touched**: none (reads existing `trips` rows already loaded by `useTrips()`)
- **New columns/tables**: none
- **RLS**: unchanged

## Platform differences

- No platform-specific code paths. `Intl.Collator` is available on modern RN (Hermes) and web. `TextInput` and `Pressable` are universal RN primitives.

## Edge cases

- Search with all-whitespace input: treated as non-empty (no auto-trim); user must press clear button.
- Trip with `null title`: excluded from A-Z sort results by `Intl.Collator` (sorts to end in most locales); acceptable — titles are required at creation.
- Trip with `null start_date` on Start date sort: sorted to the bottom (explicit special case).
- Empty underlying list (user has no trips): the existing empty-state ("Plan your first trip") renders as before; the search/sort controls are not shown when the base list is empty.
- Active and Archived tabs each maintain independent sort/search reset on tab switch.

## Open follow-ups

None. Cost sort and date filter were both closed in Phase 12.
