# ADR-0007: Cost rollup is computed client-side from cached trip_legs

**Status**: Accepted
**Date**: 2026-04-25

## Context

Phase 8 ships a per-trip cost estimate (km × $/km) and per-day cost breakdown. The needed inputs already live in the schema: `trip_legs.distance_meters` (written during Phase 2 optimize), and a new `trips.cost_per_km` + `trips.currency` (added in Step 8.2). We need to decide where the rollup math runs.

## Decision

1. Compute cost in the React UI: `legs.reduce((s, l) => s + l.distance_meters, 0) / 1000 * trip.cost_per_km`.
2. Format with `Intl.NumberFormat(undefined, { style: 'currency', currency: trip.currency })`.
3. Memoize per `legs` + `cost_per_km` + `currency` to avoid recomputation on unrelated re-renders.
4. Cost is **never persisted** — always derived. Duplicate-trip flows automatically get correct costs once the optimizer runs.
5. Per-day rollups follow the same shape, scoped by `day_index`.

## Alternatives considered

- *Postgres view that pre-aggregates per trip.* Rejected — extra DB surface for a one-line client computation; doesn't help offline (we already cache `trip_legs` locally); forces RLS join validation.
- *Generated column on `trip_legs` (`cost`).* Rejected — would force currency to live on `trip_legs` rows or duplicate the rate per leg; rate change would force a backfill; locks us in.
- *Nightly batch.* Rejected — pointless for a derived value the UI already has the inputs for.
- *Server-side function returning the rollup.* Rejected — round-trip latency for a microsecond computation; needs RLS-aware SQL.

## Consequences

- Pros: trivial code, zero DB load, recomputes instantly when user changes the rate, works offline (legs are already in TanStack Query cache + AsyncStorage persister), correct after duplicate without backfill.
- Cons: client-only; if the UI ever needs server-side cost (e.g. an email digest), that surface needs its own derivation. Trip-level currency only — multi-currency per-leg parked.
- Currency check constraint at the DB level (`USD/EUR/GBP/TRY/JPY` in Step 8.2) keeps the literal union in TypeScript bounded; widening requires a migration and a type update together.
