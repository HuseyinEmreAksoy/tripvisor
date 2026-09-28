---
name: git-committer-policies
description: Durable Tripvisor commit/push policies and repo quirks (condensed 2026-09-28 from the v1+v2 commit logs; old per-commit logs live in git history)
metadata:
  type: feedback
---

- **No Co-Authored-By trailer.** This is explicit user policy, reaffirmed many times. Only add it when a brief explicitly asks.
- **Fast-forward push to `origin/master` is pre-authorized.** Only force or non-ff pushes need confirmation. If the sandbox blocks a push, report it; the user pushes manually.
- **Commit via Bash heredoc (`git commit -F -`).** PowerShell 5.1 writes a BOM and mangles `$`.
- **Quote `app/(app)/…` and `app/(auth)/…` paths** in bash.
- **Multi-scope Conventional Commits are the norm** (`feat(ui,backend,docs): …`). One wave = one commit unless the concerns are clearly separate.
- **The user sometimes wants `docs/v2/BUILD-LOG.md` left unstaged** for a wave. Follow the brief.
- **Never commit:** `.claude/settings.local.json`, `.claude/scheduled_tasks.lock`, `tsc-output.txt`, `*-fresh.txt`, `e2e-final.txt`, `*.log`, `playwright-report/`, `test-results/`, `dist/`, `coverage/`.
- **Re-check `git status` fresh.** Parts of a wave may already be committed. Tests live in `src/**/__tests__/`, so check that they're staged with their feature.
- **The web app is live at tripvisor.pages.dev** (Cloudflare Pages).

**Why:** These came up repeatedly across v1 Phases 3–26 and v2 0 → S2.8.12. The full SHA logs were pruned because `git log` is authoritative. Those logs are recoverable from git history at commit b469abd.
**How to apply:** Check this list before every commit and push.
