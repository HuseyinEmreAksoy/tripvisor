# ADR-0005: Offline cache policy

**Status**: Accepted
**Date**: 2026-04-24

## Context

Tripvisor uses TanStack Query with an AsyncStorage persister (native) and localStorage persister (web). Persisting all queries risks:

- Google ToS violations — Place Details and Autocomplete results must not be cached beyond 30 days server-side, but the spirit of the ToS also discourages long-lived client caches of raw Place data.
- Quota exhaustion — 5 MB localStorage on web; AsyncStorage has a similar practical ceiling.
- Stale data shown to traveling users who are offline for extended periods.

## Decision

**`maxAge`**: 7 days on all persisted queries.

**Size cap**: none explicit in v1 — rely on browser/OS quota enforcement. Revisit when telemetry shows quota-exceeded errors.

**Allowlist** (only these keys are dehydrated to storage):

| Query key | Rationale |
|---|---|
| `["trips"]` | Trip list — core offline read |
| `["trips", id]` | Single trip header |
| `["trip-places", id]` | Places on trip — needed offline |
| `["trip-legs", id]` | Leg data — needed offline |

**Never persisted** (blocked at `dehydrateOptions.shouldDehydrateQuery`):

| Query key | Reason |
|---|---|
| `["place-details", ...]` | Google ToS — raw Place Detail data |
| `["places-autocomplete", ...]` | Google ToS — search results |

The allowlist is fail-closed: any new query key is excluded from persistence by default until explicitly added.

## Alternatives considered

| Option | Pro | Con |
|---|---|---|
| Persist everything | Zero config | ToS violation risk; quota exhaustion |
| Persist nothing | Safe | App unusable offline |
| Denylist approach | Less maintenance on new queries | Fail-open — new ToS-sensitive queries silently persisted |
| Allowlist (chosen) | Fail-closed; explicit intent per key | Every new persist-worthy query needs a one-line allowlist addition |

## Consequences

- `shouldDehydrateQuery` in the persister config must check the query key against the allowlist.
- Adding a new query to persistence requires an explicit code change + mention in the PR — acts as a lightweight review gate.
- Tests must assert dehydrated cache contains only allowlisted keys after a normal session.
- If quota-exceeded errors appear in Sentry telemetry, revisit with an LRU eviction or per-query size cap in a follow-up ADR.
