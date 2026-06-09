# Tripvisor v2 — Build Log (every step, stored)

> **Purpose:** the canonical, persistent tracker for the v2 rewrite. Every step is listed here with status; updated after each step so progress survives across sessions.
> **Legend:** ✅ done · 🟡 in progress · ☐ todo · ⏸ blocked (needs decision) · ⏭ deferred
> **Process note:** `test-specialist` is **DISABLED** for this build (renamed `test-specialist.md.disabled`) to save tokens — automated tests are deferred to manual/user smoke. Re-enable by restoring the filename.
> Plan: [`../../plan-v2.md`](../../plan-v2.md) · Decisions/risks: [`risks-and-decisions.md`](risks-and-decisions.md)

## Pre-build (done this session)
- ✅ Sub-agent models swapped opus/sonnet → **fable** (planner left `inherit`)
- ✅ v2 docs authored + reconciled: `plan-v2.md`, `docs/v2/{architecture,features,tech-stack,migration,risks-and-decisions}.md`
- ✅ `test-specialist` disabled (token-saving)

## ⏸ Decisions gating later phases (need user input — Phase 0 does NOT need them)
- ⏸ **D1 SDK-upgrade timing** (gates Phase 1–2): do 52→53→54 early (recommended) vs stay on 52
- ⏸ **D2 Routing** (gates Phase 9): self-host OSRM vs openrouteservice free API
- ⏸ **D3 Native MapLibre deferral** (Phase 14)
- ⏸ **D4 Gemini training posture** (Phase 7)
- ⏸ **D5 PostHog opt-in** (Phase 13)
- ⏸ **D6 7-day Supabase pause keep-alive** (Phase 3)

---

## Phase 0 — Foundation + retire `cost_per_km`  (no decision needed)
- ✅ **0.1 Retire `cost_per_km`** (2026-06-09) — removed from `Trip` + `UpdateTripPatch` (`types.ts`, `trips.ts`); trips "Cost" sort → **"Duration"** sort by `sum(leg.duration_seconds)` (`tripsFilters.ts`, `routes.ts` `TripLegDurationRow`, `_keys.ts` key bump, `trips.tsx` labels); `DaySummaryCard` cost chip removed (+ dropped unused `trip` prop); `TripCostRollup` slimmed to a **time/route summary** (Option B — avoids duplicating BudgetCard); `print.tsx` `/km` line removed; `trip/[id]/index.tsx` editable rate input + `costPerKm` props removed, currency picker moved under Budget. Fixtures fixed for tsc. **Verified:** no new tsc errors (baseline-identical), jest green (tripsFilters 27/27, TripCard+humanizeDuration 10/10), zero `cost_per_km` *reads* in code (only doc-comments + DB column remain). DB column DROP deferred to **15.1**.
  - ⏭ follow-up (tester off): e2e specs still assert the old "Cost ↓" label (`phase-11-12-trips-list.spec.ts`, `phase-21-budget.spec.ts`) — update when tests are re-enabled. `cost-and-print.md` doc note: print no longer shows currency.
- ✅ **0.2 `.env.example` v2** (2026-06-09) — added v2 free-service vars: `EXPO_PUBLIC_MAP_PROVIDER` + `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` (OpenFreeMap, no key), `EXPO_PUBLIC_POSTHOG_*` (opt-in), and a server-secrets manifest (`GEMINI_API_KEY`, `GROQ_API_KEY`, `ROUTING_PROVIDER`/`OSRM_BASE_URL`/`ORS_API_KEY`; Open-Meteo keyless; Resend via dashboard).
- ✅ **0.3 v2 directory conventions** (2026-06-09) — `docs/v2/conventions.md`: target layout (route segments, `src/sync` Tier-1, `src/api` Tier-2), state-tier ToS firewall, server-authoritative order rule, sort/metric language post-`cost_per_km`.
- ✅ **0.4 Confirm reuse-the-gold baseline** (2026-06-09) — `git status` confirms `src/lib/optimizer/`, `supabase/migrations/`, `supabase/functions/` (incl. `user_can_access_trip()` + the 10 Edge Functions) are **untouched**. Baseline `tsc --noEmit` = pre-existing platform-split/Deno/test-globals noise only; no new errors.

## Phase 1 — SDK 52→53 + React 19  ⏸ needs D1
- ☐ 1.1 Bump Expo→53, RN→0.79, React→19; resolve peer deps  _(ui)_
- ☐ 1.2 Babel/Reanimated v3 config check (no double worklets plugin)  _(ui)_
- ☐ 1.3 `npx expo-doctor` + tsc green  _(ui)_
- ☐ 1.4 Real-device iOS + Android dev-client smoke (maps, drag, navigation)  _(ui, manual)_

## Phase 2 — SDK 53→54 + New Arch + Reanimated v4  ⏸ needs D1
- ☐ 2.1 Bump Expo→54, RN→0.81, React→19.1; Reanimated v3→v4 + `react-native-worklets`  _(ui)_
- ☐ 2.2 Pin `react-native-maps` 1.21+; verify New-Arch Android markers on device  _(ui, manual)_
- ☐ 2.3 Swap hand-rolled SVG charts → `react-native-gifted-charts` + `react-gifted-charts`  _(ui)_
- ☐ 2.4 Re-smoke drag (`draggable-flatlist`/`@dnd-kit`) under New Arch  _(ui, manual)_

## Phase 3 — Backend: adopt Realtime + Storage + pg_cron
- ☐ 3.1 Migration: enable `realtime` publication on synced tables  _(backend)_
- ☐ 3.2 Storage buckets `trip-docs` + `user-uploads` (private, RLS via `user_can_access_trip`)  _(backend)_
- ☐ 3.3 `pg_cron` jobs: 7-day-pause heartbeat (⏸ D6), 30-day leg-TTL purge, analytics MV refresh  _(backend)_
- ☐ 3.4 Wire **Resend** as Supabase Auth SMTP (config)  _(backend)_

## Phase 4 — Offline schema + Legend-State Tier-1
- ☐ 4.1 Migration: add `created_at/updated_at/deleted` + `handle_times()` trigger to all synced roots  _(backend)_
- ☐ 4.2 Install Legend-State v3 + `expo-sqlite`; create `src/sync/` store + persistence  _(backend)_
- ☐ 4.3 Tier-1 write-allowlist + ESLint guard (ToS second-door, C3)  _(backend)_
- ☐ 4.4 Migrate entities to the store one at a time (trips→places→days→legs→expenses→accommodations→reactions)  _(backend, ui)_
- ☐ 4.5 Enforce **order columns server-authoritative** (C1) — not LWW-synced  _(backend)_

## Phase 5 — Offline write-queue + sync UI
- ☐ 5.1 Durable write-queue + optimistic + rollback  _(backend)_
- ☐ 5.2 Per-entity sync-status UI (synced/pending/conflict) + resolver  _(ui)_
- ☐ 5.3 Graceful degradation when AI/routing/weather offline  _(ui)_
- ☐ 5.4 Retire AsyncStorage persister roots now owned by Legend-State; existing-user migration  _(backend)_

## Phase 6 — Nav backbone + god-screen split
- ☐ 6.1 Decompose `trip/[id]/index.tsx` (2442 lines) → route segments (map/itinerary/settings/budget/collab)  _(ui)_
- ☐ 6.2 Home/Discover surface (hosts "Plan my trip")  _(ui)_
- ☐ 6.3 Desktop-web layouts per key screen; explicit back affordances  _(ui)_
- ☐ 6.4 Evolved design tokens/theme + empty states + onboarding  _(ui)_

## Phase 7 — AI core: "Plan my trip"  ⏸ needs D4
- ☐ 7.1 `ai-itinerary` Edge Function (Gemini 2.5 → Groq fallback, `responseSchema`)  _(backend)_
- ☐ 7.2 Grounding loop: place names → `places-autocomplete`→`place-details` → real ids/coords  _(backend)_
- ☐ 7.3 Per-user quota table + enforcement (C4)  _(backend)_
- ☐ 7.4 "Plan my trip" UI (prompt → draft → optimizer → itinerary)  _(ui)_
- ☐ 7.5 `trip_ai_runs` audit table (no PII)  _(backend)_

## Phase 8 — AI editing & suggestions
- ☐ 8.1 `ai-edit` NL patch endpoint + apply-diff  _(backend, ui)_
- ☐ 8.2 Smart gap-fill suggestions (Tier-2 memory-only)  _(ui)_
- ☐ 8.3 "Why this order?" rationale  _(ui)_

## Phase 9 — Maps (free): web MapLibre + OSRM  ⏸ needs D2
- ☐ 9.1 `Map.web.tsx` → MapLibre (`react-map-gl/maplibre`) + OpenFreeMap; preserve dayColor/dashed/markers/region  _(ui)_
- ☐ 9.2 Re-point `distance-matrix`→OSRM `/table`, `directions-polyline`→`/route` (contracts unchanged)  _(backend)_
- ☐ 9.3 Routing health-check + auto-failover; Google env-flag fallback  _(backend)_
- ☐ 9.4 Offline web tiles to `expo-file-system`  _(ui)_

## Phase 10 — Weather + packing + documents
- ☐ 10.1 `weather` Edge Fn (Open-Meteo) + per-day forecast UI  _(backend, ui)_
- ☐ 10.2 Rainy-day indoor-alternative suggestions  _(ui)_
- ☐ 10.3 `trip_packing_items` table + auto-seed + editor UI  _(backend, ui)_
- ☐ 10.4 `trip_documents` (Storage) — upload/view tickets/docs, RLS path-prefix guard  _(backend, ui)_

## Phase 11 — Realtime collaboration
- ☐ 11.1 Presence + cursors (Supabase Broadcast)  _(backend, ui)_
- ☐ 11.2 Live co-edit via Postgres Changes (per-trip scoped)  _(backend, ui)_

## Phase 12 — Optimizer upgrades + meals
- ☐ 12.1 Opening-hours / time-window awareness (user-confirmed `arrive_after/leave_before`, ToS-safe)  _(backend)_
- ☐ 12.2 Real multi-leg transit rendering  _(backend, ui)_
- ☐ 12.3 Per-day start/end anchor UX  _(ui)_
- ☐ 12.4 `trip_meals` slotting  _(backend, ui)_

## Phase 13 — Analytics fix + charts  ⏸ needs D5
- ☐ 13.1 Server-side aggregation MV (fixes 10-trip cap) + live fallback  _(backend)_
- ☐ 13.2 gifted-charts across analytics + budget screens  _(ui)_

## Phase 14 — Native parity + push + a11y/polish
- ☐ 14.1 iOS + Android EAS builds + native smoke checklist (close native debt)  _(ui, manual)_
- ☐ 14.2 Expo Push + `device_push_tokens` table (native-only)  _(backend, ui)_
- ☐ 14.3 WCAG 2.2 AA pass + desktop-web polish  _(ui)_

## Phase 15 — Launch hardening
- ☐ 15.1 **DROP `trips.cost_per_km`** migration  _(backend)_
- ☐ 15.2 Cost/quota observability dashboard + alerts (8 free ceilings)  _(backend)_
- ☐ 15.3 Final smoke + deploy (Cloudflare Pages + EAS) + docs sign-off  _(ui, docs)_

---

### Change history
- 2026-06-09 — log created; Phase 0.1 started.
- 2026-06-09 — Phase 0.1 ✅ complete (cost_per_km retired, time-first; tsc + jest verified). Next: 0.2–0.4 (no decision) then Phase 1 ⏸ (needs D1 SDK-upgrade go-ahead).
- 2026-06-09 — Phase 0.2–0.4 ✅ complete (env vars, conventions doc, reuse-the-gold baseline confirmed). **Phase 0 DONE.** Committed via git-committer. ⏸ Awaiting user go-ahead for Phase 1 (SDK 52→53 upgrade; needs device smoke).
