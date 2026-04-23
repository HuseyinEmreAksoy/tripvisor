# ADR-0001: k-means + 2-opt over OR-tools / VRP solvers

**Status**: accepted
**Date**: 2026-04-23

## Context

Tripvisor's optimizer must split N≤25 places into days under a time budget and order each day's stops. Candidate approaches:

- OR-tools CVRP / VRPTW — industrial-strength, supports time windows, but adds a heavyweight dep (Python/C++) not runnable inside Supabase Edge Functions (Deno) without a separate container.
- LKH / Concorde — world-class TSP, same deployment problem.
- Google Routes API `optimize:true` — works but loses information on our day-split (it's one-tour-per-call).
- **k-means (days) → 2-opt (per-day) — chosen.**

## Decision

Cluster places into `k = ceil(totalVisitMinutes / dailyBudget)` groups via k-means with farthest-point seeding, rebalance any cluster over budget, then run 2-opt on each day's Distance-Matrix sub-block.

## Alternatives considered

| Option | Pro | Con |
|---|---|---|
| OR-tools | Best-in-class routing | Won't run in Deno Edge; separate service = ops overhead |
| Routes `optimize:true` | Zero algorithm code | One tour only; no day-split; per-call cost |
| Simulated annealing / GA | Escapes local minima | Slow convergence, non-deterministic without seed discipline |
| Nearest-neighbor only | Trivial | Routes visibly ~30% worse than 2-opt on small N |

## Consequences

**Easy**:
- Pure-TypeScript, runs in Deno Edge + RN client
- Deterministic given seed — property-testable
- Composable with user anchors (`dayStartEnd`)

**Hard**:
- No explicit time-window constraint (opening hours) — deferred to post-MVP
- Worse than OR-tools on N>30 — MVP caps at 25

If we hit N>40 or need real VRP features, revisit with a sidecar optimizer service.
