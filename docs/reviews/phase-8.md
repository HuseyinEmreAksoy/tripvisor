# Phase 8 — Pre-exit review

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only)
**Scope**: Uncommitted Phase 8 diff per planner Step 8.7 — cost rollup, day summary, in-place editor, printable A4 view.

## Summary

- **RLS / authorization**: clean. `currency` and `cost_per_km` are additive columns on `public.trips`; the existing `trips_owner_all` policy gates the row, and `useUpdateTrip` adds defense-in-depth `.eq('user_id', userId)`.
- **Cost rollup math**: correct. `legs.reduce((s,l) => s + l.distance_meters, 0) / 1000 * trip.cost_per_km`. Rounding only at format layer.
- **Currency parity**: TS `TripCurrency` union, SQL `trips_currency_check`, in-file `CURRENCIES` array all list `USD/EUR/GBP/TRY/JPY` identically.
- **PII in print logs**: clean. No `console.*` in the print page.
- **"Powered by Google" attribution**: present on `TripCostRollup` (footer) and on the print page.
- **`window.print()` gating**: belt-and-suspenders. Render gate (`Platform.OS === 'web'`) + inner runtime guard. Metro tree-shakes from native bundles.
- **Google ToS regressions**: clean. Print page reads only `trip_places` user/category/visit-duration/notes/lat/lng — no rating/reviews/photos/hours.

## Critical findings

**None.**

## High findings

**None.**

## Medium findings

### M1 — `useUpdateTrip` debounce timer not cleared on unmount
- **Severity**: medium
- **Category**: correctness
- **Location**: `app/(app)/trip/[id]/index.tsx` (`SettingsTab` → `rateTimerRef`)
- **Observation**: `rateTimerRef.current` was set with `setTimeout` but had no cleanup. If the user typed and navigated away within 500ms, the pending callback fired post-unmount and stealth-wrote `cost_per_km` against the previous tripId.
- **Disposition**: **Fixed.** Added `useEffect(() => () => { if (rateTimerRef.current) clearTimeout(rateTimerRef.current); }, [])` cleanup hook.

### M2 — `commitBudget` / `commitMode` write Supabase directly without TanStack invalidation
- **Severity**: medium (parked candidate)
- **Category**: maintainability / correctness
- **Location**: `app/(app)/trip/[id]/index.tsx` (`commitBudget`, `commitMode`)
- **Observation**: Pre-existing pattern: budget and transport mode are written via raw `supabase.from('trips').update(...)` with no `qc.invalidateQueries`. Phase 8's `useUpdateTrip` introduces a clean pattern that the same screen contradicts two functions away.
- **Disposition**: **Parked.** Phase-9 candidate — extend `useUpdateTrip` patch shape with `daily_hours_budget` + `transport_mode` and migrate the two callers.

## Low findings

### L1 — JPY display with `maximumFractionDigits: 2` on print rate label
- **Severity**: low
- **Category**: a11y / UX polish
- **Location**: `app/(app)/trip/[id]/print.tsx` (cost rate label)
- **Observation**: `Intl.NumberFormat('ja', { style: 'currency', currency: 'JPY', maximumFractionDigits: 2 }).format(0.2)` renders `¥0.20`. JPY conventionally has no minor unit; defensible since this is a per-km rate not a cash amount.
- **Disposition**: Park.

### L2 — `_TripLegRef` workaround instead of removing unused import
- **Severity**: low
- **Category**: maintainability
- **Location**: `app/(app)/trip/[id]/print.tsx` (~line 301)
- **Disposition**: Park; quick fix on next touch.

### L3 — `Intl.NumberFormat` constructor allocated on every render
- **Severity**: low
- **Category**: perf nit
- **Location**: `TripCostRollup.tsx`, `DaySummaryCard.tsx`, `print.tsx`
- **Disposition**: Park. Not measurable below ~20 days.

### L4 — `inputMode={"decimal" as any}` cast in cost-per-km TextInput
- **Severity**: low
- **Category**: type safety
- **Location**: `app/(app)/trip/[id]/index.tsx`
- **Disposition**: Park. RN ≥ 0.72 ships `inputMode` typing without cast — drop the cast in a polish pass.

### L5 — Empty patch no-op skips `getCallerId()` (intentional, but worth a comment)
- **Severity**: low
- **Category**: clarity
- **Location**: `src/api/trips.ts` (`useUpdateTrip` mutation early return)
- **Disposition**: Park.

## Sign-off

**SHIP.**

No critical or high findings. The two new columns inherit RLS correctly, the math is right, the currency lists agree across type / SQL / UI, no PII is logged, "Powered by Google" is on every Place-data screen, and `window.print()` cannot reach the native bundle. M1 fixed; M2 + lows parked as follow-ups.

## Files referenced

- `supabase/migrations/0005_trip_cost_meta.sql`
- `supabase/migrations/0001_init.sql` (RLS cross-ref)
- `src/api/types.ts`
- `src/api/trips.ts`
- `src/components/TripCostRollup.tsx`
- `src/components/DaySummaryCard.tsx`
- `src/components/PoweredByGoogle.tsx`
- `app/(app)/trip/[id]/index.tsx`
- `app/(app)/trip/[id]/print.tsx`
- `docs/adr/0007-cost-rollup-client-side.md` (decision reference)
- `docs/reviews/phase-7.md` (format reference)
