# map

**Status**: 🚧 In progress (code complete; web polyline cleanup is a fast-follow — see Phase 2 review)
**Owner agents**: ui-specialist
**Depends on**: optimization

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a traveler, I want to see my whole itinerary on a map with color-coded days so I can grasp the geography at a glance.

## UI
- `src/components/Map/Map.native.tsx` — `react-native-maps` + `PROVIDER_GOOGLE`
- `src/components/Map/Map.web.tsx` — `@vis.gl/react-google-maps` (APIProvider + AdvancedMarker; Polyline via imperative `google.maps.Polyline`)
- Shared props: `{ markers, polylines, initialRegion, onMarkerPress }`
- Day colors: palette of 7 hues; wraps for day 8+

## Data
- Markers: `trip_places` rows (lat/lng + day_index)
- Polylines: `trip_legs.polyline` (encoded, decoded on the client via `src/components/Map/polyline.ts`)

## APIs
- None directly from the map — consumes data already cached by TanStack Query
- Web map requires `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` (referer-restricted)
- Native map uses the SDK key in `app.json` (bundle-id-restricted)

## Edge cases
- No web API key set → renders a fallback panel with instructions
- Empty markers → initial region zoomed out to world view
- Single-place trip → no polylines, single marker centered

## Phase 15 — Per-day chip filter (shipped 2026-04-25)

A horizontal `ScrollView` chip row ("All" + one chip per day) sits above the existing `<Map>` inside `MapTab` in `app/(app)/trip/[id]/index.tsx`. Selecting a chip filters both `markers` and `polylines` via `useMemo` before they are passed down to the Map component — no new API calls, no backend changes.

- `availableDays` memo: distinct, sorted `day_index` values from places where `day_index` is non-null and `>= 0`. Chip row is hidden entirely when this list is empty (e.g. before optimize runs).
- Day labels are 1-based to match the Itinerary tab (`day_index 0` → "Day 1").
- Unassigned places (`day_index === null`) appear only in the "All" view.
- If the selected day becomes invalid (all its places deleted), a `useEffect` resets selection to `'all'`.
- State is per-session only — not persisted to URL.
- A11y: wrapper `accessibilityRole="radiogroup"`, each chip `accessibilityRole="radio"` with `accessibilityState={{ checked }}`.
- Color dots on chips use `dayColor(dayIndex)` — same palette as the rest of the app.

Non-goals for this phase: Itinerary tab filtering, URL persistence, map viewport auto-fit to selected day.

## Test plan
- Component: manual smoke on all three platforms (polyline visual)
- E2E: deferred to Phase 4
- Known issue (Problem 2 in Phase 2 review): web Polylines flicker on re-render; safe but cosmetic
