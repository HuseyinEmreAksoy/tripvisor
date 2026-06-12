# Tripvisor v2 — Build Log (every step, stored)

> **Purpose:** the canonical, persistent tracker for the v2 rewrite. Every step is listed here with status; updated after each step so progress survives across sessions.
> **Legend:** ✅ done · 🟡 in progress · ☐ todo · ⏸ blocked (needs decision) · ⏭ deferred
> **Process notes:** `test-specialist` is **DISABLED** (renamed `test-specialist.md.disabled`). The **verification gate** below replaces it. All agents + orchestrator run on **Fable**.
> Plan: [`../../plan-v2.md`](../../plan-v2.md) (v2.1, Fable-revised 2026-06-10) · Risks: [`risks-and-decisions.md`](risks-and-decisions.md) · UX bar: [`ux-principles.md`](ux-principles.md)

## Verification gate (every phase, tester disabled)
① `tsc --noEmit` baseline-identical · ② existing Jest suites green (**CI required check stays green — incl. through the SDK upgrade**) · ③ 10-min scripted web golden-path smoke → `docs/smoke/` · ④ Sentry clean of new runtime errors · ⑤ device smoke only for native-touching phases (S1, S2, P4). **Native spot-check cadence:** 1 EAS dev-client build + 15-min smoke every 2–3 phases (~5 of 30 builds/mo).

## ⏸ Decision gates (triaged 2026-06-10)
- ⏸ **D4 Gemini posture** — **now-blocking** (N3). Recommend: accept free tier, send only user text + place names.
- ✅ **D2 RESOLVED 2026-06-10** — openrouteservice free API primary (user choice), Google automatic in-request fallback + kill-switch row.
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

### ✅ N5 — Free maps (web) + kill switches  (DONE 2026-06-10; D2 RESOLVED = **ORS**; gates: jest 25/268, deno 15/15, expo web export clean)
- ✅ 5.1 Web map → **MapLibre GL + OpenFreeMap** (no key, default provider): `Map.web.tsx` = thin dispatcher (`providerOverride` → `app_config.map_provider_web` → env → 'maplibre'); Google preserved as `GoogleMap.web.tsx`; new `MapLibreMap.web.tsx` (271 lines) — dayColor pins **+ order badges** (Google web lacked numbers), keyboard-accessible press, GeoJSON day-colored polylines, `line-dasharray` transit, fitBounds+late-fit, **ODbL attribution visible**. Deps: maplibre-gl@5 + react-map-gl@8 + @vis.gl/react-maplibre (Metro `exports` workaround). Engine = on-demand async chunk (269KB gz, only when a map mounts). Bonus fix: my-location virtual leg now renders on web.
- ✅ 5.2 ORS adapter in `distance-matrix` + `directions-polyline` via shared `_shared/routing.ts` — **contracts byte-unchanged**, [lng,lat] handled, polyline5 verified against the actual client decoder; **transit always Google** (ORS has no transit profile).
- ✅ 5.3 Auto-failover: any ORS failure → Google in-request (logged `provider_fallback`); 3-strikes/5-min circuit breaker; provider default **'google' until the user flips** (zero unconfigured behavior change).
- ✅ 5.4 `app_config` (migration **0022**; SELECT anon+authenticated, **no write policies** — the dashboard row IS the kill switch) + `useAppConfig()` hook (graceful `{}` pre-migration). `routing_provider` row beats env, ~60s propagation, redeploy-free.
- ⏭ debt: `e2e/web/phase-4-polish.spec.ts` check 2 ("Map unavailable without key") is invalid by design under maplibre default — pin `EXPO_PUBLIC_MAP_PROVIDER=google` in the Playwright env or rewrite the assertion when e2e re-enables.

**🚀 WEB BETA milestone REACHED (code-side) — Cloudflare Pages picks up master; go-live items in the user-action checklist.**

## SDK-track  ⏸ D1

### ✅ S1 — SDK epic 52→53→54  (CODE-COMPLETE 2026-06-11, commits `7cacb56` A + `4ceae19` B; ⏸ DEVICE SMOKE OWED — D1 approved by user)
- ✅ S1.1 **Checkpoint A**: Expo 53.0.27 / RN 0.79.6 / React 19 / expo-router v5 / TS 5.8; reanimated stayed v3; 4 mechanical fixes (expo-image placeholder→bg, RN0.79 aria props, TanStack functional updaters, expo-asset dep). Gates: expo-doctor **18/18**, tsc 0 new, jest 25/268, web export clean.
- ✅ S1.2 **Checkpoint B**: Expo 54.0.35 / RN 0.81.5 / React 19.1 / **Reanimated 4.1.7 + worklets 0.5.1** (babel: explicit plugin REMOVED — preset auto-registers worklets; double-registration defused with source evidence) / **maps forced ^1.21→1.27.2** (+ expo.install.exclude) / sentry 7 / **expo-router v6** (came with 54, contrary to pre-research — runtime nav on the smoke list) / expo-file-system v19 → 2 legacy-shim call sites. draggable-flatlist on Reanimated 4 = compatible-by-evidence (symbols verified), device = true verdict. Gates: doctor 18/18, tsc byte-identical (1195), jest 25/268, export clean.
- ⏸ S1.3 **USER DEVICE SMOKE (mandatory before native GA; NEW dev-client build required — old one will crash):** ① Android map markers (the ^1.21 reason) ② iOS map ③ drag-reorder (Reanimated-4 risk) ④ Hanken Grotesk loads ⑤ OAuth round-trip ⑥ expo-router v6 nav incl. share/invite cold-start deep links ⑦ sheets/animations (new engine) ⑧ ICS/account-export share sheets ⑨ Sentry 7 init. Android free via local `expo run:android`; reserve EAS for iOS.
- **Unblocked by S1:** P3 charts (gifted-charts needs React 19 ✓) + the victory-class ecosystem generally.

### S2 — Offline engine (old Phases 4+5 merged; staged) — WAVES 1–3 DONE 2026-06-12 (flag still OFF; S2.8 flag-flip remainder below)
- ✅ S2.1 **Migration 0027** (applied locally; columns psql-verified): `handle_times()` server-stamping replaces `set_updated_at` on the 8 Tier-1 roots; `deleted` tombstones where missing (NOT on trips — archived_at IS its lifecycle, documented); **`trip_places.manual_rank`** (fractional index, client-writable — C1 refinement); trip_days got created/updated_at; realtime publication completed (trips + reactions + packing added); `*_updated_at_idx` indexes for incremental pulls. trip_legs deliberately excluded from Tier-1 (R4: 30-day ToS TTL must never re-sync from clients).
- ✅ S2.2 **Read-only hydration foundation** (`src/sync/`, 9 files + flags **default OFF** — env `EXPO_PUBLIC_SYNC_TIER1=1` or app_config `sync_tier1='on'`; inert no-ops otherwise, zero user-facing change): Legend-State **3.0.0-beta.47 pinned exactly** (R6) + expo-sqlite ~16 (native module — rides the pending S1 dev-client rebuild; web = OPFS with graceful in-memory degrade + `syncDegraded` telemetry per R5); **engine decision: syncedSupabase plugin** (contract maps 1:1: changesSince:'last-sync' on server-stamped updated_at, fieldDeleted tombstones, transform.load = the C3 boundary; hand-rolled fallback stays contained to hydrate.ts only); per-user persist namespacing (`tier1/<userId>/<table>` — kills watermark poisoning + cross-account leakage); reconnect = always force-pull (LegendApp#362); writes DISABLED (`actions:['read']`).
- ✅ S2.3 **C3 guard live**: `allowlist.ts` — default-deny TIER1_FIELDS (compile-time bound to row types), `sanitizeForTier1` (throw→strip-with-telemetry), restricted-name tripwire (rating/reviews/photos/hours/phone/website/attribution + substrings; `*google_place_id` sanctioned exception), network half = `tier1SelectColumns` (restricted columns never requested) + **45-test jest suite green** (suite now 26/313). ESLint rule deferred to Wave 2 (lint infra broken repo-wide; runtime guard + tests are the real gate).
- **Abort-gate (R6) assessment so far:** beta plugin viable — its API matched the design 1:1 with no fights; the TRUE verdict comes at Wave 2's first write round-trip (trips+places slice). Wave 1 was interrupted by a session limit at ~95% — orchestrator completed the test suite + 6 type fixes (dup declaration, unknown-bridge casts).
- ✅ S2.4 **WAVE 2 (2026-06-12): writes live for the trips+trip_places slice** (`actions: ['read','create','update']`; other 6 roots stay read-only). `TIER1_WRITE_FIELDS` + `sanitizeForTier1Write` = the **C1 write firewall** — and it's LOAD-BEARING, not belt-and-braces: the beta plugin hard-codes `updatePartial:false` (full row on every UPDATE), so hydrated `day_index`/`order_in_day`/`updated_at` would echo back without it. Tombstone-deletes (plugin never hard-deletes with fieldDeleted; payload bypasses transform.save — both fields allowlisted). `trips.user_id` session-stamped at the boundary (never client-writable). Retries: infinite exp-backoff 30s cap; `retrySync:true`. **Queue durability honesty (R5): survives restarts only where SQLite attached** (native post-dev-client-rebuild; web after COOP/COEP) — in-memory degrade = retries die with the process. Suite 26/329 (sync 61/61). Wave-1 latent bug found+fixed (degraded persist config crashed loadLocal).
- ✅ S2.9 **ABORT GATE: R6 VERDICT = GO** — `npm run sync:validate` (NEW script, runs the REAL src/sync modules against the live local stack): **7/7 PASS** — engine boots in node · CREATE→server-stamped row · forged client updated_at ignored · manual_rank persists with day_index/order_in_day NULL (C1) · dirty write (day_index+rating) reaches server as NEITHER (28 server-only strips + 2 ToS violations telemetered) · tombstone excluded from fresh hydration · later server edit wins LWW after resync. Self-cleaning.
- **Beta findings for Wave 3** (from plugin source, live-verified): app code must mint client UUIDs and NEVER set created_at on creates (it's the plugin's create/update discriminator); write creates COMPLETE (an update racing its own unacked create can no-op); avoid custom create/update params (beta.47 wrapSupabaseFn bug); flip legacy hard-delete hooks to tombstones; add `eq('deleted',false)` to remaining direct reads; `_headers` COOP/COEP on Pages to un-degrade web persistence.
- ✅ S2.5 **WAVE 3a (2026-06-12, commit `5b830a1`): mutation layer + undo stack + auth lifecycle.** `mutations.ts` — createTrip/updateTrip/tombstoneTrip + place equivalents, every mutation returns an `UndoEntry`; `setPlaceManualRank` + snapshotRanks/restoreRanks (whole-day reorder inverse); client-minted UUIDs and **created_at NEVER set** (it's the beta plugin's create/update discriminator); `isTier1SyncActive` gate + `SyncWriteError`. `rank.ts` — base-62 fractional index (`rankBetween`: 'V' first, append-after-'z', suffix exhaustion mid-rank). `undo.ts` — UndoStack (LIFO, capacity 20, useSyncExternalStore-subscribable) + session stack + `useUndo`; the undo BUTTON/toast lands at flag-flip. Auth lifecycle (the S2.8 half that couldn't wait): `initTier1Sync` on sign-in, `teardownTier1Sync` on sign-out — teardown gates writes but **never clears write-enabled stores** (clearing would diff as mass tombstones); same-user resume vs different-user restart-required. Telemetry gained the reactive core (subscribeSyncStatus/version/useSyncStatus). Sync suite 78 tests (rank + undo added). *(Agent died ~80% via API overload; orchestrator finished hydrate exports, auth wiring, telemetry core, 18× noUncheckedIndexedAccess bridge — zero loss.)*
- ✅ S2.6 **WAVE 3b (2026-06-12): offline drag semantics.** `dragRank.ts` (classifyMove / commitDragRanks / ensureDayRanks backfill for legacy NULL-rank rows); ItineraryTab dual-path drag — flag-on writes `manual_rank` via rankBetween + pushes undo; while online it ALSO fires legacy reorderDay so server `day_index`/`order_in_day` stay authoritative until the S2.8 repoint; offline the move **never reverts** (S2.6 contract): `dayOrderOverrides` keeps the visual order and a pendingRecompute set marks moved rows "⟳ route recompute pending" (PlaceRow pill), cleared when trip-legs `dataUpdatedAt` advances after reconnect optimize.
- ✅ S2.7 **WAVE 3b: sync-status surface.** `SyncStatusPill` mounted in the trips header (renders null when flag off — zero flag-off change): Sync issues(N) → Local-only (degraded) → Offline → Synced·age, powered by `useSyncStatus`. `pendingWrites` honestly ABSENT — the beta plugin exposes no queue-depth observable (documented limitation; per-entity `writeErrorCount` is the proxy). Dead-letter resolver UX deferred to flag-flip with the rest of the undo UI. Side fix: `BottomSheet.ts` neutral barrel killed 4 pre-existing TS2307s.
- 🔧 **WAVE 3b BLOCKER found + fixed: web export.** Since Wave 3a's auth wiring, `src/api/auth.ts → @/sync/hydrate → ./persistence` pulls expo-sqlite into the web bundle, and its `web/worker.ts → wa-sqlite.wasm` import broke `npx expo export --platform web` (no metro.config.js existed; lazy `require()` defers EVAL, not BUNDLING — Metro still walks it). Fix: new **`metro.config.js`** — default Expo config + `wasm` in `resolver.assetExts` + dev-server COOP/COEP middleware (**`credentialless`** COEP so cross-origin tiles/fonts survive). Production half still owed: `_headers` on Cloudflare Pages (until then web persistence degrades to in-memory per R5 — by design, not a bug).
- **Wave 3 gates (re-run post-fix):** web export clean (all routes) · tsc 1341 vs 1345 at HEAD (**−4 fixed, +0 new**) · jest 28 suites / 346 tests · `npm run sync:validate` **7/7 R6 still GO**.
- ☐ S2.8 (flag-flip phase) **Remainder**: UI repoint per entity (reads off the Tier-1 store, retire reorderDay dual-path) + persister retirement + v1-user migration + sign-out `clearPersist` policy decision + undo toast/button + issues-sheet resolver actions + `_headers` COOP/COEP on Pages (prefer `credentialless` — `require-corp` can break cross-origin tiles/fonts).

## Post-track

### ✅ P1 — Optimizer & route-adjust  (DONE 2026-06-10/11 except P1.3; commits `1d8b565` backend, `939949b` UI)
- ✅ P1.1 Time-windows: migration **0023** (`arrive_after`/`leave_before`, user-confirmed ONLY — never auto-filled from Google hours, ToS invariant in column comments + editor copy); `TimeWindowEditor` in PlaceActionsSheet; `computeDayTimeline` waits-push + `arrives_late`/`overruns` conflicts; non-blocking chips ("⏳ waits until 10:00", "⚠ arrives 18:40 — window ends 18:00"). **Scoping note:** warnings compare USER-SET windows (no live Google-hours fetches in lists — metered cost); optimizer hard-constraints deferred (pure optimizer untouched, by design).
- ✅ P1.2 Real multi-leg transit: directions-polyline returns `transitSteps` (additive; FieldMask incl. line names/vehicle); optimize-trip persists `trip_legs.transit_steps` (jsonb, rides the 30-day TTL purge); MapTab renders per-step (TRANSIT solid day-color, WALK dashed gray), byte-identical fallback when steps absent; itinerary connector shows "🚇 M2 → ~25 min". Side fixes: `MapPolyline.strokeColor` + unified dashed-with-points rule across all 3 providers (also fixed the invisible my-location leg on native).
- ⏭ **P1.3 anchors DEFERRED — concrete wiring gap found** (UI investigation): `trip_days.day_start_place_id/day_end_place_id` columns + pure-optimizer pin support EXIST, but (A) `optimize-trip` never reads `trip_days` → no `dayStartEnd` built (~line 343), and (B) `useUpdateTripDay`'s zod schema strips anchor columns (silent no-op). Follow-up = 2 small backend changes + ~1h UI. "Best route vs My order" preserved (parity).

### ✅ P2 — Depth  (DONE 2026-06-11; commits `e02aa23` backend, UI in the P2 commit)
- ✅ P2.1 Weather: keyless Open-Meteo `weather` Edge Fn + `useDayWeather`/`isRainy` (WMO codes documented); ONE centroid query per trip, **date-mapped** (never index); day-header chips ("☔ 18°"); rainy chip → GapFillSheet (Ideas-first indoor fix); **CC-BY attribution** "Weather data by Open-Meteo.com" whenever chips render; silently hidden out-of-horizon/on-error.
- ✅ P2.2 Packing: migration **0024** `trip_packing_items` + hooks (bulk create, optimistic toggle); pure `packingSeed.ts` (≤30 items, season buckets, rain gear when rainy — northern-hemisphere simplification documented); new `/trip/[id]/packing` route (grouped checklist, "N of M packed", suggest-dedupe, role-gated); SettingsTab entry.
- ✅ P2.3 Documents: `trip-docs` private bucket + **injection-safe path-parse RLS** (uuid validated before cast, fails closed; INSERT policy pins `storage_path_trip_id(path)=trip_id`); `trip_documents` metadata + hooks (object-first/row-second upload protocol, 60s signed URLs as MUTATION); SettingsTab section — view on all 3 platforms, **upload web-only** (native picker = forbidden new dep; muted note), 10MB pre-check, editor-gated delete.

### ✅ P3 — Charts + analytics  (DONE 2026-06-11; gates: tsc 1195 baseline-exact, jest 25/268, web export clean)
- ✅ P3.1 **gifted-charts** wrappers replace the hand-rolled SVG (Bar/Pie/Line; prop contracts byte-preserved + additive `grouped` for liked/disliked pairs; tokens-themed; `useReducedMotion`-gated animation; a11y data summaries). **Web verdict: PASS, single shared impl** — gifted's gradient dep is optional-peer and falls through to our existing expo-linear-gradient... (verified in the exported bundle; `react-native-linear-gradient` NOT added; gradients unused anyway). Fallback documented: resurrect old SVG as `.web.tsx` from git history if live smoke shows blanks.
- ✅ P3.2 **MV-first analytics** via new `src/api/trip-stats.ts` (`get_my_trip_stats` reader; [] on missing RPC): per-trip aggregates from the nightly MV, live client aggregation as fallback for MV-absent trips; category pie + place catalogs stay always-live (MV has no categories/names); "Aggregates refresh nightly." footnote when MV contributed. The v1 10-trip cap is now properly dead at any scale.

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
1. Apply ALL pending migrations **0019 → 0026** (incl. the 0026 optimize-mutex fix — optimize is broken on any deployment without it): `npx supabase db push --linked` (or local `npx supabase db reset`).
2. Set Edge Function secrets: `npx supabase secrets set GEMINI_API_KEY=… GROQ_API_KEY=…` (AI shows a friendly `ai_misconfigured` banner until then). For ORS routing: `npx supabase secrets set ORS_API_KEY=…` (free key at openrouteservice.org) then insert `app_config` row `('routing_provider','ors')` — instant, redeploy-free; kill-switch back = set the row to 'google'.
3. Deploy the functions: `npx supabase functions deploy ai-itinerary ai-edit distance-matrix directions-polyline optimize-trip weather` (P1/P2 added optimize-trip changes + the new weather fn). **Order: `db push` (0019–0024) BEFORE deploying optimize-trip** (its INSERT now writes `transit_steps`). Watch `db push` for storage-privilege NOTICEs on 0024 (manual Dashboard policy steps if they appear — see `supabase/migrations/README-v2.md`).
4. Dashboard (manual, see `supabase/migrations/README-v2.md`): Resend SMTP under Auth→SMTP; Google provider under Auth→Providers (OAuth button shows a friendly fallback until configured).
5. GitHub repo secrets for keep-alive: `SUPABASE_KEEPALIVE_URL`, `SUPABASE_ANON_KEY`; run `keepalive.yml` once via workflow_dispatch.
6. Web smoke (manual, no key needed for most): Home hero/countdown/CTA → `/trip/plan` form → `ai_misconfigured` banner; timeline chips + day start-time; Ideas section; comments sheet; sample trip; OAuth fallback message. With keys: the full A1 golden path (8 steps listed in the Wave-3 report / `docs/smoke/` to-be).

## 🧪 HOW TO TEST THE USABLE VERSION (verified 2026-06-11 — app boots & renders; screenshots taken)
The web app runs NOW via `npm run web` → http://localhost:8081 (login renders incl. Google OAuth button + travel hero; desktop + mobile layouts verified live). Sign-in/data need Supabase:
- **Option A — local (~10 min):** Start Docker Desktop → `npx supabase start` → `npx supabase db reset` (applies all 24 migrations) → restart expo. Magic-link emails land in Mailpit (http://localhost:54324). For AI + place search locally: put `GOOGLE_MAPS_SERVER_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` in `supabase/functions/.env` and run `npx supabase functions serve`.
- **Option B — cloud (the real beta):** point `.env` at a Supabase cloud project (currently it points at 127.0.0.1:54321!), then run the user-action checklist above (db push 0019–0024 → secrets → deploy 6 functions → dashboard Resend/OAuth). Cloudflare Pages then serves every push to master.
- **Key requirements honesty:** map RENDERING is keyless now (MapLibre/OpenFreeMap ✓), weather is keyless ✓, but the add-place flow needs `GOOGLE_MAPS_SERVER_KEY` (free credit) and AI needs the free Gemini/Groq keys — without them those surfaces show friendly setup banners.
- **First-smoke golden path:** sign up → "Try a sample trip" → timeline chips → Plan-my-trip (AI) → draft review → adjust route on map → comments/packing/weather.

## ✅ RUNTIME VERIFICATION (2026-06-11 — user's 503 diagnosed & fixed; every API live-tested)
**User-reported 503 on places-autocomplete — root causes found & fixed:** (1) the local edge-runtime container was stopped (vector log-shipper crash-loop is benign Docker-on-Windows noise; runtime restarted); (2) the containers predated the new functions → `supabase stop && start` recreated them (volumes preserved); (3) **the v2 migrations 0019–0024 had never been applied locally** (old April volumes — only 18/24) → `npx supabase migration up` applied them non-destructively.
**Live results (curl, local stack):** all 12 functions ping 200 · `places-autocomplete` returns real Google suggestions ✓ (503 gone) · `weather` returns a real 3-day Izmir forecast ✓ · `ai-edit action:ground` grounded "Kemeraltı Bazaar"/"Konak Pier" to real place IDs + ledger ticked + run audited ✓ (the grounding pipeline works end-to-end) · `ai-itinerary` correctly requires a real user JWT and, keyless, returns the designed `ai_misconfigured` envelope ✓.
**Remaining for full AI locally:** add `GEMINI_API_KEY` + `GROQ_API_KEY` to `supabase/functions/.env` (free keys) → AI planning/editing goes live. Test user seeded: `smoke-verify@test.local`.
**Lesson institutionalized:** container/migration drift between sessions is the local-dev failure mode — `npx supabase migration up` + a stack recreate is the standard fix; added to the test instructions above.

## ✅ VISUAL REDESIGN — "Tide & Terracotta" (DONE 2026-06-11; user-authorized full reskin)
22 files, 665+/473−. New design language: warm paper light / deep ink dark, Aegean-teal accent + terracotta secondary, bolder display typography + overline kickers, pill chips/buttons, borderless radius-18–24 cards with soft layered shadows, image heroes with scrims. Surfaces rebuilt: tokens foundation, Home/trips (hero + countdown + cards), trip detail (header/day groups/place cards/one-chip-language), AI plan flow (staged progress rail), primitives (Button/TextField/SegmentedControl/TabBar/EmptyState/StatusPill/BackButton), auth light-touch. **A11y upgrades**: WCAG AA re-verified both modes; `useReducedMotion` hook added and press/float animations now gate on it (previously unconditional). **Gates:** tsc identical vs pristine-HEAD worktree diff; jest 25/268. **Live-verified with authed screenshots** (Home hero + trip detail with working MapLibre route) — sent to user. Deferred: no real gradients (zero-dep scrims), map DAY_COLORS untouched, secondary surfaces (budget/accommodation/settings sheets) inherit via tokens — polish pass queued.

## 📋 NEW TRACKS (added 2026-06-11 per user direction)

### ✅ T1 — Editable timeline (pinned times)  (DONE 2026-06-11; gates: jest 25/268, tsc baseline-clean; migration applied locally)
- ✅ T1.1 Migration `0025` (`pinned_start time null`, ToS comment) + `types.ts` + `useUpdateTripPlace` schema (omit=untouched, null=unpin).
- ✅ T1.2 `computeDayTimeline`: pin applied before the window overlay — reachable pin = cursor jumps (downstream shifts); unreachable = `'pinned_tight'` conflict ("arrives 14:20 — pinned 14:00"), time never rewound; window conflicts outrank the pin message.
- ✅ T1.3 **Editor lives in PlaceActionsSheet** (`PinnedTimeEditor`, mirrors TimeWindowEditor: one HH:MM field, clear=unpin, friendly copy); the arrival chip renders pinned state (pin glyph + primary outline) with a11y "Arrival pinned to 14:00". *(Scope note: chip is indicator, not tap-target — the actions sheet is the established editing surface; direct chip-tap editing deferred.)*
- Already shipped & counted toward "users plan their days": visit-duration stepper ✓ · day `start_time` ✓ · time windows ✓ · move-to-day/Ideas promote ✓ · drag reorder ✓

### ✅ DESIGN SYSTEM v3 IMPLEMENTED  (2026-06-11, commit `87fdeb1` — from the user's Claude Design handoff bundle)
Hanken Grotesk (non-blocking load, system-stack fallback) · light teal retuned to `#0C8578` family + strengthened wash · hybrid **Lucide Icon system** (`src/components/Icon.tsx`, 1.75 stroke; emoji stays expressive) replacing functional glyphs in BackButton/PlaceRow comments/SettingsTab/PlaceActionsSheet · jest: lucide transform + expo-font mock. **Remaining icon spots** (tab glyphs, transport picker, tool chips, trips-header controls) → next UI wave. Live-verified with screenshots.
**Ops note (the user's 503/refresh report):** Docker-on-Windows **port-proxy desync** — containers healthy but no host listener on 54321/54322 after a Docker restart; fix = `docker restart supabase_kong_Tripvisor` (and `…_db_…` for 54322). Recorded because it WILL recur.

### M-track — Monetization (post-GA; plan: [`monetization.md`](monetization.md))
- ☐ M1 Entitlements foundation: `user_entitlements` migration + `useEntitlements()` + plan-aware quota constants in ai-* fns + Pro badge/paywall shell (admin-granted Pro for testing)
- ☐ M2 Payments: RevenueCat (native IAP, pairs with P4/native GA) + Stripe Checkout (web) + 2 webhook Edge Fns + restore-purchases
- ☐ M3 (optional) Free-tier AdMob experiment: trips-list banner only, consent flow, `app_config` kill-switch, measure before keeping
- **Decision locked:** subs-first freemium; the AI quota (C4) is the pricing lever; enforcement stays server-side; core loop free forever.

### GO-LIVE — free cloud deployment (runbook: [`deployment.md`](deployment.md)) — EXECUTED 2026-06-11
- ✅ G1 **Supabase Cloud LIVE**: project `nahywqbrdlkemdtjjxkc` (eu-central-1, org "advisor"); all **26 migrations** pushed (storage policies created clean); secrets set (GOOGLE_MAPS_SERVER_KEY, GEMINI_API_KEY, ALLOWED_ORIGINS incl. the pages domain — **GROQ_API_KEY still absent**); **all 13 functions deployed**. Routing stays Google default (`ORS_API_KEY` never provided — `routing_provider` row deferred until it is). Credentials (access token, db password, smoke-user password) in gitignored `supabase/.env`.
- ✅ G2a Auth URL config via Management API (site_url=https://tripvisor.pages.dev + allow-list incl. localhost) — 200. **G2b STILL MANUAL (dashboard): Resend SMTP** (built-in sender ≈2–4 emails/hr until then) **+ Google OAuth provider** (button shows fallback).
- ✅ G3 **Cloudflare Pages**: project `tripvisor` created (wrangler OAuth, user's account); production export built with cloud env baked in; **deployed via direct upload** (34 files) → https://2cb76257.tripvisor.pages.dev / **https://tripvisor.pages.dev** (first-deploy TLS propagation in progress at time of writing; user's earlier 522 proved the domain reachable from their network). Direct-upload mode = future deploys are `npx expo export --platform web && npx wrangler pages deploy dist --project-name tripvisor --branch master` (NOT auto-on-push — git integration can be added later in the dashboard).
- ⏸ G4 Keep-alive repo secrets — blocked on `gh auth login` (user) or add `SUPABASE_KEEPALIVE_URL=https://nahywqbrdlkemdtjjxkc.supabase.co/rest/v1/` + cloud anon key via the GitHub web UI → run keepalive.yml once.
- 🟡 G5 Live smoke: cloud smoke user `live-smoke@test.local` seeded (password in supabase/.env); full authed smoke + `docs/smoke/v2-live.md` pending TLS propagation.

## 🗺 FURTHER STEPS (planned 2026-06-11)
1. **You:** pick Option A/B above → first real user smoke of the golden path → report anything broken.
2. **Bug-fix wave** from your smoke findings + the small **anchors follow-up** (P1.3 wiring gap — 2 backend changes + ~1h UI).
3. **S1** SDK epic 52→53→54 (⏸ D1 + your devices for checkpoints) → **S2** offline engine (Legend-State, undo stack, manual_rank).
4. **P3** charts (gifted-charts — unblocked by S1) + analytics MV wiring.
5. **P4** native parity + push + Sign-in-with-Apple → EAS preview APK on your phone → **NATIVE GA**.
6. **P5** launch hardening (DROP cost_per_km, quota alerts, final deploy + docs).
Post-GA backlog unchanged (realtime co-edit, native offline maps, meal slots…).

## ✅ FIRST REAL AI GOLDEN-PATH RUN (2026-06-11 — "test AI" with the user's Gemini key)
**The flagship works end-to-end:** prompt → Gemini 2.5-flash → grounding → draft review (partial-grounding card live: "couldn't find Karşıyaka Kordon") → accept → trip created → **optimizer + real routes on the map**. Idempotent replay + quota ledger verified (2/10 runs). Transient Gemini free-tier 503 ("high demand") observed → retry succeeded; **Groq fallback key still recommended** for exactly this.
**Quality verdict:** Days 1–2 genuinely good (walkable Konak clustering, sane durations); weakness = grounding ambiguous LLM names to wrong businesses ("Kordon" → a kumru shop; one pick grounded to a muhtarlık office) → prompt/grounding tuning queued (prefer well-known named attractions; bias harder).
**THREE latent bugs caught & fixed (none findable by green suites):**
1. **Optimize mutex blocked since Phase 22** — `claim_trip_optimize` (service-role) hit the editor-restriction trigger (`auth.uid()` NULL → not owner → optimizing_at denied). Fix: **migration 0026** service-role bypass (post-RLS NULL uid = our own server). Optimize was last smoke-verified Phase 20 — predates the trigger.
2. **Matrix call shape broken for >5 places since Phase 2** — optimize-trip sent one origin/destination PER missing pair (14 places → 182 entries) into the 25-cap endpoint. Fix: send unique places once (N×N cross product, ≤25 by the existing guard) + pair-filter the response. Every v1 smoke used ≤5 places.
3. **Drive-time card inflated** — it summed ALL trip_legs incl. the day_index=-1 pairwise cache rows (14-place trip: 173h shown). Fix: filter to day legs (now 19h 3m / 9 legs, correct).
Gates after fixes: deno optimize-trip 11/11, jest 25/268, live re-optimize of the 14-place trip succeeded with routes rendered.
**Ops note #2:** local edge runtime bakes `supabase/functions/.env` at container CREATE — adding keys needs `npx supabase stop && start`, not `docker restart`.

### Change history
- 2026-06-09 — log created; Phase 0.1 started.
- 2026-06-09 — Phase 0.1 ✅ (cost_per_km retired, time-first; tsc + jest verified).
- 2026-06-09 — Phase 0.2–0.4 ✅. **Phase 0 DONE**, committed. Holding before SDK upgrade.
- 2026-06-10 — User guidance captured: real product, core loop, flexible & friendly → `ux-principles.md` + plan Constraint #6 + memory.
- 2026-06-10 — **Fable review panel (5 lenses) + synthesis** → plan v2.1: three-track resequence (god-screen split before sync engine; ~40% un-parked from the D1 hold); WEB BETA milestone; new P0s (timeline/ETAs, place comments, AI draft-review, parity checklist); C1 refined (`manual_rank` user-order vs server-computed order); cuts (web offline tiles, cursors, meals table, 8.3); Phase 0.5 debt sweep queued; D6 resolved (GitHub Actions pinger); D2+D4 flagged now-blocking. BUILD-LOG restructured to N/S/P tracks.
- 2026-06-10 — **Phases 0.5 + N1 + N2 + N3 SHIPPED** (commits `7572d32`, `ada5d6d`, `13f17bf`, `cb2e9c4`, `6313d2a`, +Wave 3). All gates green throughout (tsc baseline-identical; jest 25 suites / 268 tests). Session-limit interruption mid-Wave-2 recovered with zero loss. **Next:** user actions above (migrations/secrets/dashboard) + web smoke; then **N4 (AI editing + import)** ⏸ or **N5 (free maps)** ⏸ D2 or **S1 (SDK epic)** ⏸ D1.
- 2026-06-12 — **S2 Waves 3a+3b SHIPPED** (`5b830a1` + Wave 3b commit): mutations/undo/auth lifecycle, offline drag with pending-recompute pill, SyncStatusPill, metro.config.js web-export fix. R6 re-verified 7/7 post-Wave-3. Flag stays OFF. **Next:** S2.8 flag-flip phase, or P4 native parity (S1 device smoke still owed by user), or grounding-quality tuning.
