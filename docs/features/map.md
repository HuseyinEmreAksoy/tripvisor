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

## Test plan
- Component: manual smoke on all three platforms (polyline visual)
- E2E: deferred to Phase 4
- Known issue (Problem 2 in Phase 2 review): web Polylines flicker on re-render; safe but cosmetic
