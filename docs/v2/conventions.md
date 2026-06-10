# Tripvisor v2 — Code & Directory Conventions

> **Status:** v2 (2026-06-09). The structural rules the rewrite follows. Extends, not replaces, `CLAUDE.md`.

## Directory layout (target)

```
app/                      Expo Router screens (route segments, NOT god-screens)
  (auth)/                 login, signup
  (app)/                  authed surfaces
    index.tsx             Home / Discover (hosts "Plan my trip")
    trips.tsx             trips list
    trip/[id]/            trip detail — SPLIT into segments (see below)
      index.tsx           thin shell + layout (was 2442 lines → < 200)
      map.tsx             map segment
      itinerary.tsx       itinerary segment
      budget.tsx          budget/expenses segment
      collaborators.tsx   collab segment
      settings.tsx        trip settings segment
src/
  api/                    TanStack Query hooks — Tier-2 ephemeral (Google/optimizer, memory-only, ToS firewall)
  sync/                   v2 NEW — Legend-State store + expo-sqlite + syncedSupabase (Tier-1 durable)
  components/             shared UI (platform-split .web/.native)
    charts/               react-native-gifted-charts wrappers (web+native)
  hooks/                  UI hooks (no data fetching)
  lib/
    optimizer/            REUSED — pure k-means + 2-opt (do not add I/O)
  theme/                  design tokens + ThemeProvider
supabase/
  functions/              Deno Edge Functions (reused proxies + new ai-itinerary, ai-edit, weather)
  migrations/             additive SQL; RLS via user_can_access_trip()
docs/v2/                  this blueprint + BUILD-LOG (the step tracker)
```

## State tiers (the ToS firewall)

| Tier | Engine | Holds | Persisted? |
|---|---|---|---|
| **Tier-1 durable** | Legend-State + expo-sqlite (`src/sync/`) | user-authored trip data (places, days, expenses, accommodations, reactions, notes) + `google_place_id`/lat/lng | yes (offline) — **own write-allowlist** so no Google-restricted field enters |
| **Tier-2 ephemeral** | TanStack Query (`src/api/`) | Google reviews/photos/ratings/hours, optimizer results, suggestion cards | **never** (memory-only; `shouldDehydrateQuery` firewall) |

## Hard rules (carried from v1, still binding)

- **Platform split** via `Foo.web.tsx` / `Foo.native.tsx`; consumers import `./Foo`. (Plain `tsc` can't resolve these — that's expected baseline noise; Metro resolves them.)
- **No Google HTTP key in the client** — proxy through Edge Functions.
- **Never persist** Google reviews/photos/ratings/hours/phone/website — only `google_place_id` + lat/lng are durable.
- **RLS on every trip-scoped table** via `user_can_access_trip()`.
- **Order authority (C1, refined)** — *user-intent order* lives in `trip_places.manual_rank` (client-writable, LWW-synced, offline-safe); *optimizer-computed order* (`day_index`/`order_in_day`/`trip_legs`) is written **only via server paths** (`optimize-trip` incl. its manual branch, `apply_manual_day_order` RPC), never client-LWW-merged. `route_render_mode` picks the renderer.
- **Edge Function contract versioning** — responses carry `meta.contractVersion`; the fast-iterating `ai-*` functions bump it and clients guard on it; breaking changes get a parallel version, never in-place mutation (OTA'd JS + weeks-old native binaries guarantee skew).
- **TypeScript strict**; no `any` without a one-line reason.
- **All three platforms** verified before a feature is "Done".

## Sort / metric language (post `cost_per_km`)

- Trips-list sort keys: `recent | az | start_date | duration` (the legacy `cost` key was removed in 0.1; **time-first** wins).
- Money is **category-based** (`trip_expenses`: estimated vs actual), never per-km.

## Tester note + CI posture

`test-specialist` is disabled for this build (token-saving). Author tests later by restoring `test-specialist.md.disabled`. **The actual regression net is `.github/workflows/ci.yml`:** Jest is the required check and **must stay green through the SDK upgrade** (bump `jest-expo` in lockstep at each S1 checkpoint); the tsc job is `continue-on-error` today — treat the documented tsc baseline as the gate until it's made required. Per-phase verification gate: tsc baseline-identical · Jest green · scripted web smoke → `docs/smoke/` · Sentry clean · device smoke for native-touching phases. Existing test files must be **passing or explicitly `test.skip`-ed with a tracked reason** — compiling-but-known-red specs poison the smoke signal.

See also: [`architecture.md`](architecture.md) · [`BUILD-LOG.md`](BUILD-LOG.md)
