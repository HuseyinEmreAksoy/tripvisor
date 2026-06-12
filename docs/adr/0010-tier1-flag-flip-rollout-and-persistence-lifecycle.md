# ADR-0010: Tier-1 flag-flip rollout, sign-out persistence, and v1-cache migration

**Status**: accepted (planned in Phase S2.8; user veto window open until implementation starts)
**Date**: 2026-06-12

## Context

S2.8 makes the Legend-State Tier-1 sync store the live data path for `trips` + `trip_places`.
Three lifecycle questions had no decided answer: (1) how the flag flips across three
platforms when native still owes the S1.3 dev-client rebuild + device smoke; (2) what
sign-out does to persisted Tier-1 data, given the beta engine has no detach and clearing
write-enabled observables diffs as mass tombstone-deletes that would sync; (3) how v1
users with TanStack-persisted caches transition without data loss or duplicate rows.

## Decision

1. **Rollout: web-first via env-baked flag; `app_config` reserved as global kill-switch.**
   `EXPO_PUBLIC_SYNC_TIER1=1` is baked into the web export only (web deploys are
   direct-upload artifacts; native builds/OTA never receive the var). The `app_config`
   `sync_tier1` row stays absent in normal operation; writing `'off'` force-disables every
   client including env-baked web (flags.ts: any present value other than `'on'` beats env).
   `'on'` is never written until native clears P4 — the row is platform-global.

2. **Sign-out never clears write-enabled Tier-1 stores.** Privacy boundary = per-user
   persist namespacing (`tier1/<userId>/<table>`) + OS app sandbox / per-origin OPFS.
   Account deletion additionally wipes Tier-1 storage through the persistence layer
   directly (raw deletion, never through the engine, after teardown; best-effort).

3. **v1-cache migration: no migration script.** Repointed read hooks fall back to the
   restored TanStack cache until each Tier-1 root's first hydration completes; the
   persister allowlist goes flag-aware (and degraded-aware — degraded clients keep
   dehydrating trips/trip-places so offline reads never regress below v1); stale persisted
   entries self-clean on the persister's next write cycle. Exactly one source renders at a
   time, so no duplicates and no loss.

## Alternatives considered

- **app_config `'on'` as the flip mechanism** — rejected: the row is platform-global and
  would enable un-smoked native clients in the same instant.
- **clearPersist on sign-out** — rejected: with no engine detach, observable clears diff as
  mass tombstones and sync them = destroying the user's server data. A storage-only clear
  through the beta plugin is unproven; raw wipe is reserved for account deletion where the
  session is ending anyway.
- **One-time cache migration script (TanStack → Tier-1 store)** — rejected: the server is
  the source of truth and hydration rebuilds the store from it; a script adds a write path
  that could fight `created_at`-based create/update discrimination for zero benefit.

## Consequences

- Easy: instant global rollback (`'off'` row, <60s, redeploy-free); native flip later is a
  one-line env addition to the EAS build after P4 smoke; v1 users need no upgrade step.
- Hard: signed-out devices retain the last user's encrypted-at-rest Tier-1 data until that
  user signs back in or the account is deleted (documented, accepted); Safari web stays
  persistence-degraded (no COEP `credentialless` support) and relies on the v1 TanStack
  fallback path indefinitely.
