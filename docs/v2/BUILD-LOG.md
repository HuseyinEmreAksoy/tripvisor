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
| Analytics 10-trip cap (comment claims 20, wires 10 — **live silent-data-loss bug**) | ☐ | **0.5** interim fix · P3 proper (MV) |
| Stale e2e "Cost ↓" assertions (`phase-11-12-trips-list.spec.ts`, `phase-21-budget.spec.ts`) | ☐ | **0.5** |
| `useCollaboratedTrips` + `tripCollaboratorsKeys.mine` (zero runtime callers; deferral #3) | ☐ | **0.5** |
| Stray artifacts (`*-fresh.txt`, `e2e-final.txt`, malformed tsc-output) + `.gitignore` gaps | ☐ | **0.5** |
| v1 docs contradict v2 (cost model, Cost sort, useCollaboratedTrips) | ☐ | **0.5** banner · full rewrite per-phase |
| v2 doc contradictions (features B2 "CRDT", "~1000-line" vs 2442, MMKV ambiguity, planner "inherit" claim) | ✅ 2026-06-10 | fixed with the panel synthesis (0.5e) |
| Uncommitted blueprint (ux-principles.md, planner.md→fable, this revision) | ☐ | **0.5** commit |
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

## Phase 0.5 — Debt sweep & hygiene  (NEXT — no decision needed, ~half day)
- ☐ **0.5a Commit the blueprint** — this revision + `ux-principles.md` (untracked!) + `planner.md` inherit→fable; plan-v2 "planner stays inherit" contradiction fixed by the v2.1 rewrite. _(git-committer)_
- ☐ **0.5b Hygiene commit** — delete `e2e-final.txt`/`e2e-fresh.txt`/`jest-fresh.txt`/`tsc-fresh.txt` + malformed `C…tsc-output.txt`; `.gitignore`: `*-fresh.txt`, `e2e-*.txt`, `tsc-output.txt`, `.claude/scheduled_tasks.lock`; fix e2e "Cost ↓"→"Duration ↓" (`phase-11-12-trips-list.spec.ts:99-135`) + dead "Travel cost" comment (`phase-21-budget.spec.ts:80`); delete `useCollaboratedTrips` (`trip-collaborators.ts:239`) + `tripCollaboratorsKeys.mine` (`_keys.ts:123`) + README ref. _(backend)_
- ☐ **0.5c Analytics interim fix** — replace the 10 hand-rolled `useTripPlaces` hooks in `app/(app)/analytics.tsx:76-97` with one `useQueries` over ALL trip ids (~20 lines, no schema); fix the lying "first 20" comment. Proper MV fix lands P3. _(ui)_
- ☐ **0.5d v1-docs banner pass** — 3-line "v1 historical record — superseded by docs/v2; cost_per_km/Cost-sort/useCollaboratedTrips retired" banner on `docs/architecture.md` + `docs/features/{cost-and-print,expenses,trip-crud,collaboration}.md`. Full rewrites happen per-phase. _(docs)_
- ✅ **0.5e v2 self-contradiction fixes** (done 2026-06-10, with the panel synthesis) — features.md B2 "CRDT" → `manual_rank` wording; "~1000-line" → 2442 everywhere; expo-sqlite pinned (MMKV removed from diagrams); plan-v2 "planner stays inherit" claim fixed by the v2.1 rewrite.
- ☐ **0.5f CI posture** — paragraph in conventions.md: Jest = required check through S1 (jest-expo bumped per SDK step); ci.yml tsc job is `continue-on-error` (state it or make it required); align the Playwright TODO with the new phase names; amend "keep test files compiling" → "passing or explicitly `test.skip`-ed with a tracked reason". _(docs/backend)_

## Now-track  (SDK 52, OTA-able, starts after 0.5)

### N1 — Nav backbone + core-loop UX  _(ui-heavy; the user's #1 visible win)_
- ☐ 1.1 Split `trip/[id]/index.tsx` (**2442 lines**) → route segments: map / itinerary / settings / budget / collab; **v1 parity checklist gates the split** (print, .ics, share, duplicate/archive, account export, notes, reactions, cover photos, location routing all survive)
- ☐ 1.2 **Itinerary timeline** — editable per-day `start_time` (default 09:00) + computed arrival/departure chips per stop (cumulative legs + visit minutes; pure client math)
- ☐ 1.3 Home/Discover surface (hosts "Plan my trip" CTA) + trip-countdown card
- ☐ 1.4 **Ideas/wishlist** — name the `day_index=null` bucket; one-tap promote-to-day
- ☐ 1.5 Onboarding: first-run welcome + pre-built sample trip (core-loop demo before any API key burns)
- ☐ 1.6 Google OAuth sign-in button (config in N2) — magic-link-only rides Resend's 100/day cap
- ☐ 1.7 **Comments UI** inline on place cards/detail (schema in N2)
- ☐ 1.8 Desktop-web layouts per segment; explicit back affordances everywhere

### N2 — Backend adoption  _(parallel with N1)_
- ☐ 2.1 Realtime publication on synced tables
- ☐ 2.2 Storage buckets `trip-docs` + `user-uploads` (private, RLS via `user_can_access_trip`)
- ☐ 2.3 pg_cron: 30-day leg-TTL purge + **analytics MV** (folded from old P13.1)
- ☐ 2.4 **Keep-alive: GitHub Actions cron pinger** (D6 resolved) — not pg_cron
- ☐ 2.5 Resend SMTP + Google OAuth provider config
- ☐ 2.6 **`trip_place_comments`** migration (id, trip_id, place_id, author_id, body, created_at, deleted; RLS; append-only → conflict-free) + TanStack hooks

### N3 — AI core: "Plan my trip"  ⏸ D4
- ☐ 3.1 `ai-itinerary` Edge Fn (Gemini 2.5-flash → Groq gpt-oss-20b, `responseSchema`)
- ☐ 3.2 Grounding loop — location-biased; **partial-grounding UX** ("couldn't find N places" → user fix-up, never silent drops); LLM coords never trusted
- ☐ 3.3 **Quota table = usage ledger from day one** (per-user AI runs + grounding + routing counters; C4) + idempotency key per run in `trip_ai_runs` (retries reuse the stored draft, never double-bill)
- ☐ 3.4 **Draft-review screen** — DRAFT staging (not written to `trip_places`), per-place keep/remove/swap + day reassign, commit on accept, **one-tap undo after apply**; quota-exhausted state defined
- ☐ 3.5 "Plan my trip" UI on Home

### N4 — AI editing + import  ⏸ D4
- ☐ 4.1 `ai-edit` NL edits as **previewable diffs** (accept/reject + undo)
- ☐ 4.2 Gap-fill suggestions — **draw from Ideas first** (saves metered grounding), Tier-2 memory-only until accepted
- ☐ 4.3 **Import places list** — pasted names / Google Takeout CSV → grounding loop → Ideas bucket (counts against quota)

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

### Change history
- 2026-06-09 — log created; Phase 0.1 started.
- 2026-06-09 — Phase 0.1 ✅ (cost_per_km retired, time-first; tsc + jest verified).
- 2026-06-09 — Phase 0.2–0.4 ✅. **Phase 0 DONE**, committed. Holding before SDK upgrade.
- 2026-06-10 — User guidance captured: real product, core loop, flexible & friendly → `ux-principles.md` + plan Constraint #6 + memory.
- 2026-06-10 — **Fable review panel (5 lenses) + synthesis** → plan v2.1: three-track resequence (god-screen split before sync engine; ~40% un-parked from the D1 hold); WEB BETA milestone; new P0s (timeline/ETAs, place comments, AI draft-review, parity checklist); C1 refined (`manual_rank` user-order vs server-computed order); cuts (web offline tiles, cursors, meals table, 8.3); Phase 0.5 debt sweep queued; D6 resolved (GitHub Actions pinger); D2+D4 flagged now-blocking. BUILD-LOG restructured to N/S/P tracks.
