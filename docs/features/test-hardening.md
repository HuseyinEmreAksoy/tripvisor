# test-hardening

**Status**: 🚧 Partial — source-code bug fixes + CI workflow shipped 2026-04-25; test-hardening exit criteria (coverage expansion, property tests, E2E suite, RLS expansion) deferred per user direction (test-specialist sub-agent removed mid-phase).
**Owner agents**: backend-specialist (CI), reviewer (gap analysis)
**Depends on**: All Phase 1–4 features (tests cover the full stack)
**Review**: `docs/reviews/phase-5.md`
**Gap analysis**: `docs/reviews/phase-5-gaps.md`

## Platforms verified

N/A — test infrastructure, not a user-facing feature. No platform smoke-test required.

## What shipped

**Source-code fixes (reviewed + signed off — see `docs/reviews/phase-5.md`):**

1. Optimizer anchor pinning fix in `src/lib/optimizer/kmeans-2opt.ts`. Closes a real correctness bug discovered via a property-test counterexample (seed `-216821245`, 7 places at lat=lng=0). The `cluster.includes(anchorPlaceId)` guard and updated `pinEnds` call inside the `length<=2` short path together ensure the anchor invariant holds under duplicate coordinates.

2. Latent `.catch`-on-thenable bug fix in `supabase/functions/optimize-trip/index.ts`. The advisory-lock attempt used `.catch` on a `PostgrestFilterBuilder` which does not expose that method as a plain function — this would have caused a crash in production. Replaced with `try/await/catch`.

3. CI workflow `.github/workflows/ci.yml` — runs on PR open/update and push to master. Steps: `npm ci`, `npm run lint`, `npm test -- --coverage`, Deno tests for Edge Functions. Playwright is not run in CI (deferred to Phase 6). The Deno step passes `supabase/functions/` as a directory (not a glob) to avoid a bash `globstar`-off silent-skip bug found during review (M2 in `docs/reviews/phase-5.md`).

**Test files authored but uncertified (test-specialist not engaged for review):**

- `src/lib/optimizer/__tests__/property.test.ts` — new fast-check property suite
- `supabase/functions/optimize-trip/test.ts` — new Deno suite for optimize-trip handler
- Expanded Deno tests across `places-autocomplete`, `place-details`, `distance-matrix`, `directions-polyline`, `share-trip`
- `tests/rls.trip-places-legs.test.ts` — two-user isolation matrix for `trip_places` and `trip_legs`
- `e2e/web/phase-5-happy.spec.ts`, `e2e/web/phase-5-unhappy.spec.ts`, `e2e/web/helpers/` — Playwright happy + unhappy path suites (21 tests skipped in smoke; no live Supabase available during the run)
- `jest.config.js` updated: `testPathIgnorePatterns` for e2e, coverage thresholds, coverage reporters
- `package.json`: `test:coverage` script added

## What runs in CI today

CI workflow: `.github/workflows/ci.yml`

| Step | Tool | Notes |
|---|---|---|
| Lint | `npm run lint` | TypeScript typecheck (soft — exits 0 on type errors by default unless tsconfig `noEmit` is strict) |
| Jest | `npm test -- --coverage` | All tests under `src/` and `tests/`; e2e excluded via `testPathIgnorePatterns` |
| Deno | `deno test supabase/functions/` | All `test.ts` files under Edge Functions directory; no live Supabase or Google API needed |

Playwright is NOT run in CI. It requires a live Supabase + Expo dev server. Deferred to Phase 6.

## Test layout

```
src/lib/optimizer/__tests__/   — Jest unit + property tests for the optimizer
  optimizer.unit.test.ts       — determinism, anchor pinning, day splitting
  optimizer.property.test.ts   — fast-check property tests (pre-existing)
  property.test.ts             — Phase 5 property expansion (uncertified)

tests/
  rls.test.ts                  — RLS integration tests (require local Supabase)
  rls.trip-places-legs.test.ts — Phase 5 two-user matrix (uncertified)

supabase/functions/*/test.ts   — Deno unit tests per Edge Function

e2e/web/
  phase-4-polish.spec.ts       — Phase 4 Playwright suite
  phase-5-happy.spec.ts        — Phase 5 happy paths (uncertified)
  phase-5-unhappy.spec.ts      — Phase 5 unhappy paths (uncertified)
  helpers/                     — seed helpers and fixtures
```

## Coverage thresholds

Set in `jest.config.js`. These are aspirational — they were placed before the deferred property/API-layer work landed, so they may not be hit until that work completes.

| Scope | Threshold (lines) | Notes |
|---|---|---|
| `global` | 50% | Minimum floor |
| `src/lib/**` | 80% | Optimizer + utility code |
| `src/api/**` | 15% | Low intentionally — most API hooks depend on Supabase + TanStack Query and are invisible to jsdom. Raise after proper API-layer unit tests land. |

Coverage reporters: `text`, `html` (under `coverage/`), `json-summary`.

Native variant files (`.native.*`) and `src/lib/sentry.ts` are excluded from coverage paths — see `jest.config.js` comments.

## How to run locally

```bash
# Jest (unit + integration, no Supabase needed)
npm test

# Jest with coverage report
npm run test:coverage

# Deno Edge Function tests (no live Supabase needed)
deno test supabase/functions/

# RLS integration tests (requires local Supabase running)
npx supabase start
npm test -- tests/rls

# Playwright E2E (requires local Supabase + Expo web running)
npx supabase start
npm run web &
npm run test:e2e
```

## Open follow-ups (deferred steps)

These steps were planned for Phase 5 but not completed. Cross-reference `docs/reviews/phase-5-gaps.md` for the gap analysis that motivated each.

- **Step 5.0** — Run a fresh coverage report and produce an updated gap list. The existing `docs/reviews/phase-5-gaps.md` is a starting point but was not validated against the Phase 5 test files.
- **Step 5.1** — Review and certify `src/lib/optimizer/__tests__/property.test.ts`. Verify `numRuns` is tuned for CI time (target: < 30 s on a GitHub Actions runner).
- **Step 5.2** — Review and certify the expanded Deno Edge Function test files. Confirm each function achieves Zod rejection, upstream-502, CORS-deny, and `?ping` coverage.
- **Step 5.3** — Review and certify `tests/rls.trip-places-legs.test.ts` against a live local Supabase stack. Confirm UPDATE + DELETE isolation probed per table.
- **Step 5.4** — Validate `e2e/web/phase-5-happy.spec.ts` and `phase-5-unhappy.spec.ts` against a live stack. All 21 tests were skipped in the Phase 5 smoke run.
- **Step 5.5** — Confirm coverage thresholds are actually met with the Phase 5 test files in place (`npm run test:coverage` must exit 0). Tune thresholds if needed.
- **Step 5.7** — Push to GitHub, open a throwaway PR, observe a live CI run, and record the result in `docs/smoke/phase-5.md`. The CI workflow exists but has never run against the remote repo.

The advisory-lock correctness issue (M1 in `docs/reviews/phase-5.md`) is also a known open item for `backend-specialist` in a future phase.
