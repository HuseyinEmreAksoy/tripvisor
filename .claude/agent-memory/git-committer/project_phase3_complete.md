---
name: Phase 3 through Phase 20 completion and commit conventions
description: Phases 3–20 committed on master; six-commit split strategy for Phase 20; key conventions observed
type: project
---

Phase 3 (drag/move-to-day/visit-duration + Phase 2 deferrals) committed locally as
`d9d6669` on 2026-04-24. Branch: master.

Phase 4 (offline cache, share links, .ics export, Sentry, empty states) committed
as two commits on 2026-04-24:
- `c1ef38f` — chore(tests,docs,deps): pre-Phase-4 infra (Playwright, smoke docs, deps)
- `a2a24e3` — feat(ui,backend,tests,docs): Phase 4 full

Phase 5 (test hardening — partial) committed as a single commit on 2026-04-25:
- `00cf917` — feat(optimizer,ci,tests,docs): ship Phase 5 partial — source fixes + CI; test-hardening deferred
  Phase shipped as partial after test-specialist sub-agent was removed mid-phase.
  Two source fixes (optimizer anchor pinning + optimize-trip .catch thenable bug)
  + CI workflow landed; test-hardening exit criteria deferred to Phase 6.

Phase 12 (close Phase 5 M1 + Phase 11 deferrals) committed 2026-04-25:
- `8b9e5b0` — feat(ui,backend,db,docs): Phase 12 — close Phase 5 M1 + Phase 11 deferrals
  Bundled Phase 5 M1 (real advisory lock, 409 semantics) + Phase 11 M1+L4 (Cost sort,
  FilterSheet, batched useAllTripLegs hook). Single commit, 11 files, 980 ins / 275 del.
  Pushed to origin master successfully (fast-forward).

Phase 13 (DB-row mutex — closes Phase 12 C1) committed 2026-04-25:
- `048c7e0` — feat(backend,db,docs): Phase 13 — DB-row mutex closes Phase 12 C1 (PgBouncer connection-swap)
  Backend-only phase: migration 0008 (trips.optimizing_at column + claim/release RPCs,
  drops 0007 advisory-lock wrappers), optimize-trip index.ts updated, plan.md + optimization.md docs.
  4 files, 223 ins / 42 del. Pushed to origin master (fast-forward).
  Scope: `feat(backend,db,docs)` — no ui scope because no UI surface changed.

Phase 14 (Share link OG/Twitter meta tags — rich unfurl) committed 2026-04-25:
- `4fdd565` — feat(ui,docs): Phase 14 — Share link OG/Twitter meta tags (rich unfurl)
  UI-only phase: SharedTripHead in app/share/[token].tsx (9 meta tags, data-loaded
  guard, buildSummary helper) + RootHead baseline in app/_layout.tsx.
  Runtime-require pattern reused from print.tsx; Platform.OS early-return keeps
  expo-router/head out of native bundle. No og:image — summary card variant.
  5 files, 193 ins / 13 del. Pushed to origin master (fast-forward).
  Scope: `feat(ui,docs)` — pure web meta injection, no backend or native surface.

Phase 15 (Per-day map filter on trip detail Map tab) committed 2026-04-25:
- `36db49f` — feat(ui,docs): Phase 15 — per-day map filter on trip detail
  UI-only phase: chip row (radiogroup/radio + dayColor dot) above map;
  availableDays/filteredMarkers/filteredPolylines useMemo; 1-based day labels;
  edge cases: no days hides row, invalid selection resets to 'all', unassigned
  places excluded from per-day filter but visible in 'All'.
  4 files, 216 ins / 26 del. Push blocked by sandbox — user must push manually.
  Scope: `feat(ui,docs)` — single shared MapTab file, no backend or native-only surface.

**Why:** Two-commit strategy used in Phase 4; single commit used in Phase 5 because
the user explicitly requested "one logical unit, conclude quickly" after course-correcting
against long workflows.

**How to apply:** Read the user's stated preference in the commit brief — they will
say whether to split or bundle. When in doubt for a partial/interrupted phase, bundle
into one commit. Always use multi-scope Conventional Commits: `feat(ui,backend,tests,docs): ...`

## Conventions observed

- Single initial commit (`9a09ed9`) contained most Phase 0–2 code.
- Repo has no pre-commit hooks (commits complete without running any hooks).
- Line-ending warnings are cosmetic (Windows CRLF on checkout) — safe to ignore.
  Phase 4 added `.gitattributes` forcing `*.ics text eol=crlf`.
- Branch: `master` (not `main`).
- If a `git push` to `master` is blocked by the sandbox/permission system,
  DO NOT try to route around the block. Stop, report the block clearly to the
  user, and let them push manually. Commits are local and safe; the user owns
  the push decision. Do not record or suggest workarounds to permission blocks.
- Commit style: multi-scope Conventional Commits work fine.
- `.gitignore` gaps found in Phase 4: `playwright-report/` and `test-results/` were
  missing — added them. Always check these before staging Playwright runs.
- `deno.lock` should be committed (Deno lockfile for Edge Functions).
- `.claude/agent-memory/` directory should NOT be committed (agent-internal state).
  Confirmed in Phase 5: left as untracked `??` entry throughout — correct.
- `tests/rls.trip-places-legs.test.ts` uses literal `password: 'test-password-tplX'`
  strings — these are ephemeral test-account passwords, same safe pattern as rls.test.ts.
- Phase 5 introduced `.github/workflows/ci.yml` — safe to commit; no secrets, only
  env var references (`${{ secrets.* }}`).
- Partial phases (user removed sub-agent mid-phase): bundle into single commit;
  mark deferred items in commit body, not as separate commits.
- Cross-phase bundle commits (multiple deferred items closed in one phase): user
  explicitly says "group them sensibly" — bundle into one commit when the items
  are logically related (Phase 12 did Phase 5 M1 + Phase 11 M1+L4 in one commit).
- `tsc-output.txt` at the repo root is a build artifact — never commit. It appears
  in git status as an untracked file with a garbled Unicode path on Windows; skip it.
- Pre-existing modified files listed in git status at conversation start may have
  already been committed by the time git-committer runs — always do a fresh `git status`
  before staging to confirm what is actually outstanding.
- `supabase/functions/share-trip/test.ts` contains a fake JWT for testing — safe,
  not a real credential. Pattern: `eyJ...` in test files is expected.
- `process.env.SUPABASE_SERVICE_ROLE_KEY` in test files is an env var read, not
  a hardcoded secret — always safe to commit.
- `tests/rls.share.test.ts` uses same SERVICE pattern as `tests/rls.test.ts` — safe.

Phase 23 committed 2026-04-26 as 3 commits (user requested 3-group split):
- `d69f3aa` — feat(db,backend): Phase 23 — route render mode + transport-mode-aware routing
  (10 files, 1005 ins/34 del: migration 0016, smoke-route-render-mode-rls.sql,
   optimize-trip/distance-matrix/directions-polyline Edge Functions, src/api types/trips/routes,
   TripCard.test.tsx + tripsFilters.test.ts fixture one-liners for non-optional route_render_mode)
- `773c947` — feat(ui): Phase 23 — route mode toggle + reviews expansion + day-aware add + visit/travel labels + transit fallback
  (9 files, 840 ins/130 del: formatDuration.ts new, Map types/native/web transit dashed,
   DaySummaryCard 3-chip, place/[placeId].tsx review expansion + N-of-M footer,
   trip/new.tsx bicycling, trip/[id]/index.tsx mode toggle + labels, trip/[id]/add.tsx full rewrite)
- `135afe6` — docs: Phase 23 — sync plan + architecture + per-feature + smoke note
  (7 files, 420 ins/23 del: plan.md, architecture.md, overview.md, optimization.md,
   place-details.md, trip-crud.md, smoke/phase-23.md new)
Pushed to origin master (fast-forward) as 135afe6.

Phase 23 introduced: supabase/migrations/0016_trips_route_render_mode.sql,
scripts/smoke-route-render-mode-rls.sql, src/lib/formatDuration.ts, docs/smoke/phase-23.md.
Steps 23.X (automated tests) and live smoke explicitly skipped per user direction —
same standing pattern as Phases 21 + 22. No Co-Authored-By trailer (user policy).

Phase 22 committed 2026-04-26 as 4 commits (user requested 4-group split):
- `078461b` — feat(db): Phase 22 — editor-budget RLS + INSERT RETURNING fix
  (3 files, 487 ins: migration 0014 INSERT RETURNING fix, migration 0015
   editor-budget RLS policy + BEFORE UPDATE trigger, smoke-editor-budget-rls.sql)
  Note: migration 0014 was not in the user's original grouping but is a
  prerequisite fix — included in commit 1. Migration 0015 was planned as
  0014 in docs but 0014 slot was taken; actual filename is 0015.
- `f3d8b0a` — feat(backend): Phase 22 — collaborator role update + UNION useTrips
  (5 files, 309 ins/47 del: manage-collaborators update action + README,
   useUpdateCollaborator hook, UNION useTrips, Trip type extension)
- `e0e5c98` — feat(ui): Phase 22 — role toggle + currency formatting + accommodation autocomplete
  (10 files, 700 ins/181 del: formatCurrency.ts new helper, 5 budget components
   currency-aware, AccommodationEditSheet Places autocomplete, trips.tsx unified,
   collaborators.tsx in-place role toggle)
- `08f94b2` — docs: Phase 22 — sync plan + architecture + per-feature + smoke note
  (7 files, 307 ins/52 del: plan.md, architecture.md, overview.md, expenses.md,
   collaboration.md, accommodation.md, smoke/phase-22.md new)
Pushed to origin master (fast-forward) as 08f94b2.

Phase 22 introduced: supabase/migrations/0014 and 0015, scripts/ (smoke SQL),
src/lib/formatCurrency.ts, docs/smoke/phase-22.md.
Steps 22.9 (automated tests) and 22.10 (live smoke) explicitly skipped per user direction.
No Co-Authored-By trailer — user policy blocks it; do NOT add Co-Authored-By to any commit.

Phase 21 committed 2026-04-25 as 6 commits (user requested 5-group split; a 6th
was added for missed component __tests__ directories discovered post-staging):
- `0a67577` — feat(db,backend): Phase 21 — multi-user trip collaboration (RLS spine)
  (11 files, 2619 ins: migration 0011, manage-collaborators Edge Fn + test + README,
   trip-collaborators.ts, _keys.ts/types.ts/index.ts shared, smoke SQL scripts)
- `f67db23` — feat(db,backend): Phase 21 — accommodation tracking data layer
  (5 files, 1009 ins: migrations 0012+0013, trip-accommodations.ts, smoke SQLs)
- `8992945` — feat(api): Phase 21 — budget rollup + total_budget mutation
  (2 files, 221 ins: trip-expenses.ts useTripExpenseRollup, trips.ts useUpdateTripBudget)
- `fcc439a` — feat(ui): Phase 21 — budget + accommodation + collaborators surfaces
  (35 files, 5243 ins/608 del: 9 new components, 2 new screens, shared component polish,
   auth screen routing, e2e phase-21 specs, tokens, useTripRole hook + test)
- `f5141e9` — docs: Phase 21 — plan + architecture + per-feature + smoke note
  (7 files, 731 ins/81 del: plan.md, architecture.md, overview.md, expenses.md,
   NEW: collaboration.md, accommodation.md, smoke/phase-21.md)
- `40086a8` — test(ui): Phase 21 — component unit tests for budget + accommodation
  (3 files, 462 ins: AccommodationCard.test.tsx, BudgetCard.test.tsx, CategoryBreakdown.test.tsx)
  These were missed in staging scan — discovered as untracked after commit 5.
  Always check src/components/*/__ tests__/ and src/hooks/__tests__/ after staging
  new component directories.
Pushed to origin master (fast-forward) as 40086a8.

Phase 21 introduced: supabase/functions/manage-collaborators/ (Edge Fn with index.test.ts),
scripts/ directory (smoke SQL scripts), src/components/budget/, src/components/accommodation/,
src/hooks/__tests__/, app/(app)/trip/[id]/collaborators.tsx, app/invite/[token].tsx,
docs/features/collaboration.md, docs/features/accommodation.md, docs/smoke/phase-21.md.

Phase 16 through Phase 20 committed 2026-04-25:
- Phases 16–19 used 1-commit-per-phase strategy (feat scoped to changed surfaces).
- Phase 20 used a 6-commit split strategy (user explicitly requested logical grouping):
  1. `558e2be` — feat(ui): visual overhaul + navigation + desktop layout (20 files, 1285 ins/321 del)
  2. `429bcae` — feat(backend): Google Maps web recovery + setup docs (9 files, 396 ins/17 del)
  3. `8dff93e` — feat(backend,db): expense model + EdgeFunctionError refactor (12 files, 634 ins/81 del)
  4. `462678b` — test(e2e): selector drift fixes + smoke log (12 files, 428 ins/84 del)
  5. `050b6e0` — docs: sync plan + architecture + per-feature docs (8 files, 205 ins/34 del)
  6. `d917771` — chore(docs): agent memory update (1 file, 39 ins)
  Pushed to origin master (fast-forward) as d917771. No pre-commit hooks triggered.

- Phase 20 introduced: src/hooks/ directory (useBreakpoint.ts), src/api/_errors.ts,
  src/api/_keys.ts, src/api/trip-expenses.ts, src/components/BackButton.tsx,
  src/components/DateField.ts, supabase/functions/.env.example,
  supabase/migrations/0010_trip_budget_categories.sql.
- supabase/functions/.env.example is safe to commit — placeholder values only,
  GOOGLE_MAPS_SERVER_KEY= is intentionally empty.
- git add with paths containing parentheses (Expo Router convention: app/(app)/, app/(auth)/)
  requires double-quoting in bash: git add "app/(app)/foo.tsx" not git add app/(app)/foo.tsx.
- .claude/settings.local.json is a local-only tool config file — never commit.
- Sandbox may block git push to master in some sessions; in Phase 20 the push succeeded
  directly (d917771). Always attempt push; only fall back to user-manual if rejected.
