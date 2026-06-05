# Smoke log — Phase 26

**Phase**: 26 — Verification sweep: test restoration + first live smoke of Phase 21-25 surfaces
**Date**: 2026-06-05
**Status**: PARTIALLY COMPLETE — web smoke green; native (iOS/Android) and remaining feature surfaces still pending
**Tester**: test-specialist
**Build**: `master @ 0452064` (Jest restoration commit) + subsequent local stack run
**Runner**:
- `npm test` (Jest, all suites)
- `npm run test:e2e` (Playwright, Chromium desktop, local stack)
**Stack**: Docker + `supabase start` (local), all 18 migrations applied, 10 Edge Functions served via `npx supabase functions serve`, Expo web on `localhost:8081`

---

## 1. Jest — unit + component tests

**Command**: `npm test`
**Result**: GREEN

| Result | Count |
|---|---|
| Suites passed | 25 |
| Tests passed | 269 |
| Tests failed | 0 |
| Suites skipped (pre-existing, env/infra-gated) | 4 |

**Test restoration work performed (commit 0452064):**
Four component test suites were stale against the Phase 20-25 shipped UI and required updates:

| Suite | Root cause |
|---|---|
| `TripCard.test.tsx` | Component API changed by Phase 25 cover-photo work |
| `BudgetCard.test.tsx` | Component restructured in Phase 21-22 budget UI |
| `CategoryBreakdown.test.tsx` | Category data shape changed in Phase 21-22 |
| `AccommodationCard.test.tsx` | Component updated in Phase 21-22 accommodation tracking |

All four suites updated to match current shipped UI. No feature code was changed. The 4 pre-existing skipped suites are env/infra-gated (RLS, RPC) and unchanged.

---

## 2. Playwright — web E2E (Chromium, desktop)

**Command**: `npm run test:e2e`
**Auth**: Local Supabase running; `auth.setup.ts` produced `e2e/web/.auth/user.json`

### Initial run

5 tests failed on first execution. All 5 were triaged as STALE SPECS — no product bugs found.

The archive mutation was independently verified server-side via a direct DB query confirming the row's `archived_at` column updated correctly. The failure was a spec assertion against a stale UI selector, not a broken feature.

### After spec fixes

| Result | Count |
|---|---|
| Passed | 21 |
| Failed | 0 |
| Skipped (env/seed-gated) | 22 |

All 5 prior failures resolved by fixing stale spec selectors. No feature regressions found.

---

## 3. Golden-path coverage — Phase 21-25 surfaces

This is the FIRST browser smoke session covering surfaces shipped in Phases 21-25. The long-deferred smoke debt from those phases is now partially paid.

### Verified (web golden path green, 2026-06-05)

| Surface | Spec coverage | Result |
|---|---|---|
| Budget golden path (expense entry, category breakdown, total vs. actual) | Playwright | PASS |
| Accommodation golden path (add accommodation, notes, Google Places autocomplete link) | Playwright | PASS |
| Collaboration invite sheet (invite flow, role display) | Playwright | PASS |
| Share links (create, read-only view, revoke) | Playwright (pre-existing + new assertions) | PASS |
| Trips list (search, sort, date filter) | Playwright (pre-existing) | PASS |
| Trip lifecycle — archive and unarchive | Playwright + server-side DB verification | PASS |
| Duplicate place warning in add flow | Playwright (pre-existing) | PASS |
| Optimize error paths (`EdgeFunctionError`, `OptimizeError` surfaces) | Playwright (pre-existing) | PASS |

### Not yet verified — no E2E specs exist

| Surface | Reason |
|---|---|
| Cover photos (`CoverPickerModal`, `PlaceThumbnail`, `TripCard` cover hero) | No Playwright spec written for Phase 25 cover photo surfaces |
| Profile: change email / change password | No Playwright spec for `AuthMutationError` flows |
| Place reactions (thumbs-up/down, `ReactionChip`) | No Playwright spec for Phase 24 reactions |
| Analytics / Insights charts | No Playwright spec for Phase 24 SVG charts |
| Location-aware routing ("Start route from my location") | No Playwright spec for Phase 24 location toggle |

These surfaces remain code-complete but browser-unverified.

---

## 4. Code-completeness audit

| Check | Result |
|---|---|
| TODO/FIXME markers in shipped code | Zero found |
| Placeholder screens | None |
| Deploy script vs. `supabase/functions/` dirs | In sync |
| `useCollaboratedTrips` (deprecated, Phase 25.13 carryover) | Still present — deletion deferred to a future pass |
| `eas.json` preview profile APK flag | Confirmed explicit (`buildType: "apk"`) |

---

## 5. iOS / Android

Deferred to user smoke. No native-only surface introduced in Phase 26. The Phase 21-25 surfaces verified above (budget, accommodation, collaboration, archive, duplicate warning) remain unverified on native.

---

## Summary

| Platform | Status |
|---|---|
| Web | Partially verified — 8 golden paths green; 5 surfaces lack E2E specs |
| iOS | Deferred to user smoke |
| Android | Deferred to user smoke |

## Action required before Phase 26 can close

1. Write Playwright specs for: cover photos, profile email/password change, place reactions, analytics charts, location-aware routing — then re-run to achieve full web coverage.
2. User native smoke on iOS and Android covering the Phase 21-25 surfaces now web-verified.
3. Delete `useCollaboratedTrips` (Phase 25.13 carryover).
4. Tick platform-verified boxes in per-feature docs as each platform is confirmed.
