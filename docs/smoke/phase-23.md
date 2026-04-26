# Smoke log — Phase 23

**Phase**: 23 — Routing UX (manual vs. optimal) + per-day add flow + travel/dwell labels + reviews expansion + transport-mode polylines
**Date**: 2026-04-26
**Status**: DEFERRED — automated tests (Step 23.12) and live smoke (Step 23.13) explicitly skipped per user direction on 2026-04-26. Same policy as Phases 21 and 22.

## Deferred state

The user directed the team to skip automated tests (Step 23.12) and live smoke (Step 23.13) for this phase. The hygiene check in Step 23.11 (`npx tsc --noEmit` + `npx supabase db reset`) was run and confirmed clean, but no browser golden-path walk was performed and no platform verification was recorded.

This file exists to make the deferred state visible. The relevant feature docs (`docs/features/optimization.md`, `docs/features/place-details.md`, `docs/features/trip-crud.md`) continue to carry empty platform-verified boxes — none were ticked in Phase 23.

## Note on migration filename

Migration `0016_trips_route_render_mode.sql` landed in slot 0016 with no conflict. The previous migration `0015_trips_editor_budget_rls.sql` occupied slot 0015.

## Code-complete, unverified items

The following deliverables shipped at the code level in Phase 23 and are considered code-complete but unverified by smoke:

- **`route_render_mode` column** (`supabase/migrations/0016_trips_route_render_mode.sql`) — `trips.route_render_mode text NOT NULL DEFAULT 'optimized' CHECK IN ('optimized', 'manual')`. `enforce_trips_column_restrictions` trigger updated to include `route_render_mode` in the editor-allowed-diff list (alongside `total_budget` and `updated_at`). Transport-mode CHECK widened to include `'bicycling'`.
- **`optimize-trip` manual mode** — `mode: 'manual'` branch skips k-means + 2-opt; reads existing `(day_index, order_in_day)` as authoritative; still calls `directions-polyline` per day for accurate durations. Row-mutex preserved. `manual_mode_no_assignments` error code (400) surfaced when places exist but none have a `day_index`.
- **`directions-polyline` transit null-polyline** — returns `polyline: null` for transit; still returns `duration_seconds` + `distance_meters`. Bicycling mapped to `BICYCLE` Routes API enum.
- **`distance-matrix` bicycling** — `BICYCLE` enum added.
- **Client API** — `RouteRenderMode` type, `Trip.route_render_mode` non-optional, `UpdateTripPatch.route_render_mode`, `useUpdateRouteRenderMode(tripId)` (omits owner-only filter), `useOptimizeTrip({ tripId, mode? })`, `TransportMode` widened to include `'bicycling'`.
- **`RouteRenderModeControl`** segmented control ("Best route" / "My order") above day chips in `MapTab`. Viewer read-only via `useTripRole`. Empty-state variant renders the control with a hint line.
- **Transit dashed polylines** — `MapPolyline` type extended with `isDashed`, `from`, `to`. `Map.web.tsx` uses `icons` dot pattern; `Map.native.tsx` uses `lineDashPattern={[6,6]}`. Solid polylines unchanged.
- **"Plan transit" deep link** — per-leg connector in transit mode shows `duration_seconds` estimate + "Plan transit ↗" link to Google Maps.
- **Add-place flow rewrite** (`app/(app)/trip/[id]/add.tsx`) — day picker chips, stay-on-screen after save, "Added to Day N" toast, stepper, `?day=N` URL param, bicycling in `app/(app)/trip/new.tsx`.
- **Per-review "Show more / Show less"** (`app/(app)/place/[placeId].tsx`) — toggle at 280-char threshold, 44 px min touch target, a11y labels, "Showing N of M reviews (Google API limit)" footer.
- **`DaySummaryCard`** — three time chips: Visit, Travel, Day (total).
- **Visit vs. Travel labels** — `PlaceRow` shows `Visit ~Xm` and `Travel ~Ym · N km`; `DaySummaryCard` chips relabeled to mode-agnostic "Travel"; `PlaceActionsSheet` helper text updated.
- **`src/lib/formatDuration.ts`** — `formatDuration(minutes)` + `formatDurationSeconds(seconds)`.

## Action required before feature status can advance to "Done"

1. Run automated tests: `npm test` covering the five Phase 23 golden paths (route-render-mode toggle, manual optimize branch, transit dashed lines, add-flow day picker, reviews expansion).
2. Walk web golden paths in a real browser and record PASS / FAIL per path.
3. Tick platform-verified boxes in `docs/features/optimization.md`, `docs/features/place-details.md`, and `docs/features/trip-crud.md` only after smoke passes on each platform.
4. Resolve the `useUpdateTripBudget` owner-only filter inconsistency (Phase 24 candidate — see `plan.md` Phase 24 candidates section).
