# Tripvisor v2 — Master Plan (0 → ship)

> **Status:** v2.1 roadmap (2026-06-10) — **Fable-revised** after a 5-lens Fable review panel (product/UX, architecture, sequencing, feature-gaps, debt). Supersedes the 2026-06-09 16-phase plan.
> Detail docs: [`docs/v2/architecture.md`](docs/v2/architecture.md) · [`docs/v2/features.md`](docs/v2/features.md) · [`docs/v2/tech-stack.md`](docs/v2/tech-stack.md) · [`docs/v2/migration.md`](docs/v2/migration.md) · [`docs/v2/risks-and-decisions.md`](docs/v2/risks-and-decisions.md) · [`docs/v2/ux-principles.md`](docs/v2/ux-principles.md) · step tracker: [`docs/v2/BUILD-LOG.md`](docs/v2/BUILD-LOG.md)
> **All sub-agents and the orchestrator run on Opus 5.5 (`model: opus`, switched 2026-09-28).** `test-specialist` is disabled (token-saving); the per-phase verification gate below replaces it.

## Vision

*Describe your trip in words, plan it offline, and let the time-first optimizer route your days — for free.*

## Constraints

1. **Free only** ($0 ceiling at hobby scale).
2. **Greenfield, reuse the gold** (optimizer, RLS + `user_can_access_trip()`, **10** Edge Functions, schema core).
3. **Time-first** (`cost_per_km` retired in 0.1; **and the UI must actually show times** — per-day start time + computed arrival/departure per stop).
4. **Google ToS** (no place-content persistence; keys server-side).
5. **All three platforms** (iOS · Android · Web) verified before a feature is Done.
6. **User-first UX** — core loop (**choose places → read reviews/comments → find & adjust the optimal route on the map**) stays flexible and friendly; AI produces **editable drafts, never locked itineraries**; undo is a first-class requirement. See [`docs/v2/ux-principles.md`](docs/v2/ux-principles.md).

## What the Fable revision changed (vs the 2026-06-09 plan)

- **Re-sequenced into three tracks** — a **Now-track** (SDK-independent, starts immediately; ~40% of the plan was needlessly parked behind D1), an **SDK-track** (needs D1), and a **Post-track**. God-screen split now lands **before** the sync engine (tech-stack.md already required this; the old phase table contradicted it).
- **Web Beta milestone** after the Now-track — Cloudflare Pages is free/instant; real users see the new nav + AI planning + free maps **months before native GA**, on SDK 52.
- **New P0 features**: itinerary **timeline with computed ETAs**; **per-place collaborator comments**; **AI draft-review screen** (accept/remove/swap before commit + undo-after-apply); **v1 feature-parity checklist** protecting share/.ics/print/duplicate/export/notes/reactions through the rewrite.
- **C1 refined**: *user-intent order* (`manual_rank`, client-writable, LWW-synced) is split from *optimizer-computed order* (`day_index`/`order_in_day`/`trip_legs`, server-only). Offline drag works and is never silently lost; `route_render_mode` picks which renders.
- **Cut/deferred**: web offline map tiles (wrong platform — the offline user is on native), realtime cursors (presence dots suffice), `trip_meals` table (→ a `meal_slot` tag, post-GA), "Why this order?" (first-to-cut P2). 16 phases → **12 + post-GA backlog**.
- **Debt sweep (0.5) before anything else** — incl. the **live analytics 10-trip bug** (interim fix now, not Phase 13), stale e2e labels, doc contradictions, CI posture for the SDK upgrade.

## Phase plan

> **Verification gate (every phase, tester disabled):** ① `tsc` baseline-identical ② existing Jest suites green (CI required check stays green) ③ 10-min scripted web golden-path smoke logged in `docs/smoke/` ④ Sentry clean of new runtime errors ⑤ real-device smoke only where native surface is touched (S1, S2, P4). **Native spot-check cadence:** one EAS dev-client build + 15-min native smoke every 2–3 phases (~5 of 30 builds/mo) — never park all native verification at the end (that was v1's exact failure mode).

### Now-track — starts immediately, SDK 52, all OTA-able

| Phase | Title | Goal | Needs |
|---|---|---|---|
| **0.5** | Debt sweep & hygiene | Commit uncommitted blueprint docs; fix planner-model + v2 doc contradictions; delete stray artifacts + `.gitignore`; fix stale e2e "Cost ↓" labels; delete `useCollaboratedTrips` (zero callers); **interim analytics fix** (single `useQueries` over all trips — live bug); v1-docs "superseded" banner pass; CI posture statement (Jest required through SDK upgrade) | — |
| **N1** | Nav backbone + core-loop UX | Split the **2442-line** `trip/[id]/index.tsx` into route segments; Home/Discover surface; desktop-web layouts; **itinerary timeline** (editable per-day start time + computed arrival/departure chips per stop — pure client math over `trip_legs`); **Ideas/wishlist** surface (promote `day_index=null` bucket); onboarding + sample trip; Google OAuth button; trip-countdown card; **comments UI** inline on place cards; **v1 parity checklist enforced** (print/.ics/share/duplicate/export/notes/reactions survive the split) | 0.5 |
| **N2** | Backend adoption (free Supabase features) | Realtime publication on synced tables; Storage buckets (RLS); pg_cron: 30-day leg-TTL purge + **analytics MV** (folded from old P13); **external keep-alive via GitHub Actions cron** (a pg_cron heartbeat can't defeat the pause it's subject to); Resend SMTP; Google OAuth config; **`trip_place_comments` schema** (author, body, RLS via `user_can_access_trip`, append-only → conflict-free) | — (parallel with N1) |
| **N3** | AI core — "Plan my trip" | `ai-itinerary` Edge Fn (Gemini 2.5 → Groq, `responseSchema`); grounding loop (location-biased; **partial-grounding UX** — "couldn't find these N places", never silent drops); **per-user quota table that doubles as the usage ledger from day one** (AI runs + grounding + routing counters); idempotency key per run in `trip_ai_runs`; **draft-review screen** — result lands as a DRAFT with per-place keep/remove/swap + day reassign, committed only on accept, one-tap undo after apply; quota-exhausted UX defined | D4 |
| **N4** | AI editing + import | NL edits as **previewable diffs** (accept/reject, undo); smart gap-fill that **draws from Ideas first** (cuts metered grounding calls); **import a places list** (pasted names / Google Takeout CSV → grounding loop → Ideas bucket) | N3 |
| **N5** | Free maps (web) + kill switches | `Map.web.tsx` → MapLibre + OpenFreeMap (preserve dayColor/dashed/markers/region-fit — more than cosmetic); re-point `distance-matrix`→ORS/OSRM `/table`, `directions-polyline`→`/route` (contracts unchanged); health-check + auto-failover; **`app_config` runtime kill-switches** (map provider, routing provider, sync-engine per entity — env vars are baked at build and can't steer shipped clients) | D2 |

**🚀 Milestone: WEB BETA** — deploy to Cloudflare Pages after N5. New nav + timeline + comments + AI planning + free maps, on SDK 52, zero EAS builds spent.

### SDK-track — starts when D1 lands (can overlap the Now-track's tail)

| Phase | Title | Goal | Needs |
|---|---|---|---|
| **S1** | SDK epic 52→53→54 | One epic, **two checkpoints** (52→53: React 19, Reanimated v3 · 53→54: New Arch, Reanimated v4 + worklets). **Pure upgrade — no feature work mixed in** (chart swap moved to P3); `react-native-maps` pinned 1.21+, Android marker check on device; Jest green required at each checkpoint; budget EAS builds (Android validates free via local `expo run:android`) | D1 |
| **S2** | Offline engine (old 4+5 merged) | **Staged**: (a) read-only hydration of ALL entities first → (b) writes per entity starting low-risk; Legend-State v3 + expo-sqlite (**expo-sqlite pinned — MMKV ambiguity removed**); durable write-queue + optimistic + rollback; **undo stack designed into the mutation layer** (place remove, day reassign, reorder, optimize-overwrote, AI-apply); `manual_rank` (C1-refined) so **offline drag survives reconnect** ("pending route recompute", never reverted); C3 Tier-1 write-allowlist + ESLint guard + test; sync-status UI; persister retirement + v1-user migration; sync telemetry (queue depth, conflict rate) as Sentry breadcrumbs; **abort gate**: if trips+places aren't green (round-trip + C1 + C3 tests) in the first slice → switch to the named hand-rolled expo-sqlite fallback | S1 |

### Post-track

| Phase | Title | Goal | Needs |
|---|---|---|---|
| **P1** | Optimizer & route-adjust | Time-windows (user-confirmed `arrive_after`/`leave_before`) + **user-facing conflict warnings** ("arrives 18:40, closes 18:00" — computed against Tier-2 live hours, never persisted) + override; real multi-leg transit; per-day start/end anchor UX; preserve + polish "Best route vs My order" | N5 |
| **P2** | Depth: weather + packing + documents | Open-Meteo per-day forecast + rainy-day indoor swaps (pairs with gap-fill); packing lists; Storage-backed ticket/doc upload (RLS path-prefix guard) | N2, N3 |
| **P3** | Charts + analytics | gifted-charts (needs React 19) across analytics + budget; wire the N2 analytics MV (cap properly fixed server-side) | S1, N2 |
| **M4** | Mobile-first experience & useful features (X-track, planned 2026-09-28; not Monetization) — **🟡 code-complete 2026-09-29** (`b43a606`, `38b056e`, `8dd2ae4`); X3.4 go-live pending user | Bottom-tab shell; a **Today** live-trip view (next stop, ETA, Navigate, check-off); phone-first trip detail (Plan/Map/Trip hub, FAB quick-add) and itinerary; budget, stays and packing usability; offline writes for expenses and packing; **S2.8 flip folded in** (local/APK in X1.3, live in X3.4); brand assets plus an Android preview APK; onboarding, legal pages, sharing polish, a dark-mode sweep. 3 waves, 12 steps; see BUILD-LOG §M4 | S2 (code), P3 |
| **P4** | Native parity + push | iOS+Android EAS builds + native smoke checklist; Expo Push with **defined content** (trip countdown, collaborator activity, day-before weather); Sign-in-with-Apple (App Store requires it once Google OAuth exists); WCAG 2.2 AA + desktop polish | S1, S2 |
| **P5** | Launch hardening | **DROP `trips.cost_per_km`** (grep-gated); quota/cost counters → simple threshold alerts (ledger exists since N3; this is presentation only); final smoke; deploy; docs sign-off | all |

**🚀 Milestone: NATIVE GA** — after P4.

### Post-GA backlog (explicitly deferred, not deleted)
Realtime co-edit upgrade (presence **dots** + live `postgres_changes` + live comments — **no cursors**); web offline map tiles (offline maps re-scoped **native-first** once native MapLibre lands); `meal_slot` tag + restaurant gap-fill; "Why this order?" AI rationale; native MapLibre vector swap (D3); route share-image.

## Critical path

**Now:** `0.5 → N1 → N3 → N4 → N5 → WEB BETA` (N2 parallel).
**Then:** `D1 → S1 → S2 → P4 → P5 → NATIVE GA` (P1–P3 slot between).

## Open decisions — triaged by urgency

| # | Decision | Blocks | Status |
|---|---|---|---|
| **D4** | Gemini free-tier training posture (send only user text + place names) vs paid Vertex | **N3 — now-blocking** | recommend: accept free tier, data-minimized |
| **D2** | Routing: ORS free API (recommended, low-ops) vs self-host OSRM | **N5 — now-blocking** | recommend: ORS + Google env-flag fallback |
| **D1** | SDK 52→53→54 timing | S-track only (Now-track unaffected) | recommend: green-light when N1 is underway |
| ~~D6~~ | 7-day pause keep-alive | — | **resolved**: GitHub Actions cron pinger (pg_cron is self-referential) |
| D3 | Native MapLibre deferral | P4/post-GA | recommend: accept deferral |
| D5 | PostHog opt-in | P3 | can wait |

## Addendum (2026-06-11) — new tracks per user direction

- **T1 Editable timeline** — users edit the schedule directly via **pinned arrival times** (`trip_places.pinned_start`, migration 0025) on top of the already-editable visit durations, day start times, time windows, and move-to-day. Lands in the first UI wave after the visual redesign. Spec: features.md §L5; steps: BUILD-LOG §T1.
- **M-track Monetization (post-GA)** — decision locked: **subscriptions-first freemium** (RevenueCat free-tier native IAP + Stripe web), the C4 AI quota is the pricing lever, enforcement stays server-side, core loop free forever; ads only as an optional free-tier experiment later. Full plan: [`docs/v2/monetization.md`](docs/v2/monetization.md); phases M1–M3 in BUILD-LOG.
- **GO-LIVE track** — the $0 cloud deployment runbook (Supabase Cloud free + Cloudflare Pages + auth config + keep-alive + live smoke): [`docs/v2/deployment.md`](docs/v2/deployment.md); steps G1–G5 in BUILD-LOG. Output: a public, shareable web beta URL.

## Done so far

- ✅ Phase 0 (2026-06-09): `cost_per_km` retired (time-first), env v2 vars, conventions, gold untouched — committed & pushed (`714eea8`, `5411607`, `a990187`).
- ✅ Fable review panel (2026-06-10): 5 lenses + this synthesis; plan re-sequenced, features/architecture revised. See BUILD-LOG.
- 🟡 M4 (2026-09-28/29): Waves 1–3 code-complete (`b43a606`, `38b056e`, `8dd2ae4`; tsc 1341→1109, jest 72 suites / 625 tests). X3.4 go-live (cloud push, deploys, `sync:validate`, EAS APK) is pending the user — see BUILD-LOG §M4.
