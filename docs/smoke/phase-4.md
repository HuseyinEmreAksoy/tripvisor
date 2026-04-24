# Phase 4 — live smoke

**Date**: 2026-04-24
**Tester**: test-specialist
**Build**: `master @ 8bfc57c` (Phase 4 feature code + Phase 4 tests uncommitted)
**Runner**: `npx playwright test e2e/web/phase-4-polish.spec.ts`
**Status**: 🟡 **Partial — all 6 checks written; skipped due to environment prerequisites not met in automated CI**

## Web (Chromium, localhost:8081)

- ⏸ Check 1 — Trips list empty state — **skipped**: `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` not set; requires authenticated session with 0 trips
- ⏸ Check 2 — Map tab fallback (MapUnavailable) — **skipped**: same env prerequisite
- ⏸ Check 3 — Share link create + open anonymous — **skipped**: requires live Supabase + authenticated session
- ⏸ Check 4 — Share link revoke → 404 — **skipped**: same as Check 3
- ⏸ Check 5 — .ics export download — **skipped**: requires authenticated session + trip with data
- ⏸ Check 6 — Offline reload from persisted cache — **skipped**: requires prior authenticated load

All 6 checks ran without error (playwright's `test.skip` path, not failure). Zero tests failed.

## iOS / Android

- Deferred to user smoke

## What was verified automatically

The following were confirmed green by automated Jest + Deno tests (no live Supabase required):

- `tripToIcs` generates valid RFC 5545 output: CRLF endings, correct VEVENT count, VTIMEZONE block for known zones, UTC fallback for unknown zones, text escaping, line folding ≤75 octets (39 Jest assertions)
- `EmptyState` renders all four variants (`noTrips`, `noPlaces`, `noSearchResults`, `searchPrompt`) with correct title, body, CTA, and `accessibilityRole="summary"` (13 Jest assertions)
- `MapUnavailable` groups pins by day, shows "No places added yet" for empty input, omits Google attribution phrasing (6 Jest assertions)
- `Map.web` renders `<MapUnavailable>` when `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is absent/empty; renders the real map container when key is present (4 Jest assertions)
- `initSentry` is a no-op when DSN is absent; idempotent on repeated calls (4 Jest assertions — note: DSN-present branch cannot be covered by Jest due to `babel-preset-expo` compile-time env inlining; see Finding 1)
- `shouldDehydrateQuery` allowlist: trips/trip-places/trip-legs → persisted; place-details/places-autocomplete/anything-else → not persisted (8 Jest assertions)
- `dehydrate()` with allowlist produces exactly 2 queries, excludes Google ToS keys (5 Jest assertions)
- `ShareLinkCard` pre/post/revoke state machine (10 Jest assertions)
- `share-trip` Edge Function: ping, Zod validation, unauthenticated 404, authenticated create returns base64url token, missing token 404, revoked token 404, valid token returns trip+places+legs without `user_id`, revoke + subsequent read 404, OPTIONS preflight (14 Deno assertions)
- `trip_shares` RLS: written and ready to run against local Supabase; follows exact pattern of `rls.test.ts`

## Test counts

| Layer | File | Tests |
|---|---|---|
| Unit | `src/lib/ics/__tests__/generate.test.ts` | 25 |
| Unit | `src/lib/__tests__/sentry.test.ts` | 4 |
| Component | `src/components/__tests__/EmptyState.test.tsx` | 13 |
| Component | `src/components/__tests__/MapUnavailable.test.tsx` | 6 |
| Component | `src/components/__tests__/Map.web.test.tsx` | 4 |
| Component | `src/components/__tests__/ShareLinkCard.test.tsx` | 10 |
| Integration | `src/api/__tests__/offline.test.ts` | 9 |
| Integration | `src/api/__tests__/offline.dehydration.test.ts` | 5 |
| Deno | `supabase/functions/share-trip/test.ts` | 14 |
| RLS | `tests/rls.share.test.ts` | 8 (runs against local Supabase) |
| E2E | `e2e/web/phase-4-polish.spec.ts` | 6 (runs against live Supabase + app) |
| **Total new** | | **104** |

## Unblock checklist (to turn ⏸ into ☑)

For Checks 1–6 to execute:
1. `npx supabase start` (local Supabase must be running)
2. Fill `.env` with `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>`, `SUPABASE_SERVICE_ROLE_KEY=<service>`
3. `npx supabase db reset` to apply migration `0003_share_links.sql`
4. Start the app: `npm run web`
5. Sign in via Phase 1 flow (magic-link to Mailpit at `http://127.0.0.1:54324`)
6. `npx playwright test e2e/web/phase-4-polish.spec.ts`

## Findings

### Finding 1 — Sentry DSN test coverage gap (not a bug)

- **Location**: `src/lib/__tests__/sentry.test.ts` + `src/lib/sentry.ts`
- **Description**: `babel-preset-expo` (via `babel-plugin-transform-inline-environment-variables`) inlines all `EXPO_PUBLIC_*` env vars at compile time. In the Jest environment, `EXPO_PUBLIC_SENTRY_DSN` is not set when `npm test` runs, so the compiled sentry module always sees `undefined` for the DSN — even if the test mutates `process.env` at runtime. This means the `Sentry.init(...)` branch of `initSentry()` cannot be reached by unit tests without either: (a) setting `EXPO_PUBLIC_SENTRY_DSN` in the shell before running Jest (which would require CI secrets), or (b) refactoring the DSN access into an injectable function.
- **Impact**: The no-DSN path (always in CI) is verified green. The DSN-present path is a trivially readable 3-line code path and will be covered by live smoke when DSN is configured.
- **Target specialist**: `backend-specialist` — if coverage of the DSN-present branch is a requirement, consider extracting `getDsn()` as a function that can be mocked. Otherwise, document the limitation and accept.
- **Suggested fix**: Either (a) accept the gap and add a note to `RUNNING.md` that `EXPO_PUBLIC_SENTRY_DSN=<any>` must be in the shell for full sentry test coverage, or (b) refactor `sentry.ts` to read DSN via a helper function that tests can mock.

### Finding 2 — Pre-existing test failures (not Phase 4 regressions)

The following test failures pre-date Phase 4 and were not introduced by this work:
- `src/components/__tests__/Button.test.tsx` (2 failures) — `getByRole('button', {name:'Go'})` fails while the button is in loading state (ActivityIndicator replaces text). Pre-existing from Phase 3.
- `src/lib/optimizer/__tests__/optimizer.property.test.ts` (1 failure) — anchor-pinning property fails. Pre-existing from Phase 2.
- `tests/rls.test.ts`, `tests/rpc.test.ts` — fail when `SUPABASE_URL` env var absent due to `createClient` call at describe scope. Pre-existing pattern.
- **Target specialist**: `reviewer` to confirm these are pre-existing and route to owning specialist (`ui-specialist` for Button, `backend-specialist` for optimizer).
