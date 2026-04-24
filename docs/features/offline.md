# offline

**Status**: 🚧 Code complete · awaiting native smoke
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, day-split, optimization

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Check a box only after smoke-testing on that platform.)

## User story
As a traveller, I want to view my saved itinerary when I have no internet connection, so I can navigate my trip without relying on data.

## UI
- Offline banner (or toast) rendered by `useIsOnline()` when network goes away — appears on the trips list and trip detail screens.
- No new dedicated screen: the existing itinerary and trips list screens read from the TanStack Query cache which is already hydrated from persisted storage.
- Platform difference: `useIsOnline()` is platform-split — `src/api/offline.native.ts` uses `@react-native-community/netinfo`; `src/api/offline.web.ts` uses `window.navigator.onLine` + `online`/`offline` event listeners.

## Data
- Persisted query keys (allowlist): `["trips"]`, `["trips", id]`, `["trip-places", id]`, `["trip-legs", id]`
- Never persisted: `["place-details", ...]`, `["places-autocomplete", ...]` (Google ToS)
- Storage backend: AsyncStorage on native (existing persister); localStorage via `@react-native-async-storage/async-storage` web shim
- Max age: 7 days (`maxAge` in `PersistQueryClientProvider`)
- Buster: `phase-4-allowlist-v1` — old caches (pre-Phase 4) are discarded on first launch after upgrade, preventing stale ToS-restricted data from re-hydrating

## APIs
- No new Google API calls. Offline reads come entirely from local storage.
- `shouldDehydrateQuery` helper in `src/api/offline.ts` implements the allowlist; consumed by `persistQueryClient` `dehydrateOptions` in `app/_layout.tsx`

## Edge cases
- Pre-Phase-4 users had `place-details` / `places-autocomplete` keys in their persisted cache. The `buster: 'phase-4-allowlist-v1'` migration string discards the prior cache entirely on first launch — no stale ToS data re-hydrates.
- `["trip-legs", id]` entries older than 30 days satisfy the allowlist but violate the Google Routes API ToS ceiling. The leg TTL is enforced at read time by the optimizer; the offline viewer shows whatever is cached and adds a "Route times may be outdated" note when legs are older than 30 days.
- On web, `localStorage` quota (5 MB) may be exhausted for users with many large trips. Quota-exceeded errors are captured by Sentry; explicit eviction is deferred to a follow-up ADR.
- `networkMode: 'offlineFirst'` is set only for allowlisted query keys — non-persisted queries still require a network connection.

## Test plan
- Unit: `src/api/__tests__/offline.test.ts` — asserts `shouldDehydrateQuery` blocks `place-details` and `places-autocomplete`; allowlisted keys pass through; cache snapshot contains only the four permitted roots ✅
- Component: offline banner renders when `useIsOnline()` returns `false` ✅
- E2E (Playwright): `e2e/web/phase-4-polish.spec.ts` Check 5 — `page.context().setOffline(true)` then reload; trips list still renders from cache ✅
- Manual native smoke (iOS + Android): open app with Wi-Fi off after prior authenticated session; confirm trips list + trip detail load without errors — deferred to user

## ADR
- [ADR-0005 — Offline cache policy](../adr/0005-offline-cache-policy.md)

## Review
- [Phase 4 review — Problem 5 (persister buster)](../reviews/phase-4.md)
