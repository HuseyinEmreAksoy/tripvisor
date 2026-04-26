# place-details

**Status**: 🚧 In progress (code complete, awaiting live Google key; Phase 23: expandable reviews + N-of-M footer; smoke deferred per user direction)
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
- Renders: name, address, rating + count, opening hours, photo strip, up to 5 reviews
- Attribution: "Powered by Google" footer; per-review author name + relative time + profile photo; photo `attributions[]` under each photo
- Image optimization via `expo-image` (caching, placeholders, transitions)

### Per-review "Show more / Show less" toggle (Phase 23)

Each `ReviewCard` has a local `expanded` state (default `false`). When collapsed: `numberOfLines={6}` truncates long reviews. When expanded: full text with no truncation. A `Pressable` toggle renders below the review text only when `review.text.text.length >= 280` (threshold for reviews long enough to warrant truncation). `accessibilityRole="button"` with `accessibilityLabel="Show full review by <author>"` / `"Collapse review by <author>"`.

### Reviews footer (Phase 23)

After the reviews list, a footer line reads `Showing {reviews.length} of {userRatingCount} reviews (Google API limit)` when `userRatingCount > reviews.length`. Rendered in `t.typography.caption` + `t.colors.textMuted`. `accessibilityRole="text"` + `accessibilityLiveRegion="polite"` so screen readers announce it when reviews load. The cap is 5 reviews — a Google Places API limit, not a local constraint. Minimum touch target on the toggle is 44 px.

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
