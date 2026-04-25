# place-search

**Status**: 🚧 In progress (code complete, awaiting live Google key + Supabase)
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: auth, trip-crud

## Platforms verified
- ☐ iOS
- ☐ Android
- ☑ Web (Phase 17 recents verified by ui-specialist 2026-04-25; base autocomplete flow smoke-tested with same session)

## User story
As a trip planner, I want to search Google Places and add results to my trip with minimal typing.

## UI
- `app/(app)/trip/[id]/add.tsx` — debounced search (250ms), suggestion list, selected-place preview, add CTA
- Attribution: "Powered by Google" rendered at the bottom of the suggestions list and on the preview

## Data
- Writes a single row to `trip_places` with `google_place_id`, `lat`, `lng`, user-chosen title, category default, visit duration default
- Does NOT persist: rating, reviews, photos, hours (ToS)

## APIs
- Edge Function: `places-autocomplete`
  - Input: `{ input, sessionToken, locationBias? }`
  - Calls Places API (New) `:autocomplete` with minimal field mask (`placeId`, `structuredFormat`)
- Edge Function: `place-details`
  - Called again with the same `sessionToken` to keep billing on session-token pricing
  - Lean field mask for the preview (default mask is full — trip/add uses default here because the preview is the user's commit screen)

## Edge cases
- `<2 char` input shows "Type at least 2 characters" placeholder
- Session token generated on screen mount via `useAutocompleteSessionToken`, kept stable for the mount lifetime
- Upstream timeout (>3s) surfaces as an inline error; previous suggestions stay visible
- Duplicate add: no guard yet — user can add the same place twice. Planned for Phase 2 (show warning)

## Test plan
- Edge Function: `places-autocomplete/test.ts` covers happy path, `?ping`, method not allowed, invalid input, upstream error ✅
- Component: manual smoke for now; add test for the AddPlace screen in Phase 2
- E2E: deferred to Phase 4

## Phase 17 — Recent place searches (shipped 2026-04-25)

New `src/lib/recentPlaces.ts` util stores the last 10 picked places in AsyncStorage (`STORAGE_KEY = '@tripvisor/recent-places/v1'`). Persisted fields: `placeId`, `mainText`, `secondaryText`, `lastUsedAt`. No live data (photos/reviews/hours/rating) is stored — ToS contract preserved. LRU eviction, deduped by `placeId`.

`app/(app)/trip/[id]/add.tsx` additions:
- On mount: loads recents into local `useState` via `useEffect`.
- Recents rendered in a sibling `<View>` above the autocomplete `FlatList` (not `ListHeaderComponent` — keeps section pinned regardless of scroll position).
- `showRecents = debounced.length < 2 && recents.length > 0` — recents and autocomplete results are mutually exclusive; `searchPrompt` empty state suppressed when recents are shown.
- "Clear recent searches" pressable at the bottom of the recents section.
- After a place is added, `addRecentPlace(...)` fires and forgets before `router.back()`.

Platforms: Web verified. iOS/Android share the same AsyncStorage code path (the library ships a `localStorage` backend on web); native device verification deferred to user smoke.
