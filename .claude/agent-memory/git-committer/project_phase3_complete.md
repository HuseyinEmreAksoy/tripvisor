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
- `supabase/functions/share-trip/test.ts` contains a fake JWT for testing — safe,
  not a real credential. Pattern: `eyJ...` in test files is expected.
- `process.env.SUPABASE_SERVICE_ROLE_KEY` in test files is an env var read, not
  a hardcoded secret — always safe to commit.
- `tests/rls.share.test.ts` uses same SERVICE pattern as `tests/rls.test.ts` — safe.
