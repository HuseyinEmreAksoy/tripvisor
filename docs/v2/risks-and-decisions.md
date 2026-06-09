# Tripvisor v2 — Risks & Resolved Decisions

> **Status:** v2 (2026-06-09). Captures the design critic's **"approve with conditions"** verdict and the resolutions baked into the v2 plan. Read this before committing the plan.

## Verdict (critic)

> *Strong, well-grounded design, verified against the repo on the load-bearing claims (optimizer signature, `user_can_access_trip()`, the 3-root persister allowlist, zero realtime in `supabase.ts`, the **2442-line** trip god-screen, `cost_per_km` across 10 files, **10** Edge Functions). **APPROVE WITH CONDITIONS** — close four issues before committing.*

## Conditions to resolve (the four serious ones)

### C1 — Optimizer authority conflict *(biggest coherence gap)*
Both the **server** `optimize-trip` Edge Function (row-mutex, migration 0008) and the **client** Legend-State LWW path can write `trip_places.day_index / order_in_day` and `trip_legs`. With LWW on `updated_at`, a stale client optimize could overwrite a fresher server optimize.
- **Decision:** **order columns (`day_index`, `order_in_day`, `trip_legs`) are SERVER-AUTHORITATIVE and are NOT client-LWW-synced.** Client optimistic order is **display-only** until the server `optimize-trip` confirms. Legend-State syncs user-authored fields (visit minutes, titles, expenses, notes); the optimizer's outputs flow one way: server → client.

### C2 — OSRM "free" is a HIGH availability/cost risk *(mislabeled $0)*
Oracle Cloud Always-Free ARM is hard to obtain and **reclaims idle VMs**; a holiday planner is idle for months. If the VM dies, routing silently falls back to **Google (metered)**.
- **Decision:** Treat routing as **conditional**. Default to **openrouteservice free API** (2,000 directions/day, 50×50 matrix, key required) as the lower-ops primary *unless* someone owns the OSRM box. Add a **health-check + auto-failover** (not just an env flag) so degradation is detected. Google stays the last-resort env-flagged fallback. **Owner decision required** (see open decisions).

### C3 — ToS "second door" *(new persistence engine bypasses the firewall)*
v1's `shouldDehydrateQuery` allowlist keeps Google reviews/photos/ratings/hours off disk. **Legend-State's SQLite store is a second persistence engine the allowlist does NOT govern.** An AI/suggestion path that caches a "suggested place" card with a live Google rating/photo into an observable would persist restricted data.
- **Decision:** Give Tier-1 its **own write-allowlist** (a typed boundary that only durable, ToS-safe fields may enter Legend-State) **+ an ESLint guard + a test** asserting no Google-restricted field is ever written to the store. Suggestion cards stay in Tier-2 (TanStack, memory-only) until the user accepts.

### C4 — Per-user quota for shared AI/Google keys
`ai-itinerary` is JWT-scoped, but one user can burn the shared Gemini key's 250 RPD **and** the Google grounding credit for everyone. A row-mutex is not a rate limiter.
- **Decision:** Add a real **per-user token-bucket / quota table** (daily AI generations + grounding calls) enforced server-side in the Edge Function. Degrade gracefully when exhausted.

## Other risks to track

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **EAS Build 30/mo** vs a native-heavy plan (2-step SDK upgrade + parity) — native config can't OTA | High | Native builds only on tagged releases; OTA for JS; CI in GitHub Actions |
| R2 | **Gemini trains on free-tier prompts** | Med (ToS) | Send only user text + place names; never Google-derived data (incl. Google-Routes leg durations — prefer routing AI calls only when OSRM supplied the legs) |
| R3 | **AI grounding is Google-metered** | Med (cost) | Cache grounded places; per-user quota (C4); count grounding calls toward credit observability |
| R4 | **LWW vs 30-day leg TTL purge race** could resurrect ToS-expired Google polylines | Med (ToS) | Purge runs as `postgres`; never re-hydrate a tombstoned/expired leg from client SQLite; legs are server-authoritative (C1) |
| R5 | **Web offline-write durability** (expo-sqlite OPFS) may degrade to read-only on web (needs COOP/COEP) | Med | Surface as an **explicit platform-parity caveat** per CLAUDE.md; state "full offline editing = native; web = read-mostly" if OPFS unavailable |
| R6 | **Legend-State v3 is @beta** on the critical path | Med | Pin exact version; budget one upgrade; keep "hand-rolled expo-sqlite sync" as the named fallback |
| R7 | **Existing v1 user data migration** is undesigned (persister retirement, `handle_times()` replacing `set_updated_at`, tombstones, `created_at/updated_at` on `trip_days`) | Med | Design a one-time migration + cold-start reconciliation; covered in [`migration.md`](migration.md) |
| R8 | **Native offline tiles over Google SDK** (raster OSM tiles inside the Google container) is a ToS/visual gray area | Med | Prefer native-vector MapLibre once on New Arch; until then, scope native offline maps as "raster basemap" explicitly or keep native maps online-only |
| R9 | **Supabase egress / PMTiles slice size** never estimated | Low-Med | Keep tiles in `expo-file-system` not Storage; back-of-envelope egress before promoting multi-device sync |
| R10 | **Cost/quota observability** across ~8 free ceilings is undefined | Med | Phase 15 guardrail: a usage dashboard + alerts; counters for Google credit consumed by grounding |
| R11 | **Analytics MV staleness** — same-day trip shows stale aggregates until nightly refresh | Low | Specify the live-fallback aggregation path, not just the nightly `pg_cron` MV |

## Factual corrections folded in
- **10** Edge Functions (not 11).
- The trip god-screen is **2442 lines** (`app/(app)/trip/[id]/index.tsx`) — split is non-trivial.
- `cost_per_km` spans **10 files** — retirement touches more than the headline 5 surfaces.

See also: [`architecture.md`](architecture.md) · [`tech-stack.md`](tech-stack.md) · [`features.md`](features.md) · [`migration.md`](migration.md) · [`../../plan-v2.md`](../../plan-v2.md)
