---
name: Phase 3 and Phase 4 completion and commit conventions
description: Phase 3 committed d9d6669; Phase 4 committed c1ef38f + a2a24e3 on 2026-04-24; repo conventions
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
