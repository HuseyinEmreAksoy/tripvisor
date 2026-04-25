# Phase 5 — Pre-exit review (scoped: source-code-only changes)

**Date**: 2026-04-25
**Reviewer**: `reviewer` sub-agent (read-only)
**Build**: `master @ a2a24e3` + Phase 5 source-code diff
**Scope**: 3 files only — `src/lib/optimizer/kmeans-2opt.ts`, `supabase/functions/optimize-trip/index.ts`, `.github/workflows/ci.yml`. Test files, jest config, and docs are explicitly **out of scope** per user direction (Phase 5 test-hardening was skipped).

## Summary

- **Optimizer anchor fix**: Correct. The `cluster.includes(anchorPlaceId)` check + the new `pinEnds` call inside the `length<=2` short path together close the duplicate-coords seed regression. The 2-opt anchor-exclusion guard is generalised to handle `pinnedStartPos`/`pinnedEndPos` at any index, which is strictly stronger than the previous "pin at index 0/last" assumption. No perf regression on N=10–25 (two `indexOf` calls per outer pass on arrays ≤25 — negligible).
- **`optimize-trip` thenable fix**: Correct shape — `try/await/catch` replaces a `.catch` chained on a `PostgrestFilterBuilder`. No swallowed errors that matter; advisory-lock failure is intentionally best-effort.
- **`.github/workflows/ci.yml`**: Mostly solid. All actions pinned to major versions (`@v4`, `@v1`), `npm ci` used, no leaked secrets, no Playwright job, Deno set up for Edge tests, npm cache enabled via `setup-node`'s `cache: 'npm'`. Two minor concerns below.

## Critical findings

None.

## High findings

None.

## Medium findings

### M1 — Advisory lock contract is illusory regardless of the `.catch` fix
- **Severity**: medium
- **Category**: correctness (pre-existing, surfaced by this review)
- **Location**: `supabase/functions/optimize-trip/index.ts:115-119`
- **Observation**: Two latent issues survive the fix:
  1. There is no `pg_advisory_xact_lock` RPC wrapper in `supabase/migrations/*.sql`. PostgREST does not auto-expose built-in Postgres functions, so `admin.rpc('pg_advisory_xact_lock', ...)` will 404 on every call and the silent `catch` swallows it. The "advisory lock" is a no-op in production today.
  2. Even if a wrapper RPC existed, `pg_advisory_xact_lock` releases at transaction end. `supabase-js .rpc()` issues a single statement that commits immediately, so the lock would be released before the next `await` — it would never serialise the rest of the handler. The correct primitive is `pg_advisory_lock` (session-scoped) paired with an explicit `pg_advisory_unlock` in a `finally`, or a server-side wrapper that does the whole optimize transactionally.
- **Why it matters**: The header comment promises serialisation it doesn't deliver. Two rapid optimize calls on the same trip can race the `apply_optimization` RPC + `trip_legs` insert and produce mixed-state results.
- **Disposition**: **Parked.** Pre-existing issue, not introduced by Phase 5. Idempotence via `stateHash` is the de-facto guard today. File a follow-up to either install the SQL wrapper + switch to session-scoped `pg_advisory_lock`/`unlock`, or drop the lock claim entirely and update the header comment to match.
- **Owner**: `backend-specialist` (follow-up phase)

### M2 — CI did not reliably discover Edge Function tests via bash glob
- **Severity**: medium
- **Category**: CI correctness
- **Location**: `.github/workflows/ci.yml` (Deno test step)
- **Observation**: `deno test ... supabase/functions/**/test.ts` relied on **shell glob expansion**. GitHub Actions' default shell on `ubuntu-latest` is `bash` with `globstar` **off** by default in non-interactive `run:` blocks. Practical effect: tests in `supabase/functions/<fn>/test.ts` (one level deep) match by accident, but if a sub-folder ever appears the suite silently skips — a green-but-empty CI run.
- **Disposition**: **Fixed.** Switched the step to `deno test ... supabase/functions/` and let Deno walk directories itself.
- **Owner**: main assistant (applied 2026-04-25)

## Low findings

### L1 — `denoland/setup-deno@v1` Deno `v1.x` floats
- **Severity**: low
- **Category**: supply chain
- **Location**: `.github/workflows/ci.yml`
- **Observation**: Action is pinned to `@v1`, which is consistent with all other actions, but `deno-version: v1.x` floats inside Deno's 1.x line. With Deno 2.x out, future major bumps need a deliberate switch.
- **Disposition**: **Parked.** Acceptable for now; revisit when Deno 2.x adoption is decided.

### L2 — Optimizer 2-opt: pin recomputation comment could mislead
- **Severity**: low
- **Category**: docs/comment polish
- **Location**: `src/lib/optimizer/kmeans-2opt.ts` (2-opt outer loop)
- **Observation**: `order.indexOf(opts.startId)` is called once per `while(improved)` pass — correct behaviour, but the comment ("Re-resolve pinned indices against the current order each pass") could mislead a future reader into thinking the index could move during a pass. It can't, because every accepted swap is gated by the exclusion check.
- **Disposition**: **Parked.** Comment-only tweak; non-functional.

### L3 — `pinEnds` order matters when `startId === endId`
- **Severity**: low
- **Category**: correctness (edge case, unreachable today)
- **Location**: `src/lib/optimizer/kmeans-2opt.ts` (`pinEnds`)
- **Observation**: If a future caller ever passes the same id as both `startId` and `endId` (e.g. a round-trip-to-hotel day), `pinEnds` would put it at index 0, then strip it from the array via `filter(id !== endId)`, and append it at the end — netting a single-element array `[id]`. Today no caller does this.
- **Disposition**: **Parked.** Defensive guard worth adding when round-trip-to-anchor is a real feature.

## Sign-off

**SHIP.** The two source-code fixes do exactly what they claim — the optimizer anchor invariant now holds for degenerate inputs (closes property-test counterexample seed `-216821245`), and the `optimize-trip` handler no longer relies on a `.catch` method that the thenable doesn't expose. M2 is fixed; M1 + lows are parked as follow-ups. No critical or high findings.

## Files referenced

- `src/lib/optimizer/kmeans-2opt.ts`
- `supabase/functions/optimize-trip/index.ts`
- `.github/workflows/ci.yml`
- `docs/adr/0001-kmeans-2opt-over-or-tools.md` (cross-ref)
- `supabase/migrations/0002_rpcs.sql` (cross-ref — confirmed no `pg_advisory_xact_lock` wrapper)
- `docs/reviews/phase-4.md` (format reference)
