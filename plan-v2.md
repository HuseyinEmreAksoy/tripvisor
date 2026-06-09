# Tripvisor v2 — Master Plan (0 → ship)

> **Status:** v2 roadmap (2026-06-09), reconciled with the multi-agent design pass + critic.
> Detail docs: [`docs/v2/architecture.md`](docs/v2/architecture.md) · [`docs/v2/features.md`](docs/v2/features.md) · [`docs/v2/tech-stack.md`](docs/v2/tech-stack.md) · [`docs/v2/migration.md`](docs/v2/migration.md) · [`docs/v2/risks-and-decisions.md`](docs/v2/risks-and-decisions.md)
> Sub-agents now run on the **Fable** model (planner stays `inherit`).

## Vision

*Describe your trip in words, plan it offline, and let the time-first optimizer route your days — for free.*

## Constraints

1. **Free only** ($0 ceiling at hobby scale).
2. **Greenfield, reuse the gold** (optimizer, RLS + `user_can_access_trip()`, **10** Edge Functions, schema core).
3. **Time-first** (retire `cost_per_km` — it spans **10 files** today).
4. **Google ToS** (no place-content persistence; keys server-side).
5. **All three platforms** (iOS · Android · Web) verified before a feature is Done.

## Phase plan

> Owners: `planner` · `ui-specialist` · `backend-specialist` · `test-specialist` · `reviewer` · `docs-specialist`. Each phase ends with web smoke + native smoke where native surface is touched.

| Phase | Title | Goal | Owners | Depends on |
|---|---|---|---|---|
| **0** | Foundation + retire `cost_per_km` | Scaffold v2 shell; reuse optimizer/RLS/Edge Functions byte-unchanged; replace all 10 `cost_per_km` sites with time/category metrics (drop column deferred to P15) | ui, backend | — |
| **1** | SDK 52→53 + React 19 | First upgrade step; validate on real iOS+Android dev-client | ui, test | 0 |
| **2** | SDK 53→54 + New Arch + Reanimated v4 | Land on SDK 54/Fabric; gifted-charts; re-smoke maps/drag on device | ui, test | 1 |
| **3** | Backend: adopt Realtime + Storage + pg_cron | Heartbeat (defeat 7-day pause), analytics materialized view, leg-TTL purge, Storage buckets | backend | 0 |
| **4** | Offline schema + Legend-State Tier-1 | `created_at/updated_at/deleted` + `handle_times()` on all synced roots; Legend-State + expo-sqlite for durable tables; **order columns server-authoritative** (C1) | backend, ui | 2, 3 |
| **5** | Offline write-queue + sync UI | Durable queue, optimistic + rollback, per-entity sync/conflict UI, graceful degradation; ToS second-door guard (C3) | backend, ui | 4 |
| **6** | Nav backbone + god-screen split | Decompose the **2442-line** `trip/[id]/index.tsx`; Home/Discover surface; desktop-web layouts | ui | 5 |
| **7** | AI core — "Plan my trip" | `ai-itinerary` Edge Fn (Gemini 2.5 → Groq) → **grounding loop** → optimizer; per-user quota (C4) | backend, ui | 6 |
| **8** | AI editing & suggestions | NL edits, smart gap-fill, "why this order?"; suggestions stay Tier-2 memory-only | backend, ui | 7 |
| **9** | Maps (free) — web MapLibre + OSRM | Web MapLibre + OpenFreeMap; route `distance-matrix`/`directions-polyline` Edge Fns at OSRM/ORS + health-check failover (C2); offline web tiles | backend, ui | 6 |
| **10** | Weather + packing + documents | Open-Meteo per-day + rainy-day swaps; packing lists; Storage-backed ticket/doc storage | backend, ui | 7, 9 |
| **11** | Realtime collaboration | Presence + live co-edit via Supabase Realtime (rides the sync layer) | backend, ui | 5 |
| **12** | Optimizer upgrades + meals | Opening-hours/time-window awareness (user-confirmed, ToS-safe), real multi-leg transit, anchor UX; meal slotting | backend, ui | 7, 9 |
| **13** | Analytics fix + charts | Server-side aggregation (MV) beyond 10 trips; gifted-charts everywhere | ui, backend | 2, 3 |
| **14** | Native parity + push + a11y/polish | iOS+Android EAS builds + native smoke; Expo Push; WCAG 2.2 AA; desktop polish; close Phase 21–25 + native debt | ui, test | all UI phases |
| **15** | Launch hardening | Cost/quota observability dashboard (C/R10); **DROP `cost_per_km`**; deploy; docs sign-off | backend, test, docs | all |

## Critical path

`0 → 1 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 12 → 14 → 15`
(the two-step SDK/New-Arch upgrade gates offline + charts; offline gates nav, AI, and realtime; everything gates native verification + launch.)

## Open decisions (need user input)

1. **SDK-upgrade timing** — do the 52→53→54 + Fabric migration early (recommended; unblocks charts + offline) vs stay on SDK 52/React 18 (lands on a frozen, EOL arch).
2. **Routing ownership (C2)** — self-host **OSRM** (true $0 but fragile free compute + ops) vs **openrouteservice free API** (lower ops, needs a key + daily cap). Google stays env-flag fallback either way.
3. **Native MapLibre deferral** — accept native keeping Google rendering + raster offline tiles for v2 GA (recommended) vs pull native vector swap into P14 (added risk).
4. **Gemini training posture** — accept free-tier (may train on prompts; mitigated by sending only user text + place names) vs paid Vertex (breaks free-only).
5. **Product analytics** — include PostHog Cloud free (client SDK network calls) vs zero-third-party (Supabase events table). Sentry stays regardless.
6. **7-day Supabase pause** — run a pg_cron heartbeat keep-alive vs accept cold-resume-on-return.

## Done so far (this session)

- ✅ Sub-agent models swapped opus/sonnet → **fable** (planner left `inherit`).
- ✅ v2 docs written + reconciled with the design pass: this plan + `docs/v2/{architecture,features,tech-stack,migration,risks-and-decisions}.md`.
- ✅ Critic verdict folded in: **approve with conditions** — C1 optimizer authority, C2 OSRM, C3 ToS second door, C4 per-user AI quota — captured in [`docs/v2/risks-and-decisions.md`](docs/v2/risks-and-decisions.md).
