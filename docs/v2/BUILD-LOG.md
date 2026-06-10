# Tripvisor v2 — Build Log (every step, stored)

> **Purpose:** the canonical, persistent tracker for the v2 rewrite. Every step is listed here with status; updated after each step so progress survives across sessions.
> **Legend:** ✅ done · 🟡 in progress · ☐ todo · ⏸ blocked (needs decision) · ⏭ deferred
> **Process notes:** `test-specialist` is **DISABLED** (renamed `test-specialist.md.disabled`). The **verification gate** below replaces it. All agents + orchestrator run on **Fable**.
> Plan: [`../../plan-v2.md`](../../plan-v2.md) (v2.1, Fable-revised 2026-06-10) · Risks: [`risks-and-decisions.md`](risks-and-decisions.md) · UX bar: [`ux-principles.md`](ux-principles.md)

## Verification gate (every phase, tester disabled)
① `tsc --noEmit` baseline-identical · ② existing Jest suites green (**CI required check stays green — incl. through the SDK upgrade**) · ③ 10-min scripted web golden-path smoke → `docs/smoke/` · ④ Sentry clean of new runtime errors · ⑤ device smoke only for native-touching phases (S1, S2, P4). **Native spot-check cadence:** 1 EAS dev-client build + 15-min smoke every 2–3 phases (~5 of 30 builds/mo).

## ⏸ Decision gates (triaged 2026-06-10)
- ⏸ **D4 Gemini posture** — **now-blocking** (N3). Recommend: accept free tier, send only user text + place names.
- ⏸ **D2 Routing** — **now-blocking** (N5). Recommend: ORS free API + Google env-flag fallback.
- ⏸ **D1 SDK timing** — blocks S-track only; Now-track runs on SDK 52.
- ✅ **D6 resolved** — keep-alive = GitHub Actions cron pinger (pg_cron heartbeat is self-referential).
- ⏸ D3 native MapLibre deferral (P4/post-GA) · ⏸ D5 PostHog (P3) — can wait.

## Debt register (live; re-deferral must be explicit)
| Item | Status | Lands in |
|---|---|---|
| Analytics 10-trip cap (comment claims 20, wires 10 — **live silent-data-loss bug**) | ✅ interim 2026-06-10 (useQueries, all trips) | P3 proper (MV) |
| Stale e2e "Cost ↓" assertions (`phase-11-12-trips-list.spec.ts`, `phase-21-budget.spec.ts`) | ✅ 2026-06-10 | 0.5b |
| `useCollaboratedTrips` + `tripCollaboratorsKeys.mine` (zero runtime callers; deferral #3) | ✅ deleted 2026-06-10 | 0.5b |
| Stray artifacts (`*-fresh.txt`, `e2e-final.txt`, malformed tsc-output) + `.gitignore` gaps | ✅ 2026-06-10 | 0.5b |
| v1 docs contradict v2 (cost model, Cost sort, useCollaboratedTrips) | ✅ banners 2026-06-10 | full rewrite per-phase |
| v2 doc contradictions (features B2 "CRDT", "~1000-line" vs 2442, MMKV ambiguity, planner "inherit" claim) | ✅ 2026-06-10 | fixed with the panel synthesis (0.5e) |
| Uncommitted blueprint (ux-principles.md, planner.md→fable, this revision) | ✅ committed 2026-06-10 (`e9e0715`) | 0.5a |
| Zero native verification (all of v1) | ☐ | spot-checks + P4 |
| e2e/Playwright re-enablement | ⏭ | post-GA (tracked, not silent) |

---

## ✅ Pre-build (done)
- ✅ Sub-agent models → **fable** (planner too, 2026-06-10); orchestrator session → Fable 5
- ✅ v2 docs authored + critic-reconciled (2026-06-09); **Fable 5-lens review panel + synthesis (2026-06-10)** → plan v2.1
- ✅ `test-specialist` disabled (token-saving)

## ✅ Phase 0 — Foundation + retire `cost_per_km`  (DONE 2026-06-09, committed `714eea8`/`5411607`/`a990187`)
- ✅ **0.1 Retire `cost_per_km`** — removed from `Trip` + `UpdateTripPatch` (`types.ts`, `trips.ts`); trips "Cost" sort → **"Duration"** sort by `sum(leg.duration_seconds)` (`tripsFilters.ts`, `routes.ts` `TripLegDurationRow`, `_keys.ts` key bump, `trips.tsx` labels); `DaySummaryCard` cost chip removed (+ dropped unused `trip` prop); `TripCostRollup` slimmed to a **time/route summary**; `print.tsx` `/km` line removed; `trip/[id]/index.tsx` editable rate input + `costPerKm` props removed, currency picker moved under Budget. **Verified:** no new tsc errors, jest green (37 tests), zero `cost_per_km` reads. DB column DROP deferred to **P5**.
- ✅ **0.2 `.env.example` v2** — MapLibre/OpenFreeMap + PostHog client vars; server-secrets manifest (Gemini/Groq/routing; Open-Meteo keyless; Resend via dashboard).
- ✅ **0.3 Conventions** — `docs/v2/conventions.md` (layout, state tiers, hard rules).
- ✅ **0.4 Reuse-the-gold baseline** — optimizer / migrations / 10 Edge Functions untouched; tsc baseline recorded.

---

## ✅ Phase 0.5 — Debt sweep & hygiene  (DONE 2026-06-10; verified: tsc clean vs baseline, Jest 25 suites / 268 tests green)
- ✅ **0.5a Commit the blueprint** — done earlier 2026-06-10 (`0eb41d6`, `e9e0715`, `b3530b9`).
- ✅ **0.5b Hygiene** — deleted `e2e-final.txt`/`e2e-fresh.txt`/`jest-fresh.txt`/`tsc-fresh.txt` + malformed `C…tsc-output.txt`; `.gitignore` += `*-fresh.txt`, `e2e-final.txt`, `tsc-output.txt`, `.claude/scheduled_tasks.lock`; e2e "Cost ↓"→"Duration ↓" fixed (`phase-11-12-trips-list.spec.ts` ×4 sites) + stale "Travel cost" comment fixed (`phase-21-budget.spec.ts`); **`useCollaboratedTrips` deleted** + `tripCollaboratorsKeys.mine` removed + 2 dead `mine()` invalidations removed (accept/decline) + comment refs fixed (`trips.ts`, `trip-collaborators.ts` header, manage-collaborators README); unused `Trip` import dropped.
- ✅ **0.5c Analytics interim fix** — `analytics.tsx`: 10 hand-wired `useTripPlaces` hooks → one dynamic `useQueries` over **ALL** trip ids (reuses `tripPlacesKeys.forTrip` so caches stay shared); fixed `placeMeta` AND the second `p0..p9` block in `reactionsByTrip` (lines 159/189 — the verifier caught it); lying "first 20" comment corrected. Proper MV fix still lands P3.
- ✅ **0.5d v1-docs banner pass** — superseded-by-v2 banners on `docs/architecture.md` + `docs/features/{cost-and-print,expenses,trip-crud,collaboration}.md`.
- ✅ **0.5e v2 self-contradiction fixes** (done 2026-06-10, with the panel synthesis) — features.md B2 "CRDT" → `manual_rank` wording; "~1000-line" → 2442 everywhere; expo-sqlite pinned (MMKV removed from diagrams); plan-v2 "planner stays inherit" claim fixed by the v2.1 rewrite.
- ✅ **0.5f CI posture** — conventions.md updated (with the panel synthesis) + `ci.yml` header comment now states the posture: Jest required through S1, tsc `continue-on-error` acknowledged, Playwright TODO re-pointed at the BUILD-LOG debt register (old "phase-6" was v1 numbering).

## Now-track  (SDK 52, OTA-able, starts after 0.5)

### ✅ N1 — Nav backbone + core-loop UX  (DONE 2026-06-10; commits `ada5d6d`, `cb2e9c4`)
- ✅ 1.1 God-screen split: 2365→**312-line route shell** + 8 components in `src/components/trip-detail/` (TripHeader, MapTab, ItineraryTab, PlaceRow, NotesEditors, SettingsTab, CoverPhotoSection, CoverPickerModal). Pure refactor; parity checklist held; tsc byte-identical; jest green. *(Note: shipped as component extraction with one route shell, not separate route segments — reconciled here.)*
- ✅ 1.2 Timeline: `DayStartTimeControl` (per-day start, default 09:00, persists via `trip_days.start_time` from migration 0020 with graceful pre-migration fallback) + arrival→departure chips per place via pure `computeDayTimeline.ts`.
- ✅ 1.3 Home/Discover: `home/HomeHero.tsx` on trips.tsx — travel hero, trip-countdown card, "✨ Plan my trip with AI" CTA → `/trip/plan`.
- ✅ 1.4 Ideas: Unscheduled bucket renamed + promote-to-day affordance.
- ✅ 1.5 Sample trip: `useSampleTrip` + empty-state "Try a sample trip".
- ✅ 1.6 Google OAuth: `GoogleSignInButton` + `useGoogleSignIn` on login/signup (friendly fallback until the provider is configured in the dashboard).
- ✅ 1.7 Comments UI: 💬 badges (batch `useTripComments`, no fan-out) + `PlaceCommentsSheet` (attributed flat thread, add/soft-delete, optimistic).
- ✅ 1.8 Back affordances + desktop pass on all new surfaces.

### ✅ N2 — Backend adoption  (DONE 2026-06-10; commit `13f17bf`)
- ✅ 2.1 Realtime publication on 6 tables (idempotent DO blocks) — migration 0019.
- ⏭ 2.2 Storage buckets — deferred to P2 (documents feature is the consumer; no earlier need). *(explicit re-scope, not silent)*
- ✅ 2.3 pg_cron: nightly 30-day leg-TTL purge + `analytics_user_trip_stats` MV refresh; MV reader `get_my_trip_stats()` (security definer; MV itself revoked from clients).
- ✅ 2.4 Keep-alive: `.github/workflows/keepalive.yml` (every 3 days; needs repo secrets).
- 🟡 2.5 Resend SMTP + Google OAuth — **dashboard-manual**, documented in `supabase/migrations/README-v2.md` (code-side complete).
- ✅ 2.6 `trip_place_comments` migration (RLS hardened: trip/place cross-check on INSERT/UPDATE) + `src/api/trip-place-comments.ts` hooks + `tripPlaceCommentsKeys`.

### ✅ N3 — AI core: "Plan my trip"  (DONE 2026-06-10; D4 accepted per user direction; commits `6313d2a`, Wave 3)
- ✅ 3.1 `ai-itinerary` Edge Fn (955 lines): Gemini 2.5-flash `responseSchema` → Groq `gpt-oss-20b` strict json_schema fallback; data-minimized (user text + place names only); `ai_misconfigured` friendly state when keys absent.
- ✅ 3.2 Grounding loop: location-biased autocomplete→details (FieldMask `id,location,displayName` only), promise-pooled; `unresolved[]` surfaced (status `partial`), LLM coords never used.
- ✅ 3.3 `ai_usage` ledger (C4: 10 plans/day/user) + `trip_ai_runs` audit with **idempotent replay** (same key → stored draft, zero re-billing) — migration 0020 (+ `trip_days.start_time`).
- ✅ 3.4 Draft-review screen (`src/components/ai-plan/`, 9 files): DRAFT staging (no writes until accept), keep/remove/restore, duration + day reassign, unresolved card, editable title, "Powered by Google", commit progress, **undo beat deletes the trip**, partial-failure honesty, quota-exhausted card.
- ✅ 3.5 `/trip/plan` flow live (form → review → commit → success/undo); commit = `useCreateTrip` → places (+ `useMoveToDay` for day persistence — `day_index` isn't in the create schema) → one `useOptimizeTrip`.

### ✅ N4 — AI editing + import  (DONE 2026-06-10; gate-verified: jest 25/268 green, tsc clean — Deno-noise only on new Edge Fn)
- ✅ 4.1 **`ai-edit` Edge Fn** (1571 lines, action-discriminated edit/suggest/ground) + migration `0021` (kind CHECK widened) + **shared `_shared/ai.ts`** (502 lines — ai-itinerary refactored to consume it, 955→625). LLM sees `p1..pN` aliases (never UUIDs), user-authored context only (D4); diff hygiene (no-ops pruned, dup adds skipped); idempotent replay kind-filtered. Client: `useAiEditTrip`/`useAiSuggest`/`useGroundPlaces` in `src/api/ai.ts` (408 lines). **UI:** `AiEditSheet` (instruction → grouped diff preview Adds/Removes/Moves/Durations, per-row include/exclude, apply with progress) + `useAiEditApply` (sequential apply via existing mutations, pre-delete row capture, **one-tap inverse-ops Undo**, one re-optimize).
- ✅ 4.2 **Gap-fill**: `GapFillSheet` — day-slack chip (computeDayTimeline vs daily budget) → **Ideas first** (zero-cost one-tap add) → "Ask AI" `useAiSuggest` (0-based dayIndex in, 1-based out), Tier-2 until accepted, Powered-by-Google.
- ✅ 4.3 **Import**: `ImportPlacesSheet` + `src/lib/importParse.ts` — paste (≤30/batch, dedup) + **web-only** Takeout CSV via platform-split `CsvImportButton.web.tsx` (no new native deps) → `useGroundPlaces` (100/day budget, 429 friendly) → resolved into Ideas, unresolved listed.
- ⚠ Session limit hit at the very end of the UI wave (agent `a1c5bea907b51e0b5`, 95 tool calls) — work complete on disk + gate-verified; final agent report lost. Committed post-resume.

### N5 — Free maps (web) + kill switches  ⏸ D2
- ☐ 5.1 `Map.web.tsx` → MapLibre + OpenFreeMap behind existing `MapViewProps` (dayColor, dashed transit, marker press, region fit — more than cosmetic)
- ☐ 5.2 Re-point `distance-matrix` → ORS/OSRM `/table`, `directions-polyline` → `/route` (contracts unchanged; client untouched)
- ☐ 5.3 Routing health-check + auto-failover; Google env-flag last resort
- ☐ 5.4 **`app_config` runtime kill-switches** (map provider / routing provider / sync per entity) read at startup, cached; env vars become defaults only

**🚀 WEB BETA after N5 — deploy to Cloudflare Pages.**

## SDK-track  ⏸ D1

### S1 — SDK epic 52→53→54 (one epic, two checkpoints; PURE upgrade — no feature work)
- ☐ S1.1 Checkpoint A: Expo 53 / RN 0.79 / React 19; Reanimated stays v3; `expo-doctor` + tsc + **Jest green (jest-expo bumped)**; device smoke (maps, drag, nav)
- ☐ S1.2 Checkpoint B: Expo 54 / RN 0.81 / React 19.1; New Arch; Reanimated v4 + `react-native-worklets` (no double babel plugin); `react-native-maps` pinned 1.21+ — **Android marker check on real device**; drag re-smoked
- ☐ S1.3 EAS budget: Android validates free via local `expo run:android`; reserve EAS builds for iOS checkpoints

### S2 — Offline engine (old Phases 4+5 merged; staged)
- ☐ S2.1 Migration: `created_at/updated_at/deleted` + `handle_times()` on all synced roots; **`manual_rank`** (fractional index, client-writable, LWW) on `trip_places` — C1-refined: user-intent order syncs, `day_index`/`order_in_day`/`trip_legs` stay server-computed; `route_render_mode` picks renderer
- ☐ S2.2 Stage (a): Legend-State v3 + **expo-sqlite** (pinned) — read-only hydration of ALL entities
- ☐ S2.3 C3 guard: Tier-1 write-allowlist (typed boundary) + ESLint rule + test — no Google-restricted field can enter SQLite
- ☐ S2.4 Stage (b): writes per entity, low-risk first; durable write-queue + optimistic + rollback
- ☐ S2.5 **Undo stack in the mutation layer** (inverse ops): place remove, day reassign, reorder, optimize-overwrote-my-order, AI-apply
- ☐ S2.6 Offline drag semantics: writes `manual_rank`, marked "pending route recompute", **never reverted**; reconnect runs optimize-trip manual branch
- ☐ S2.7 Sync-status UI (synced/pending/conflict + resolver); sync telemetry (queue depth, conflict rate, last-sync) → Sentry breadcrumbs
- ☐ S2.8 Persister retirement + v1-user first-launch migration (test against a real v1 profile)
- ☐ S2.9 **Abort gate**: trips+places not green (round-trip + C1 + C3 tests) in the first slice → switch to hand-rolled expo-sqlite sync fallback (R6)

## Post-track

### P1 — Optimizer & route-adjust  (needs N5)
- ☐ P1.1 Time-windows: user-confirmed `arrive_after`/`leave_before` + **user-facing conflict warnings** ("arrives 18:40, closes 18:00") computed vs Tier-2 live hours (never persisted, never auto-filled into columns) + override
- ☐ P1.2 Real multi-leg transit rendering
- ☐ P1.3 Per-day start/end anchor UX; preserve + polish "Best route vs My order"

### P2 — Depth  (needs N2, N3)
- ☐ P2.1 `weather` Edge Fn (Open-Meteo) + per-day forecast chips + rainy-day indoor swaps (via gap-fill)
- ☐ P2.2 Packing lists (auto-seed from destination/season/weather; editable, offline)
- ☐ P2.3 Documents: Storage upload/view for tickets/docs; RLS path-prefix guard designed (injection-safe path parse → `user_can_access_trip`)

### P3 — Charts + analytics  (needs S1, N2)
- ☐ P3.1 gifted-charts (+ `react-gifted-charts` web) across analytics + budget
- ☐ P3.2 Wire the N2 analytics MV (server-side aggregation; cap properly dead) + live same-day fallback

### P4 — Native parity + push  (needs S1, S2)
- ☐ P4.1 iOS + Android EAS builds + native smoke checklist (close v1's zero-native debt)
- ☐ P4.2 Expo Push + `device_push_tokens` (RLS) with **defined content**: trip countdown, collaborator activity, day-before weather
- ☐ P4.3 Sign-in-with-Apple (required once Google OAuth ships) — native GA gate
- ☐ P4.4 WCAG 2.2 AA pass + desktop polish

**🚀 NATIVE GA after P4.**

### P5 — Launch hardening
- ☐ P5.1 **DROP `trips.cost_per_km`** (grep-gated: zero reads)
- ☐ P5.2 Quota/cost threshold alerts (ledger live since N3; presentation only)
- ☐ P5.3 Final smoke + deploy + docs sign-off

## Post-GA backlog (deferred, tracked)
Realtime co-edit (presence **dots** + live changes + live comments — **no cursors**) · web offline tiles (offline maps go native-first later) · `meal_slot` tag + restaurant gap-fill · "Why this order?" rationale · native MapLibre vector swap (D3) · route share-image · e2e/Playwright re-enablement.

---

### ✅ RESUMED & COMPLETED 2026-06-10 — Phases 0.5 → N3 all shipped
The 2026-06-10 session-limit checkpoint was resolved: Wave 2 work was inspected, gate-verified, and committed (`cb2e9c4` UI, `6313d2a` backend); Wave 3 (N3.4/3.5) then shipped the real Plan-my-trip flow.

**⚠ USER ACTIONS REQUIRED before the new features run live:**
1. Apply migrations 0019 + 0020: `npx supabase db push --linked` (or local `npx supabase db reset`).
2. Set Edge Function secrets: `npx supabase secrets set GEMINI_API_KEY=… GROQ_API_KEY=…` (AI returns a friendly `ai_misconfigured` banner until then).
3. Deploy the new function: `npx supabase functions deploy ai-itinerary`.
4. Dashboard (manual, see `supabase/migrations/README-v2.md`): Resend SMTP under Auth→SMTP; Google provider under Auth→Providers (OAuth button shows a friendly fallback until configured).
5. GitHub repo secrets for keep-alive: `SUPABASE_KEEPALIVE_URL`, `SUPABASE_ANON_KEY`; run `keepalive.yml` once via workflow_dispatch.
6. Web smoke (manual, no key needed for most): Home hero/countdown/CTA → `/trip/plan` form → `ai_misconfigured` banner; timeline chips + day start-time; Ideas section; comments sheet; sample trip; OAuth fallback message. With keys: the full A1 golden path (8 steps listed in the Wave-3 report / `docs/smoke/` to-be).

### Change history
- 2026-06-09 — log created; Phase 0.1 started.
- 2026-06-09 — Phase 0.1 ✅ (cost_per_km retired, time-first; tsc + jest verified).
- 2026-06-09 — Phase 0.2–0.4 ✅. **Phase 0 DONE**, committed. Holding before SDK upgrade.
- 2026-06-10 — User guidance captured: real product, core loop, flexible & friendly → `ux-principles.md` + plan Constraint #6 + memory.
- 2026-06-10 — **Fable review panel (5 lenses) + synthesis** → plan v2.1: three-track resequence (god-screen split before sync engine; ~40% un-parked from the D1 hold); WEB BETA milestone; new P0s (timeline/ETAs, place comments, AI draft-review, parity checklist); C1 refined (`manual_rank` user-order vs server-computed order); cuts (web offline tiles, cursors, meals table, 8.3); Phase 0.5 debt sweep queued; D6 resolved (GitHub Actions pinger); D2+D4 flagged now-blocking. BUILD-LOG restructured to N/S/P tracks.
- 2026-06-10 — **Phases 0.5 + N1 + N2 + N3 SHIPPED** (commits `7572d32`, `ada5d6d`, `13f17bf`, `cb2e9c4`, `6313d2a`, +Wave 3). All gates green throughout (tsc baseline-identical; jest 25 suites / 268 tests). Session-limit interruption mid-Wave-2 recovered with zero loss. **Next:** user actions above (migrations/secrets/dashboard) + web smoke; then **N4 (AI editing + import)** ⏸ or **N5 (free maps)** ⏸ D2 or **S1 (SDK epic)** ⏸ D1.
