# trips-list-polish

**Status**: Done (Web). Native deferred to user smoke.
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: trip-lifecycle (Phase 7 — Active/Archived tab segmented control)
**Shipped on**: 2026-04-25 — Phase 11

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25 (search input, sort cycle, empty-results state all render correctly)

## Intent

Make the trips list usable as the number of trips grows beyond a handful of entries. A user with 10–50 trips should be able to find a specific trip by name and order the list by a meaningful criterion without navigating away from the list screen.

## Scope

### Shipped
- **Search input**: `TextInput` at the top of the trips list, debounced 200ms, case-insensitive substring match on `trip.title`. Shows a clear (×) button when non-empty. Filtering is pure client-side — no new API call.
- **Sort tap-to-cycle**: a `Pressable` label that cycles through three modes on each tap:
  - Recent — descending creation order (default, matches the API's existing ordering)
  - A-Z — locale-aware ascending by `title` via `Intl.Collator`
  - Start date — ascending by `start_date`; trips with `null start_date` sort to the bottom
- **Tab-switch reset**: switching between the Active and Archived tabs resets both the search text and the sort mode to their defaults (empty search, Recent sort).
- **Empty-results state**: when the filtered list is empty but the underlying trip list is non-empty, renders "No trips match your search" in place of the list.

### Deferred
- **Cost sort** — would require aggregating `trip_legs.distance_meters` across all trips in the list (effectively one `useTripLegs` call per trip card — N+1). Needs a server-side cost-rollup field or a batched aggregation query before it is safe to expose. Phase 12+ candidate.
- **Date filter (Upcoming/Past)** — a segmented "Upcoming / Past" filter based on `start_date` relative to today. Deferred because the current trips list header is already space-constrained on 360px-wide viewports; a filter drawer or expandable header is needed first. Phase 12+ candidate.

## API surface

Pure UI change. No new Edge Functions. No new TanStack Query hooks. No schema changes. All filtering and sorting operate on the already-fetched `useTrips()` result in local component state.

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

- **Cost sort**: compute legs aggregations server-side (e.g. a `trips` view or a materialized `total_cost` column updated by a trigger) or cache in the existing `useTrips` payload before exposing as a sort option. Primary concern is avoiding N+1 hook calls per trip card.
- **Date filter (Upcoming/Past)**: implement when layout supports a filter surface on narrow viewports — candidate for a slide-down filter drawer or a chips row below the search input.
