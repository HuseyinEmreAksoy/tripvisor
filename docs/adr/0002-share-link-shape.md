# ADR-0002: Share-link route shape

**Status**: Accepted
**Date**: 2026-04-24

## Context

Phase 4 introduces read-only shared trip views. The URL shape determines RLS complexity, deep-link clarity, and how anonymous sessions are isolated from authenticated ones. Two candidates:

- `/trip/[id]?token=…` — reuses the existing authenticated route, toggling read-only behaviour via query param
- `/share/[token]` — a dedicated standalone route

## Decision

Use `/share/[token]` as the canonical URL shape for shared trip views.

Native deep-link scheme: `tripvisor://share/<token>` maps to the same `app/share/[token].tsx` file via Expo Router's universal linking config.

Web URL: `https://<domain>/share/<token>`

## Alternatives considered

| Option | Pro | Con |
|---|---|---|
| `/trip/[id]?token=…` | Fewer files; reuses existing route | Mixes auth + anon surface; RLS policy must read query params; harder to reason about |
| `/share/[token]` (chosen) | Cleanly isolated RLS; simple token lookup; no auth state leakage | One new route file required |

## Consequences

- A new Expo Router file `app/share/[token].tsx` must be created by ui-specialist.
- The backend share token lookup lives in a dedicated Edge Function (or RLS policy) scoped to the anonymous surface — no overlap with authenticated trip endpoints.
- Native universal linking config in `app.json` must map `tripvisor://share/*` to the new route.
- The authenticated `/trip/[id]` route remains untouched.
