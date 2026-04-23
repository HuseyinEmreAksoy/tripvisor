# place-details

**Status**: 🚧 In progress (code complete, awaiting live Google key)
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: place-search

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a trip planner, I want to see Google reviews, ratings, opening hours, and photos for a place before committing to it.

## UI
- `app/(app)/place/[placeId].tsx`
- Renders: name, address, rating + count, opening hours, photo strip, 5 reviews
- Attribution: "Powered by Google" footer; per-review author name + relative time + profile photo; photo `attributions[]` under each photo
- Image optimization via `expo-image` (caching, placeholders, transitions)

## Data
- NO server-side persistence of any Place data
- Cached client-side via TanStack Query: `staleTime: 1h`, `gcTime: 24h`, persisted to AsyncStorage

## APIs
- Edge Function `place-details` — Places API (New) `:get`
  - Default full field mask includes `reviews`, `photos`, `regularOpeningHours`
  - Caller may pass a narrower `fields[]` for list contexts (whitelist enforced)
- Photo URLs built client-side from `photo.name` + `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`. Key MUST be referer-restricted in Google Cloud Console.

## Edge cases
- Place with no reviews — section omitted cleanly
- Place with no photos — section omitted cleanly
- Rating absent — star line omitted
- Photo key unavailable — placeholder rendered
- Opening hours absent — section omitted

## Test plan
- Edge Function: `place-details/test.ts` covers field mask, session token, whitelist filtering, `?ping` ✅
- Component: pending (snapshot + attribution presence assertions)
- E2E: deferred to Phase 4
