---
name: v2-commit-log
description: v2-era commit records starting at v2 Phase 0 checkpoint (2026-06-09) — SHAs, split rationale, push policy, leftover artifacts to gitignore
metadata:
  type: project
---

# Tripvisor v2 — git-committer commit log

v1 records (Phases 3-26) live in [[phase3-through-phase26-commits]]
(project_phase3_complete.md). This file starts the v2 era.

## Standing policies confirmed at v2 Phase 0 (2026-06-09)

- **No Co-Authored-By trailer** on any commit — explicit user policy, reaffirmed.
- Fast-forward pushes to `master` by git-committer are **pre-authorized** per
  CLAUDE.md Don'ts section; only force-push needs confirmation. Push went
  through directly with no sandbox block this session.
- test-specialist sub-agent is disabled via rename to
  `.claude/agents/test-specialist.md.disabled` (token-saving, reversible).
  Active agents all run `model: fable`.

## v2 Phase 0 checkpoint committed + pushed 2026-06-09 (3 commits)

- `714eea8` — chore(agents): swap opus/sonnet -> fable; disable test-specialist
  (7 files: 5 agent defs model swap, test-specialist.md -> .disabled rename
   detected at 99% similarity, + agent-memory Phase 25/26 record)
- `5411607` — refactor(ui,api): retire cost_per_km for time-first + category model
  (12 files, 137 ins/253 del: src/api/{types,trips,routes,_keys}.ts,
   src/lib/tripsFilters.ts + test, DaySummaryCard, TripCostRollup,
   trip/[id]/index + print, trips.tsx, TripCard.test.
   trips.cost_per_km DB column drop deferred to v2 Phase 15.1 — client-only change.)
- `a990187` — docs(v2): add v2 blueprint + build log; env v2 vars
  (9 files, 757 ins: docs/v2/ 7 files, plan-v2.md, .env.example v2 vars —
   MapLibre/OpenFreeMap, Gemini/Groq, OSRM/ORS, PostHog placeholders, no values)
- Pushed origin/master fast-forward 61ff74d..a990187.

## v2.1 Fable plan revision checkpoint committed + pushed 2026-06-10 (2 commits)

- `0eb41d6` — chore(agents): planner inherit -> fable (1 line; planner was the
  one agent 714eea8 missed)
- `e9e0715` — docs(v2): Fable panel revision — resequenced plan v2.1 + UX principles
  (9 files, 330 ins/191 del: plan-v2.md v2.1 rewrite with N/S/P tracks + WEB BETA
   milestone; NEW docs/v2/ux-principles.md (user-first core loop, load-bearing);
   BUILD-LOG tracks + debt register; features Core-loop L1-L4; architecture C1
   manual_rank + trip_place_comments/app_config; risks D6 -> GitHub Actions pinger;
   conventions CI posture; migration + tech-stack wording)
- Pushed origin/master fast-forward a990187..e9e0715. Standing push authorization
  applied directly — no confirmation needed, no sandbox block.
- Revision authored by a 5-lens Fable review panel (product/UX, architecture,
  sequencing, feature-gaps, debt) + synthesis; supersedes the 2026-06-09 16-phase
  plan. v2 plan-doc churn arrives as one bundled docs(v2) commit + a tiny
  chore(agents) sidecar when agent defs move — reuse this split.

## Leftover artifacts to .gitignore (still untracked as of 2026-06-10)

Repeatedly excluded by hand; suggest adding to .gitignore:
`jest-fresh.txt`, `e2e-fresh.txt`, `e2e-final.txt`, `tsc-fresh.txt`,
the malformed `C…UsershemreDesktopTripvisortsc-output.txt` (delete it),
`.claude/scheduled_tasks.lock`, `.claude/settings.local.json`.

## v2 commit conventions

- v2 docs live in `docs/v2/`; v2 plan is root `plan-v2.md`. Scope `docs(v2)`
  for blueprint-level docs work.
- Quote `app/(app)/...` and `[id]` paths in bash `git add` (parens/brackets).
- CRLF warnings on add are normal on this Windows checkout — not an error.
