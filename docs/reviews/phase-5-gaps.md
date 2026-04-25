# Phase 5 — Coverage gap analysis

**Date**: 2026-04-24
**Baseline**: master @ `a2a24e3` (post-Phase-4)
**Reviewer role**: main assistant acting as `reviewer` (read-only)
**Coverage tools run**:
- `npx jest --coverage --coverageReporters=text --coverageReporters=json-summary` — completed; `coverage/coverage-summary.json` captured
- `deno test --coverage=cov_profile` — not run (Deno CLI absent in reviewer shell); Deno numbers below are inferred from reading each `test.ts` and marked accordingly

---

## Coverage snapshot

### Jest (client + lib) — from `coverage/coverage-summary.json`

| Scope | Lines | Branches | Functions | Target (plan.md 673) | Gap vs target |
|---|---:|---:|---:|---:|---|
| Aggregate (files Jest sees) | 87.65% | 73.86% | 81.14% | — | — |
| `src/lib/optimizer/kmeans-2opt.ts` | 100% | 91.39% | 100% | ≥80% | clear (8 uncovered branches acceptable) |
| `src/lib/ics/generate.ts` | 96.62% | 74.00% | 86.66% | ≥80% | lines clear; **13 uncovered branches** (folding/escaping edges) |
| `src/lib/categoryDurations.ts` | 100% | 100% | 100% | ≥80% | clear |
| `src/lib/sentry.ts` | 71.42% | **16.66%** | 100% | ≥80% | DSN-present branch unreachable (Babel inlining; Phase 4 Problem 11 accepted) |
| `src/lib/clipboard*.ts` | not in summary | — | — | ≥80% | **no tests; effectively 0%** across all three splits |
| `src/api` aggregate (only `offline.web.ts` shows) | n/a | n/a | n/a | ≥60% | **major gap** — `auth`, `trips`, `trip-places`, `places`, `routes`, `share`, `ics.*`, `offline.native`, `offline.ts`, `supabase` absent from summary |
| `src/api/offline.web.ts` | 21.05% | 33.33% | 12.5% | ≥60% | only `shouldDehydrateQuery` exercised; `useIsOnline` / `isOnline` uncovered |
| `src/api/offline.native.ts` | not in summary | — | — | ≥60% | **0%** — tests import `offline.web` explicitly |
| `src/api/ics.*.ts` | not in summary | — | — | ≥60% | **0%** — hook-level orchestration uncovered |
| `src/api/share.ts` | not in summary | — | — | ≥60% | **0%** — hooks only via Playwright (which currently skips) |
| `src/components/Map/Map.web.tsx` | 45.16% | 50.00% | 25.00% | — | fallback branch covered; authed map path uncovered (needs shim) |
| `src/components/ShareLinkCard.tsx` | 72.00% | 56.25% | 66.66% | — | deep-link warning + error states uncovered |
| `src/components/VisitDurationStepper.tsx` | 68.00% | 50.00% | 75.00% | — | keyboard web path + native `onLongPress` uncovered |
| `src/components/EmptyState.tsx` | 72.72% | 68.18% | 100% | — | focus-on-mount `activeElement` guard uncovered (added in Phase 4 fix) |
| `app/(app)/trip/[id]/index.tsx` | not in summary | — | — | — | **0%** — relies on Playwright which skips without env |
| `app/share/[token].tsx` | not in summary | — | — | — | **0%** — ditto |

**Likely under-counted** (jest-expo resolves `.web` in jsdom, so `.native.*` counterparts never load): `offline.native`, `clipboard.native`, `ics.native`, `BottomSheet.native`, `DraggableItinerary.native`, `Slider.native`, `DateField.native`, `Map.native`. True coverage requires a second Jest run with a `.native` preset — Phase 5.5 consideration.

### Deno (Edge Functions) — inferred from reading `test.ts`

| Function | Ping | Zod-400 | Upstream 5xx→502 | CORS deny | FieldMask asserted | Timeout→504 | Est. lines % |
|---|---|---|---|---|---|---|---|
| `places-autocomplete` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ~75% |
| `place-details` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ~65% |
| `distance-matrix` | ✅ | ✅ | ❌ | ❌ | ✅ partial | ❌ | ~60% |
| `directions-polyline` | ✅ | ✅ | ❌ | ❌ | ✅ partial | ❌ | ~65% |
| `optimize-trip` | ❌ | ❌ | ❌ | ❌ | n/a | ❌ | **0% — no `test.ts`** |
| `share-trip` | ✅ | ✅ | n/a | ❌ (setup sets `ALLOWED_ORIGINS='*'`) | n/a | ❌ | ~70% |

---

## Gaps by Phase 5 step

### Step 5.1 — Optimizer property-test expansion (owner: test-specialist + backend-specialist)

Current: `src/lib/optimizer/__tests__/optimizer.property.test.ts` — 5 properties, numRuns 20–40.

1. **🔴 Anchor invariant is broken, not just untested.** `npx jest` surfaces a real counterexample at `optimizer.property.test.ts:76`, seed `-216821245`, shrunk to 7 places all at `lat=0,lng=0` except one at `lat=-1.8e-160`. When k-means produces one cluster, the 2-opt step reorders the day and pushes the anchor off position 0. **Route to `backend-specialist`** to decide: (a) re-pin anchor after 2-opt, or (b) exclude the anchor from 2-opt. Fix the optimizer; then re-enable the property. Treating this as test-only debt is wrong.
2. Duplicate coordinates not covered (arbitrary uses `fc.double` over 120°).
3. All-same-coordinate degenerate case — zero coverage (plan.md:675).
4. Anchor at middle / last positions — only index 0 tested.
5. Permutation-invariance via canonicalization (shuffle→optimize→canonicalize→equal) — only idempotence covered.
6. `visitMinutes` extremes (0 and 720) — current arbitrary caps at 180.
7. `dayStartEnd` constraint — single unit test; no property.
8. `legs`-preferred-over-haversine — single unit test; no property.
9. `numRuns` budget — currently ~130 total; raise to 100 CI / 500 local via `FC_NUM_RUNS` env.

### Step 5.2 — Edge Function Deno gaps (owner: test-specialist)

| Function | Zod-400 | 5xx→502 | CORS deny | FieldMask full | Timeout→504 | ?ping |
|---|---|---|---|---|---|---|
| `places-autocomplete` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `place-details` | ✅ | ❌ | ❌ | ✅ partial | ❌ | ✅ |
| `distance-matrix` | ✅ | ❌ | ❌ | ✅ partial | ❌ | ✅ |
| `directions-polyline` | ✅ | ❌ | ❌ | ✅ partial | ❌ | ✅ |
| `optimize-trip` | ❌ | ❌ | ❌ | n/a | ❌ | ❌ |
| `share-trip` | ✅ | n/a | ❌ | n/a | ❌ | ✅ |

Concrete gaps (each line-citable):
1. **🔴 `optimize-trip` has zero Deno tests** across 352 lines of orchestrator logic (advisory lock, admin writes, `LEG_TTL_MS` enforcement at `index.ts:36, 149`, `>25 places` cap, matrix/polyline fan-out). Regressions silently burn Routes API budget or stale Google data.
2. **🔴 CORS deny branch untested on every function.** `_shared/cors.ts:15-17` fail-closed default was the Phase 1 Problem 1 fix — no regression test. One edit could re-open it.
3. Upstream timeout→504 untested everywhere. Mock `fetch = () => new Promise(() => {})` + fake timers.
4. `place-details` / `distance-matrix` / `directions-polyline` each missing the 5xx→502 test that `places-autocomplete` has (2-line additions).
5. Full-mask assertions: tighten to exact-equality or "must NOT include" forbidden values (`primaryTypeDisplayName`, `editorialSummary`) to catch over-broad masks.
6. `share-trip` revoke-then-create idempotence untested.
7. `share-trip` non-owner cannot revoke via Edge Function (only DB-layer tested).

### Step 5.3 — RLS integration gaps (owner: test-specialist)

| Table | SELECT isolation | UPDATE isolation | DELETE isolation | Anon denied |
|---|---|---|---|---|
| `trips` | ✅ | ✅ | ✅ | ❌ |
| `trip_places` | ❌ (only INSERT-spoof) | ❌ | ❌ | ❌ |
| `trip_legs` | ❌ | ❌ | ❌ | ❌ |
| `trip_shares` | ✅ | ✅ | ✅ | ✅ |

1. **🔴 `trip_legs` has zero RLS coverage** — stores `polyline`, `duration_seconds`, `distance_meters` subject to the 30-day ceiling. RLS is the other half of the Phase 4 Problem 1 story.
2. `trip_places` SELECT/UPDATE/DELETE untested (only INSERT-spoofing covered).
3. Anonymous access denied for `trips` + `trip_places` — not asserted (only for `trip_shares`).

### Step 5.4 — Playwright happy + unhappy paths (owner: test-specialist)

| Scenario | Covered? | Notes |
|---|---|---|
| signup happy (magic-link) | ✅ partial | can't complete round-trip in CI |
| signup unhappy | ✅ | button disabled on empty |
| create-trip happy | ✅ | `phase-2-optimize.spec.ts:20-38` |
| create-trip validation errors | ❌ | |
| add-place happy | ❌ | autocomplete+details never driven |
| add-place network error | ❌ | no `page.route()` mock |
| optimize happy | ❌ | |
| optimize upstream 502 | ❌ | |
| manual-edit reorder | ❌ | |
| manual-edit move-to-day | ❌ | |
| manual-edit duration | ❌ | |
| manual-edit delete | ❌ | |
| share-link create | ✅ | Phase 4 fix |
| share-link open anon | ✅ | |
| share-link revoke | ✅ | |
| share-link 404 | ❌ | direct `/share/made-up-token` not tested as its own case |
| `.ics` download | ✅ | |
| offline reload | ✅ | |

Operational gaps:
1. **🔴 Jest runs Playwright specs and fails 4 suites on every `npm test`.** Fix via `jest.config` `testPathIgnorePatterns: ['<rootDir>/e2e/']`. Masks real Jest failures; blocks Step 5.5 thresholds.
2. Authenticated Playwright fixture (`e2e/web/helpers/seed.ts` + `storageState`) never landed — every Phase 2+3 spec skips on CI.
3. No `page.route()` mocks anywhere — all unhappy paths in plan.md:674 require it.
4. `phase-4-polish.spec.ts` Check 1 uses `page.getByRole('summary')` (line 65, 106) — verify RN Web actually renders `role="summary"` to DOM; otherwise another silent skip.

---

## Recommendations (prioritized — risk × blast-radius, top 20)

| # | Severity | Gap | Owner | Effort |
|---|---|---|---|---|
| 1 | **critical** | Anchor-pinning property test fails with a real counterexample (duplicate coords) — optimizer bug, not test debt | backend-specialist (fix) + test-specialist (re-enable) | M |
| 2 | **critical** | `optimize-trip` Edge Function has no Deno test (352 lines, ToS leg-TTL, Routes API budget) | test-specialist | L |
| 3 | **high** | Jest runs Playwright `.spec.ts` files → 4 suites fail on every `npm test` | test-specialist | S |
| 4 | **high** | `trip_legs` has zero RLS tests — Google-derived, 30-day ToS ceiling | test-specialist | M |
| 5 | **high** | `trip_places` SELECT/UPDATE/DELETE isolation untested | test-specialist | S |
| 6 | **high** | No Playwright `page.route()` mocks — all unhappy paths absent | test-specialist | L |
| 7 | **high** | Auth'd Playwright fixture + storageState never landed — Phase 2+3 specs skip | test-specialist | M |
| 8 | **high** | CORS-deny branch untested on every Edge Function — Phase 1 Problem 1 regression risk | test-specialist | S |
| 9 | medium | Upstream timeout→504 untested everywhere | test-specialist | M |
| 10 | medium | `src/api/ics.*.ts` hook orchestration 0% — Phase 4 Problem 7 throw not asserted | test-specialist | M |
| 11 | medium | `src/api/share.ts` hooks untested in Jest (only Playwright which skips) | test-specialist | M |
| 12 | medium | `place-details` / `distance-matrix` / `directions-polyline` missing 5xx→502 tests | test-specialist | S |
| 13 | medium | Permutation-invariance + all-same-coord properties missing | test-specialist | M |
| 14 | medium | Anon denied for `trips` + `trip_places` not asserted | test-specialist | S |
| 15 | medium | `Map.web.tsx` authed path — 25% function coverage; Phase 2 Problem 2 regression risk | test-specialist | M |
| 16 | medium | `VisitDurationStepper` keyboard + `onLongPress` branches uncovered | test-specialist | S |
| 17 | low | `place-details` mask substring-based — won't catch over-broad additions | test-specialist | S |
| 18 | low | `share-trip` revoke-then-create idempotence untested | test-specialist | S |
| 19 | low | `.ics` folding + TZ-fallback branches — 13 uncovered in `generate.ts` | test-specialist | S |
| 20 | low | `Button` busy-state test fails on master (pre-existing Phase 3 debt) | ui-specialist | S |

---

## Out of scope for Phase 5

- Pre-existing Phase-3 implicit-`any` debt in `app/(app)/trip/[id]/index.tsx` (Phase 4 Problem 10 parked)
- Bundle-size follow-up (Phase 4 Problem 14) — needs exact Phase-3 gz baseline
- Native device smokes (user-driven)
- Sentry DSN-present branch coverage (Phase 4 Problem 11 accepted; documented workaround)
- Coverage-thresholds enforcement (Step 5.5) — depends on 5.1–5.4 landing

---

## Ordering shift recommended

Before Step 5.1, insert **Step 5.0b: pre-work fixes** (two micro-fixes in parallel):
- `backend-specialist`: fix optimizer anchor re-pin after 2-opt (or exclude anchor from 2-opt)
- `test-specialist`: add `testPathIgnorePatterns: ['<rootDir>/e2e/']` to `jest.config.js`

Then 5.1 onward proceeds as planned. Consider merging 5.2 `optimize-trip` test work with 5.4 seed helper (both need the same Supabase service-role client pattern).

---

## Summary

- **20 prioritized gaps**: 2 critical, 6 high, 8 medium, 4 low
- **Top 3 risks**: (1) optimizer anchor bug (real, caught by existing test); (2) `optimize-trip` untested; (3) Jest running Playwright specs, masking failures
- **Largest backlog**: Step 5.4 Playwright (11/18 scenarios uncovered) — then Step 5.2 Edge Function gaps (18 holes across 6 functions)
