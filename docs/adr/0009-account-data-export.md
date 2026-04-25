# ADR-0009: Account data export — single Edge Function returning flat JSON

**Status**: Accepted
**Date**: 2026-04-25

## Context

Phase 7 shipped account deletion. Phase 10 adds the privacy mirror: a one-click "Export my data" download. We need a delivery shape that's safe (no service-role leak, no cross-user reads), portable (machine-readable, not spreadsheet-locked), and reuses what we already trust.

## Decision

1. Single Edge Function at `supabase/functions/export-account/index.ts`. Modeled exactly on `delete-account/index.ts`: anon-client `auth.getUser(token)` to verify the bearer JWT, then `makeAdminClient` (service role) to read by `user_id`. Same `_shared/{cors,errors,logger,supabase-admin}.ts` helpers.
2. Response shape: `{ ok: true, export: { user_id: Uuid, exported_at: ISO8601, trips: Trip[], trip_places: TripPlace[], trip_legs: TripLeg[], trip_days: TripDay[] } }`. Flat, no nesting per-trip — clients can re-aggregate by `trip_id`.
3. Read order — `trips` first (filter `user_id = user.id`), then child tables (`trip_places`, `trip_legs`, `trip_days`) filtered by `trip_id in (<trip ids from step 1>)`. This forces all reads through the JWT-derived user; a malformed or attacker-controlled query cannot leak across users.
4. Deterministic ordering — every read uses `order('id', { ascending: true })` so consecutive exports for the same user produce byte-identical files.
5. Client download mechanic reuses Phase 4's `.ics` flow: web does Blob+anchor with Safari `setTimeout(URL.revokeObjectURL, 1000)`; native does `expo-file-system` write to cache + `expo-sharing.shareAsync` with `mimeType: 'application/json'`.
6. Filename: `tripvisor-export-<YYYY-MM-DD>.json` with UTC date.

## Alternatives considered

- *Per-table CSV files in a zip.* Rejected — needs a zip lib in Deno; users want round-trippable JSON, not spreadsheet rows.
- *Postgres `setof json` RPC called from the client (RLS-via-anon-JWT).* Rejected — works but doesn't centralize the shape behind one auditable surface; harder to evolve.
- *Streaming `text/event-stream` response.* Rejected — overkill for the data volume; complicates client download UX.
- *Generated download link with signed Storage URL.* Rejected — introduces Storage bucket dependency Phase 10 deliberately avoids.

## Consequences

- Pros: trivial server logic; reuses two proven patterns (`delete-account` JWT model + `ics` download mechanic); zero new deps; future-extensible (add a top-level `version: 1` if shape evolution is needed).
- Cons: entire export is materialized in Edge Function memory and on the client at once. Acceptable: a heavy user has <100 trips × <1KB each, well under the Edge Function 256MB ceiling. If anyone hits this, streaming is a follow-up phase.
- Notes attachments / photos / Storage media are out of scope — they'd need a different streaming pattern.
