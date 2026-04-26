# Analytics / Insights

**Status**: 🚧 In progress
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: Expense tracking (Phase 20/21 — `trip_expenses` table), Place reactions (Phase 24 — `trip_place_reactions` table), Trip collaboration (Phase 21/22 — `useTrips()` UNION hook)

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Smoke and automated tests deferred per user direction on 2026-04-26.)

## User story
As a traveler with multiple trips, I want a single screen that shows me how I spend my travel budget and which places I tend to like or dislike across all my trips, so that I can make better decisions when planning future trips.

## UI

### Screen
`app/(app)/analytics.tsx` — reachable from the trips list header via the "Insights" button (next to Settings). Desktop-aware layout via `useBreakpoint`: single-column on mobile/tablet; two-column chart grid at >= 1024 px.

### Charts (four sections)

| # | Chart type | X axis | Y axis | Visibility condition |
|---|---|---|---|---|
| 1 | Bar | Trip title (truncated 14 chars) | Sum of `kind='actual'` expenses | Always shown (empty state if no expenses) |
| 2 | Donut / Pie | `category` label | Sum of all actual expenses across trips | Always shown (empty state if no expenses) |
| 3 | Grouped bar | Trip title | Liked count, disliked count (two series) | Only trips with >= 1 reaction |
| 4 | Line | `trip.start_date` | Total actual spend per trip | Only when >= 3 trips have a `start_date` |

### Catalogs (two textual sections)
- **Most liked places overall** — top 5 places by reaction `'liked'` across all trips.
- **Places you didn't like overall** — top 5 places by reaction `'disliked'` across all trips.

Both catalogs use `useAllUserReactions()` (Phase 24 hook). Empty sections are hidden.

### Loading / empty states
Each chart section has an independent loading skeleton and an empty state with explanatory copy (e.g., "Log expenses or react to places to see analytics").

### Key interactions
- Entry point: "Insights" button on trips list header; navigates to `/(app)/analytics`.
- Back navigation: standard back affordance returns to trips list.

### Platform differences
None architecturally. Chart SVG sizing uses `useWindowDimensions` for explicit `width`/`height` props so all three platforms render correctly.

## Data

### Tables touched (read-only)
- `trips` (via `useTrips()`)
- `trip_expenses` (via `useAllUserExpenses()`)
- `trip_place_reactions` (via `useAllUserReactions()`)
- `trip_places` (for catalog place name lookup)

### New columns/tables
None — analytics is fully derived from existing data.

### RLS
Inherits from the source tables. All queries are scoped to `auth.uid()` through the existing RLS policies. The analytics screen never reads another user's data.

## APIs

### Edge Functions called
None. All aggregation is client-side from existing TanStack Query hooks.

### Google API endpoints
None. Analytics uses only user-authored data (expense amounts, reaction values). No Google Place fields are fetched or displayed. "Powered by Google" attribution is not required on this screen.

## Chart implementation decision

`victory-native@41` was evaluated during Step 24.11 and rejected: it requires `@shopify/react-native-skia >= 1.2.3`, which in turn requires React 19. The project is on React 18, making the peer conflict a hard blocker.

Decision: hand-roll SVG charts using `react-native-svg` (already a transitive dependency of `react-native-maps`). Three chart components:
- `src/components/charts/BarChart.tsx`
- `src/components/charts/PieChart.tsx`
- `src/components/charts/LineChart.tsx`

Trade-offs accepted: less animation polish vs. `victory-native`; no accessibility tree auto-generation (static SVG — future enhancement). When the project moves to React 19, these can be swapped for `victory-native` with no data-model change (Phase 25 candidate).

## Edge cases

- **No expenses logged**: charts 1, 2, and 4 show empty states; chart 3 may still render if reactions exist.
- **No reactions**: chart 3 is hidden entirely; catalogs show empty states.
- **< 3 trips with `start_date`**: chart 4 is hidden with a placeholder ("Add at least 3 trips with start dates to see this chart").
- **Trip with both own and collaborated expenses**: `useAllUserExpenses()` is RLS-scoped to `auth.uid()` — it returns only expenses from trips where the user is the owner (via `trips.user_id`). Collaborator-visible expenses on other people's trips are not aggregated in v1.
- **Very large trip counts (> 50)**: v1 caps aggregation to the first 50 trips by `created_at desc`. Documented as a known limitation.

## Test plan
Deferred per user direction on 2026-04-26 (same policy as Phases 21–23).

When executed:
- **Unit**: aggregation helper functions (expense sums per category, reaction counts per trip).
- **Component (native + web)**: analytics screen renders skeleton states; empty states appear with correct copy; charts receive correct data props.
- **Integration**: `useAllUserExpenses` and `useAllUserReactions` return RLS-scoped data only.
- **E2E (web Playwright)**: navigate to analytics from trips list; verify chart sections render or show empty states.
- **Manual native smoke (iOS + Android)**: screen opens; charts render; back navigation works.

## Known limitations
- Aggregation is fully client-side. With 100+ trips, the `useQueries` fan-out for per-trip expenses may be slow. Server-side aggregation (Postgres view or RPC) is deferred to a future phase.
- Collaborated trips' expenses are not aggregated (only owned trips). This is a v1 simplification.
- Chart animations are minimal (static SVG) compared to what `victory-native` would provide.
- Export of analytics data is not supported; this would require a new export endpoint in Phase 25+.
