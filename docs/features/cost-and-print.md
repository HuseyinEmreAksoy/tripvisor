# cost-and-print

> **⚠ v1 historical record — superseded by [`docs/v2/`](../v2/architecture.md) (2026-06-10).** The per-km cost model (`cost_per_km`), its rollup formula, the print "/km" line, and the trips-list "Cost" sort described below were **retired in v2 Phase 0.1** — replaced by the category `trip_expenses` model + time metrics ("Duration" sort). See `plan-v2.md`.

**Status**: ✅ Done (Web). Native deferred to user smoke (read-only view only).
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, optimization (trip_legs must exist)
**Shipped on**: 2026-04-25 — Phase 8

## Platforms verified
- ☐ iOS — deferred to user smoke (read-only print view renders; `window.print()` deliberately absent)
- ☐ Android — deferred to user smoke (read-only print view renders; `window.print()` deliberately absent)
- ☑ Web — visual smoke confirmed 2026-04-25 (rollup card, day summary cards, cost editor, print route, browser print preview)

## User story
As a trip planner, I want to see a cost estimate and a per-day breakdown of my itinerary, and be able to print a clean A4 itinerary, so that I have a useful road-trip artifact from the optimizer output without needing to leave the app.

## Intent
Turn the optimizer's already-cached `trip_legs` rows into visible, useful output: a cost rollup, per-day summary cards, and a printable itinerary. No new Google API calls are required; all inputs (`distance_meters`, `duration_seconds`, `visit_duration_minutes`) are cached from Phase 2.

## Scope
- Per-trip cost rollup card (`TripCostRollup`) at the top of the trip detail screen.
- Per-day summary card (`DaySummaryCard`) at the top of each day section.
- Inline "Cost settings" section on the trip detail screen: currency picker and debounced cost-per-km rate input.
- "Print itinerary" button on the trip detail screen navigating to `/trip/[id]/print`.
- Print route with `@media print` A4 stylesheet (web) and read-only scrollable view (native).

## Data model
Migration: `supabase/migrations/0005_trip_cost_meta.sql`

Two new columns on `public.trips`:

| Column | Type | Default | Constraint |
|---|---|---|---|
| `currency` | `text not null` | `'USD'` | `check (currency in ('USD','EUR','GBP','TRY','JPY'))` |
| `cost_per_km` | `numeric(8,4) not null` | `0.20` | — |

No new tables. No new RPCs. No new RLS policies — existing `trips_owner_all` policy gates the row; the new columns inherit it. Existing trips backfill with the defaults on migration apply.

## API surface
- `src/api/types.ts` — `TripCurrency = 'USD' | 'EUR' | 'GBP' | 'TRY' | 'JPY'` literal union; `Trip.currency: TripCurrency`; `Trip.cost_per_km: number`.
- `src/api/trips.ts` — `useUpdateTrip(tripId)` mutation, patch shape `Partial<Pick<Trip, 'title' | 'currency' | 'cost_per_km'>>`. Follows the `useArchiveTrip` family pattern. Invalidates `['trips']` and `['trip', id]`.
- `useTrip(id)` — existing hook; reads `currency` and `cost_per_km` automatically once columns exist.

## Math
Cost = `sum(leg.distance_meters) / 1000 * trip.cost_per_km`, computed client-side in `useMemo` keyed on `[legs, cost_per_km, currency]`. Cost is never persisted; a duplicated trip re-derives correct cost once the optimizer runs. See [ADR-0007](../adr/0007-cost-rollup-client-side.md) for the decision to keep cost client-side rather than in a Postgres view or generated column.

Empty state: when `legs.length === 0` (trip not yet optimized), the rollup card shows "—" and "Optimize the trip to see cost estimate".

## UI components
- `src/components/TripCostRollup.tsx` — props `{ trip: Trip, legs: TripLeg[] }`. Shows total cost, total distance (km), total drive time (Xh Ym). "Powered by Google" attribution footer. Memoized.
- `src/components/DaySummaryCard.tsx` — props `{ dayIndex: number, places: TripPlace[], legs: TripLeg[], trip: Trip }`. Shows place count, total visit hours, drive time, drive distance, estimated cost for that day only. Placeholders when legs for the day are missing.
- `app/(app)/trip/[id]/index.tsx` — wires both cards; adds "Cost settings" section (SegmentedControl for currency, numeric debounced TextInput for rate; debounce cleanup on unmount — M1 fix); adds "Print itinerary" button.

## Print page
Route: `app/(app)/trip/[id]/print.tsx`

Web behaviour:
- Injects `@media print { @page { size: A4 portrait; margin: 1.5cm; } [data-no-print] { display: none; } .tripvisor-print-root { ... } }` via runtime `require('expo-router/head')`.
- App chrome (header, tab bar) tagged `data-no-print` so it disappears in print preview.
- "Print this page" button calls `window.print()`, gated by `Platform.OS === 'web'`.
- "Powered by Google" attribution footer (place data is Google-derived).

Native behaviour:
- Same JSX tree renders as a scrollable read-only view.
- Inline note: "Open this trip on the web to print".
- No `expo-print`, no `expo-sharing`, no PDF generation — explicitly out of scope.

## Platform differences
No platform-split component files needed. Web and native render the same component tree; `Platform.OS === 'web'` guards the `window.print()` call and the style injection. The `@media print` CSS is a no-op on native.

## Open follow-ups
Cross-reference `docs/reviews/phase-8.md` for full reviewer findings.

- **M2** — `commitBudget` / `commitMode` on the trip detail screen write Supabase directly without TanStack invalidation. Phase-9 candidate: migrate both callers to `useUpdateTrip` with widened patch shape. Parked.
- **L1** — JPY `maximumFractionDigits: 2` on the print rate label renders `¥0.20` (defensible; per-km rate is not a cash amount). Parked.
- **L2** — `_TripLegRef` workaround instead of removing the unused import in `print.tsx`. Parked.
- **L3** — `Intl.NumberFormat` constructor allocated on every render in `TripCostRollup`, `DaySummaryCard`, `print.tsx`. Parked (not measurable below ~20 days).
- **L4** — `inputMode={"decimal" as any}` cast in cost-per-km TextInput. Drop on next touch (RN >= 0.72 ships the typing). Parked.
- **L5** — empty-patch early return in `useUpdateTrip` skips `getCallerId()`; intent is clear but deserves a comment. Parked.
