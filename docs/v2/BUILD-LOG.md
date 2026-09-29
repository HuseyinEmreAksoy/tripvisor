# Tripvisor v2 — Build Log (every step, stored)

> **Purpose:** the canonical, persistent tracker for the v2 rewrite. Every step is listed here with status; updated after each step so progress survives across sessions.
> **Legend:** ✅ done · 🟡 in progress · ☐ todo · ⏸ blocked (needs decision) · ⏭ deferred
> **Process notes:** `test-specialist` is **DISABLED** (renamed `test-specialist.md.disabled`). The **verification gate** below replaces it. All agents + orchestrator run on **Opus 5.5** (switched from Fable 2026-09-28, `090bfb5`; agent prompts slimmed + gate moved to `reviewer`). **QA model (user decision 2026-09-28): no agent-run smoke tests** — the user tests on web + a local APK. Per wave: one `reviewer` gate (tsc count vs recorded, targeted Jest, `sync:validate` when `src/sync/` changes, web export when config changes, plus a code read) and a short **"What to try"** list in this log. Gate ③/⑤ smoke items below are superseded by that list.
> **Now (2026-09-29):** M4 is code-complete through Wave 3 (`8dd2ae4`). **M5 (Y-track) is planned** in §M5 below: 4 waves, 19 steps + the M5.S security slot. **Next action:** the user runs the X3.4 "needs from user" list in §M4 (preferably before M5 Wave 2); the orchestrator fills M5.S from the audit and starts M5 Wave 1.
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
| Zero native verification (all of v1) | ☐ (M4 preview APK = first user device test, pending X3.4 EAS setup) | spot-checks + P4 |
| M4 follow-ups: resend-invite API, share-link read, editable trip dates, 6 files > 500 lines, orphaned pre-`8dd2ae4` `trip-docs` objects | ☐ 2026-09-29 | see §M4 "known follow-ups" |
| M5 accepted debt: OSM places with no Google match can't be added, the 1 GB global Storage ceiling, web photo uploads need a connection, the optimizer orders by the day default mode, transit falls back to an estimate, agent-translated legal text | ☐ 2026-09-29 | see §M5 "known debt" |
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

## 🧳 M5 — Memories, multi-currency, flexible routes, recommendations, i18n  (Y-track · planned 2026-09-29 · ☐ not started)
> **Why:** the user's product vision (2026-09-29) is a holiday **planning** app **and** an after-trip **memory and review** app. That means routes and days, expenses in several currencies against a home currency, photos/journal/personal reviews, place ratings (Google on tap) plus the user's own reviews, sharing with friends and family with per-trip on/off controls, per-leg transport modes ("drive half, transit the rest"), interest-based suggestions, full **Turkish + English**, and still **$0** (free tiers only).
> **Fixed user decisions (not re-asked):** i18n TR+EN (auto, Profile switch, all strings in files, locale-aware formatting) → [ADR-0011](../adr/0011-i18n-i18next-expo-localization.md). Recommendations from OSM Overpass + Wikipedia/Wikidata, Google only on tap, never persisted → [ADR-0013](../adr/0013-recommendations-osm-wikipedia.md). Memories: ~300 KB client-compressed photos in Storage, a day journal, per-place 1–5 rating and review → [ADR-0014](../adr/0014-memories-storage.md). FX from Frankfurter with a daily Postgres cache, rate frozen per expense → [ADR-0012](../adr/0012-fx-frankfurter-cached-rates.md). Per-leg mode override with an estimate fallback. Granular share toggles.
> **QA model (unchanged):** no agent smoke tests. One `reviewer` gate per wave: tsc ≤ the count recorded at wave start (M4 ended at **1109**), targeted Jest, `sync:validate` whenever `src/sync/` or synced tables change, a web export when config or deps change, **`npm run i18n:check`** from Wave 1 on, and Deno tests for touched Edge Functions *if Deno is installed* (still a user item from X3.4). Each wave ends with a "What to try" list.
> **i18n ordering decision: infra first, bulk extraction last.** Y1.4 lands the i18n runtime, formatters and the extraction of the shell/auth/onboarding/Profile, so every M5 screen (Waves 2–4) is **born translated** and nothing is written twice. The legacy screens that M5 doesn't otherwise touch are extracted in **Wave 4** (Y4.2 ‖ Y4.3), after the feature steps stop churning those areas, so no two agents edit the same file in the same wave. **Rule for every UI step:** use `t()` for all new strings, extract any string in a file you touch, and add keys only to *your own* namespace JSON (`src/i18n/locales/{en,tr}/<ns>.json`).
> **Migration slots (updated 2026-09-29):** M5.S security **landed as `0031`–`0033`** (commit `827bc5b`: RLS/grants, routing quota, invite quota). Y therefore uses **`0034`–`0037`**; any extra slot is `0038+`.
> **Shared-file rule for parallel waves:** new `src/api/*` modules define their own query keys and types locally, following the `trip-place-comments.ts` pattern. `src/api/_keys.ts`, `src/api/index.ts` and `src/api/types.ts` are edited **only by the step that names them**, and consumers import modules directly.

### ⏸ Blockers / needs the user
1. **X3.4 go-live first (or at least before the M5 cloud push).** M5 adds 4 migrations and 2 new Edge Functions on top of the M4 backlog that hasn't been pushed. Pushing both phases together multiplies the drift risk. Recommended: run the X3.4 list before M5 Wave 2 starts. Agents can build Wave 1 locally meanwhile.
2. **Turkish review:** agents write the `tr` JSON. The user, as a native speaker, reviews the tone and terms before the phase exits (Y4.G). Budget about 1 h, reading the JSON files or the app in TR.
3. **Memory visibility — DECIDED by the user (2026-09-29): PRIVATE BY DEFAULT.** Every memory (photo, journal entry, personal review) is visible **only to its author** until the author shares it: per-item **"Share with trip"** toggle plus bulk "share this day / whole trip". The column is `visibility text check in ('only_me','trip') default 'only_me'`. Shared items are visible to trip members; the public link shows **only** items with `visibility='trip'` AND the trip share toggle `show_memories=true` (default false). Wherever this plan says "Only me toggle", read it as the inverse "Share with trip" toggle, default off.
4. **Nothing paid, no new keys.** Frankfurter, Overpass and Wikipedia are keyless. Google usage is limited to the Places **IDs-only** Text Search for "resolve" and the existing place-details and Routes transit calls. Check both against the per-SKU monthly free caps in Cloud Console once. Optional: an `OVERPASS_URLS` secret for a second instance.
5. **Codex image quota:** the orchestrator runs Codex GPT-6 for about 8 new images in prep step **Y-P** (your ChatGPT plan quota).

### Free-tier budget (per external service)
| Service | Free limit | M5 usage and guard |
|---|---|---|
| Supabase Storage | 1 GB total, shared by all users | photos about 300 KB + a 40 KB thumbnail, so about 2,900 photos. Per-user cap 300 and per-trip cap 500 (`app_config`); inserts are refused above 900 MB ("storage full") |
| Supabase egress | ~5 GB/mo | grids load thumbnails only; full images load on open; signed URLs are cached in memory for 1 h |
| Supabase DB | 500 MB | `fx_rates` (~200 rows per used day), `poi_cache` (trimmed JSON, 30-day TTL, purged by the existing pg_cron) |
| Edge Functions | 500k invocations/mo | 2 new functions (`fx-rates`, `poi-recommend`); the client caches FX for 6 h |
| Frankfurter (ECB+) | no key, no quota, abuse rate-limit | about 1 upstream call per distinct date across all users; jsDelivr `currency-api` as fallback |
| Overpass (public) | about 10k requests and 1 GB per day per IP (guideline) | geohash-5 × interest tile cache for 30 days; **global cap of 2,000 a day** (`service_usage`); 40 per user per day; failover to a secondary instance and then Wikipedia GeoSearch; kill switch `recommendations='off'` |
| Wikipedia / Wikidata REST | keyless; descriptive User-Agent required | summaries cached per `wikidata × lang` for 30 days; lazy, top N cards only |
| ORS | 2,000 directions and 500 matrix calls a day | unchanged path; per-leg modes add at most one directions call per overridden leg |
| Google (Places/Routes) | per-SKU monthly free caps | transit legs (existing) + IDs-only resolve on "add"; place details only on tap; **no Google photos as thumbnails** |
| Codex GPT-6 | user's ChatGPT plan | Y-P: about 8 images in one batched prompt |

### New surface area (summary)
- **Migrations:**
  - `0034_v2_m5_multicurrency.sql`: `fx_rates`; `trip_expenses.{currency, fx_rate, fx_date, fx_home_currency}`; `trips.currency` check widened to `^[A-Z]{3}$`; analytics MV redefined to `amount*coalesce(fx_rate,1)`.
  - `0035_v2_m5_leg_modes.sql`: `trip_places.{arrival_mode, arrival_minutes}`, `trip_days.transport_mode`, `trip_legs.source`; `duplicate_trip` redefined to copy the new expense and place columns (memories are not copied).
  - `0036_v2_m5_memories.sql`: `trip_journal_entries`, `trip_place_reviews`, `trip_photos` + the private `trip-memories` bucket + storage policies + the quota/guard trigger + realtime + tombstone/`updated_at` triggers.
  - `0037_v2_m5_sharing_prefs_poi.sql`: `trip_shares.{show_itinerary default true, show_expenses default false, show_memories default false}`; `user_preferences(user_id pk, locale, home_currency, interests text[])`; `poi_cache`; `service_usage` + a SECURITY DEFINER increment; `ai_usage.poi_requests`; pg_cron purge of `poi_cache` rows older than 30 days.
- **New Edge Functions:** `fx-rates`, `poi-recommend` (actions `search`, `resolve`).
- **Changed Edge Functions (additive, contract minor bump):** `optimize-trip` + `_shared/routing.ts` (per-leg modes, `legs[].source`, `keptOrderDays`), `share-trip` (toggles, a "current link" read, signed memory URLs, expenses summary), `place-details`, `places-autocomplete`, `ai-itinerary`, `ai-edit` (optional `lang`), `delete-account` (the `trip-memories` bucket), `export-account` (new tables).
- **Tier-1 allowlist changes (`src/sync/allowlist.ts`):**
  - Hydration fields: `trip_expenses` += `currency, fx_rate, fx_date, fx_home_currency`; `trip_places` += `arrival_mode, arrival_minutes`; `trip_days` += `transport_mode`.
  - Write fields: `trip_expenses` += the same 4; `trip_places` += `arrival_mode, arrival_minutes`. Both are user intent and C1-safe; legs stay server-only.
  - **New roots:** `trip_journal_entries` (write-enabled: `body, day_index, only_me, deleted`), `trip_place_reviews` (write-enabled: `rating, body, only_me, deleted`), `trip_photos` (read-only root; created through the upload path; `caption`/`only_me`/`deleted` changed through an online mutation).
  - None of these are Google fields. The C3 `isRestrictedFieldName` tripwire must still pass: `rating` on `trip_place_reviews` is a **user** rating. Add a documented allowlist exception for that table only, with a test proving `trip_places.rating` still throws.
- **New deps (all iOS/Android/web):** `i18next`, `react-i18next`, `expo-localization`, `intl-pluralrules` (native, only if Hermes lacks PluralRules), `expo-image-manipulator`, `expo-image-picker`.

### Prep (orchestrator, before Wave 3; not an agent step)
- ✅ **Y-P Image batch — DONE 2026-09-29 (orchestrator)**: files are empty-memories.png, empty-journal.png, empty-discover.png, empty-expenses.png, onboarding-interests.png (transparent, ≤ 350 KB), recap-backdrop.jpg (1200×800), and the two extra covers are **cover-7.jpg (nature) and cover-8.jpg (food)** at 800×533 (same set as cover-1..6 in src/components/tripCovers.ts — Y2.4 decides whether to add them to the hash pool). Original plan text: (Codex GPT-6, see memory `tripvisor-codex-images`)**: one batched prompt in the Tide & Terracotta style, saved to `assets/images/`: `empty-memories.png`, `empty-journal.png`, `empty-discover.png`, `empty-expenses.png`, `recap-backdrop.png`, `onboarding-interests.png`, and 2 more default covers (`cover-nature.png`, `cover-food.png`) for trips without a cover. The steps that use them reference these names; until the files exist, `EmptyState` falls back to icons.

### Wave 1: Schema, new Edge Functions, i18n runtime, security  *(Y1.1 ‖ Y1.2 ‖ Y1.3 ‖ Y1.4 ‖ M5.S in parallel; files disjoint)*
- ☐ **Y1.1 Money + routes schema, types and Tier-1 allowlist** — Agent: backend-specialist · Size: M · Depends: none
  Task: Write migrations `0034` and `0035` exactly as listed above. `arrival_mode` is checked to `driving|walking|bicycling|transit|flight|ferry`, `arrival_minutes` to 1–1440, and `trip_days.transport_mode` to the 4 trip modes. `trip_legs.source` is `ors|google|estimate|user`, defaulting to `ors`. Editor-trigger parity: editors **may** set expense currency and place `arrival_mode`, but `trips.currency` stays owner-only. The migration also redefines the MV and `duplicate_trip`. Update **`src/api/types.ts`** (the only Wave-1 editor of this file) for all M5 columns on existing tables, and `src/sync/allowlist.ts` for the new hydration and write fields on *existing* roots, with allowlist Jest updated. Extend `sync:validate` with an expense-with-currency create→edit round trip and an `arrival_mode` write.
  Output: 2 migrations, types, allowlist. Verify: `supabase db reset` applies cleanly (local); allowlist Jest passes; `sync:validate` passes; tsc ≤ count.
  Risks: [Med] the MV redefinition drops dependent grants or indexes. Mitigation: copy 0029's grant and index block verbatim. [Med] legacy rows have `currency NULL`. Mitigation: NULL is defined as "trip currency with rate 1" everywhere (documented in the types JSDoc).
- ☐ **Y1.2 Memories, sharing and preferences schema + account lifecycle** — Agent: backend-specialist · Size: M · Depends: blocker 3 (veto window)
  Task: Write migrations `0036` and `0037` as listed above and in ADR-0014:
  - RLS: select = `user_can_access_trip(trip, uid, 'viewer')` AND (`only_me = false` OR `author_id = uid`); insert = the author is uid and the user is a trip member; update = author only; delete/tombstone = author or owner.
  - Storage policies join `trip_photos`; the path is `<trip_id>/<author_id>/<photo_id>`.
  - Quota trigger: caps from `app_config` (`memories_user_cap=300`, `memories_trip_cap=500`) plus the 900 MB global guard via `storage.objects` metadata, with error code `storage_full`/`quota_exceeded`.
  - `user_preferences` is owner-only RLS. `poi_cache`, `service_usage` and `fx_rates` are readable by `authenticated` and writable only by the service role.
  - Extend `delete-account` to remove the user's `trip-memories` objects, and `export-account` to include the journal, reviews and photo metadata. Update the Deno tests for both.
  Output: 2 migrations + 2 function updates. Verify: local reset applies; SQL assertions in the migration's test block (a member sees the item, a non-member doesn't, `only_me` is hidden from others, the quota trigger fires); the Deno tests are written (run if Deno is present).
  Risks: [High] a storage policy that joins a metadata row inserted after upload leaves orphans or denies reads. Mitigation: the order is **row first (`status='pending'`), upload, then mark `ready`**; a pg_cron job deletes `pending` rows older than 24 h. [Med] the `storage.objects` size sum is slow at scale. Mitigation: it's fine at ≤ 3k objects; noted in debt.
- ☐ **Y1.3 `fx-rates` + `poi-recommend` Edge Functions** — Agent: backend-specialist · Size: M · Depends: none (codes against the DDL above; the gate checks it against Y1.1/Y1.2)
  Task:
  - `supabase/functions/fx-rates/` per ADR-0012: Frankfurter `api.frankfurter.dev` (verify the v1/v2 response shape during the build), jsDelivr `currency-api` fallback, EUR-based upsert, cross rates, weekend/holiday resolution, `GET currencies`, `meta.contractVersion: 1`.
  - `supabase/functions/poi-recommend/` + `_shared/interests.ts` per ADR-0013: `search` (Overpass QL built from the tag map, geohash-5 tiles, `poi_cache`, trimmed payload, ranking, lang-aware names, lazy Wikipedia summaries via Wikidata sitelinks with tr→en fallback), `resolve` (Places Text Search, IDs-only field mask, 300 m acceptance), per-user and global caps, instance failover then Wikipedia GeoSearch, the `recommendations` kill switch, a descriptive User-Agent.
  - Deno tests with mocked upstreams.
  Output: 2 new functions. Verify: Deno tests (if Deno is present) or a reviewer read of the handlers against the contract; `supabase functions serve` + one curl each (local, reviewer).
  Risks: [High] Overpass slowness or 429s under load. Mitigation: `[timeout:25]`, tile cache, failover chain, global cap. [Med] Google may no longer treat the IDs-only SKU as free. Mitigation: `resolve` is only called on "add" or on a tap, not per card, and it counts in `ai_usage`.
- ☐ **Y1.4 i18n runtime, formatters, and first extraction** — Agent: ui-specialist · Size: M · Depends: none
  Task: Per ADR-0011:
  - Install deps. Add `src/i18n/{index.ts,format.ts}` and `locales/{en,tr}/{common,shell,auth,onboarding,profile,legal,errors}.json`, with init in `app/_layout.tsx` before first render.
  - Language resolution: stored choice → device language; a **Profile → Language** row (System / Türkçe / English). Changing it re-renders and re-formats without a restart.
  - `src/lib/formatCurrency.ts` and `formatDuration.ts` delegate to `src/i18n/format.ts`; callers don't change.
  - Add `scripts/i18n-check.ts` + `npm run i18n:check` (key parity, empty values, JSX-literal scan in the migrated directories list).
  - **Extract** these, including the Turkish text: tabs `_layout` + `TabBar`, `(auth)/*`, `app/index.tsx`, `components/onboarding/*`, `(tabs)/settings.tsx` (Profile), `app/legal/*` (legal text translated in full; flag it for review by the user's lawyer or the user).
  - Jest for `format.ts` (tr-TR `₺1.234,50`, en `€1,234.50`, dates, `İ`/`ı` collation) and a language-switch test.
  Output: TR/EN switchable shell. Verify: tsc ≤ count; `i18n:check` passes; web export is clean (new deps); Jest passes.
  Risks: [Med] Hermes lacks `Intl.PluralRules`, which breaks plurals only on native. Mitigation: a guarded polyfill plus a Jest case that simulates its absence. [Med] string concatenation ("Day " + n) can't be translated. Mitigation: interpolation only; the reviewer greps `' + t(`.
- ☐ **M5.S Security fixes (from audit)** — Agent: *TBD by the orchestrator* · Size: *TBD* · Depends: the parallel security audit
  Placeholder, filled by the orchestrator with the audit findings. Constraints: migration slot `0031` (then `0038+`). The files must be disjoint from Y1.1–Y1.4. If a fix lands in a file a Y step owns (`allowlist.ts`, `types.ts`, `delete-account`, `export-account`, `share-trip`), fold the fix into that step's brief instead of running a parallel edit. `share-trip` fixes should go to Y2.5 (Wave 2) unless they are urgent.
- ☐ **Y1.G Wave-1 gate** — Agent: reviewer. The gate items above, plus: migrations 0031–0037 apply in order on a fresh local reset; the RLS read matrix (owner/editor/viewer/non-member × `only_me`); allowlist tests including the review-`rating` exception; `i18n:check`; the web export with new deps. **User "what to try":** switch Profile → Language to Türkçe, and the tabs, auth, onboarding and Profile are all Turkish, with dates and money formatted `₺1.234,50 (CLDR tr-TR)` style; set it back to System; the sign-in page on a Turkish-language phone opens in Turkish.

### Wave 2: Data layers, routing engine, visual foundation  *(Y2.1 ‖ Y2.2 ‖ Y2.3 ‖ Y2.4 ‖ Y2.5 in parallel; files disjoint)*
- ☐ **Y2.1 Memories data layer + photo pipeline** — Agent: backend-specialist · Size: M · Depends: Y1.2
  Task:
  - `src/api/trip-memories.ts`: journal, review and photo hooks with local keys and types; signed-URL hook with memory-only caching.
  - Tier-1 roots `trip_journal_entries` and `trip_place_reviews` (write-enabled) and `trip_photos` (read) in `allowlist.ts`, `hydrate.ts`, `store.ts` and `mutations.ts` (create/update/tombstone with `UndoEntry`, client UUIDs), following the X2.5 pattern.
  - `src/lib/photoPipeline.ts`: `expo-image-manipulator` compress to ≤ 350 KB full plus a 400 px thumbnail, EXIF stripped, `taken_at` from picker EXIF read before the strip. Upload flow: row pending → 2 uploads → ready.
  - A native persisted retry queue (AsyncStorage + `expo-file-system` cache copy). Web uploads online only.
  - Tombstoning a photo deletes its objects when online.
  - Extend `sync:validate` with journal and review round trips. Jest for pipeline size targets (mocked manipulator) and the queue.
  Output: offline journal and reviews; reliable photo upload. Verify: sync Jest; `sync:validate`; tsc.
  Risks: [High] a new Tier-1 root breaks boot or account switching. Mitigation: copy the X2.5 root checklist (hydrate order, wipe, teardown), and `sync:validate` must stay all-green. [Med] web canvas compression of HEIC from iPhones. Mitigation: `expo-image-picker` converts to JPEG on iOS; on web, reject unsupported types with a translated error.
- ☐ **Y2.2 Money + preferences data layer** — Agent: backend-specialist · Size: M · Depends: Y1.1, Y1.3
  Task:
  - `src/api/fx.ts`: rates hook plus a last-known map persisted through the persister allowlist (edit that allowlist and **`src/api/_keys.ts`**; this step alone owns `_keys.ts` in Wave 2).
  - The `trip-expenses.ts` facade captures `currency/fx_rate/fx_date/fx_home_currency` on create; if no rate is known, `fx_rate=null` and a reconciler fills it on reconnect.
  - Pure `src/lib/money.ts`: `toHome`, `totalsInHome`, `breakdownByCurrency`, `atTodaysRate`, `parseAmount(locale)` (so `12,50` works in TR), `rederiveOnHomeChange`, with thorough Jest.
  - `src/api/user-preferences.ts` (locale, home currency, interests; upsert own row).
  Output: every money consumer can call one lib. Verify: Jest for money (including rounding to the currency's minor units, JPY with 0 decimals); tsc.
  Risks: [Med] floating-point drift in totals. Mitigation: sum in minor units and round once at display.
- ☐ **Y2.3 Flexible routes engine (per-leg modes)** — Agent: backend-specialist · Size: M · Depends: Y1.1
  Task: In `optimize-trip/index.ts`, `_shared/routing.ts` and `directions-polyline` as needed:
  - Effective leg mode = `to_place.arrival_mode ?? day.transport_mode ?? trip.transport_mode`.
  - The leg cache is keyed by mode (today it filters on `trip.transport_mode`).
  - Driving, walking and cycling use ORS, with Google as the in-request fallback. Transit uses Google, and on error, quota or the kill switch falls back to an **estimate** (haversine × 1.3 at 25 km/h + 5 min).
  - Flight: `arrival_minutes`, or distance / 700 km/h + 90 min, with source `user`/`estimate` and no polyline (the client draws the arc). Ferry: `arrival_minutes`, or distance / 30 km/h, as an estimate.
  - Ordering: the optimizer matrix uses the day's effective default mode. **Days that contain a flight or ferry leg keep the user's `manual_rank` order** and only recompute legs; the response lists them in `keptOrderDays`.
  - Additive response fields + a `contractVersion` minor bump. Update `src/api/routes.ts` and `src/components/trip-detail/computeDayTimeline.ts` (pure; this step owns it) to consume `source` (an estimate shows as ≈).
  - Deno + Jest cases: mixed-mode day, transit fallback, flight day kept in order.
  Output: "drive half, transit half" produces correct legs and ETAs. Verify: optimize-trip Deno tests (if Deno is present); `computeDayTimeline` Jest; tsc.
  Risks: [High] the optimize-trip leg wipe and rewrite regresses the 0026 mutex or `manual_rank` branch. Mitigation: no change to the claim/release or manual-branch control flow, only to the per-leg mode argument; the existing 11+ Deno cases must pass. [Med] a mode change isn't reflected until re-route. Mitigation: the client triggers the existing recompute; offline shows the existing "pending route recompute" chip.
- ☐ **Y2.4 Visual foundation** — Agent: ui-specialist · Size: M · Depends: Y1.4
  Task:
  - **Tokens:** a lighter surface and elevation scale in `src/theme/tokens.ts`. Dark fills are reserved for the hero and map chrome; cards use a lighter raised surface; more whitespace.
  - **Day color system:** a single `dayColor(i)` source shared by the map, chips, timeline rail and place-row accent (the current definition lives in `Map/types.ts`; move it to the theme and re-export).
  - **Desktop widths:** `Screen` gains `width="form" (640) | "content" (960) | "full"`. Apply `form` to `trip/new.tsx`, `trip/plan.tsx` and `trip/[id]/add.tsx`.
  - **Trip hero:** `TripHeader` shows the cover image (generated covers, `tripCovers.ts`) with a scrim, title, dates and a "Day 3 of 7" / "in 12 days" / "Relive" status. It collapses to the M4 compact header on scroll on phones and sits as a banner on desktop.
  - **Place thumbnail slot:** `PlaceThumb` (own memory photo thumbnail if one exists, via an optional prop, otherwise a category-icon tile in the day color). No Google photos in rows (cost + ToS). Wire it into `PlaceRow`.
  - Extract strings in every touched file.
  Output: a lighter, more visual trip surface. Verify: tsc; touched component Jest; a code read of desktop widths at 1440 px; contrast AA on the new tokens.
  Risks: [Med] the token change ripples across M4's WCAG work. Mitigation: change surface tokens only (not `primaryInk`, `dangerText` or `scrim`), and the reviewer spot-checks 5 screens in both themes.
- ☐ **Y2.5 Sharing + locale plumbing + recommendations client** — Agent: backend-specialist · Size: M · Depends: Y1.2, Y1.3
  Task:
  - `share-trip`: owner sets `show_itinerary/show_expenses/show_memories`; a **"get current link"** read (closes the M4 debt); the public payload includes an expenses summary (home-currency totals by category plus the per-currency breakdown; line items never included) when on, and memories (non-`only_me` journal, reviews, and photo thumbnails + full images as 1 h signed URLs) when on.
  - An optional `lang` in `place-details` and `places-autocomplete` (Google `languageCode`), and in `ai-itinerary`/`ai-edit` (output language instruction).
  - `src/api/share.ts` and `src/api/places.ts`/`ai.ts` pass `lang` from the i18n locale.
  - New `src/api/recommendations.ts`: `useRecommendations` (Tier-2 memory-only, **excluded from the persister**) and `useResolvePlace`.
  - Deno tests for share-trip toggles (expenses hidden by default, `only_me` never public).
  Output: all server contracts the Wave-3 UI needs. Verify: Deno tests (if present); a reviewer read that the share payload has no Google content; tsc.
  Risks: [High] leaking private memories publicly. Mitigation: the service-role query filters `only_me=false AND deleted=false`, with an explicit Deno test.
- ☐ **Y2.G Wave-2 gate** — Agent: reviewer. The gate items, plus `sync:validate` (the new roots), the persister allowlist diff (fx is in, recommendations are out), and a read of the optimize-trip diff for C1. **User "what to try":** the trip screen shows a cover hero and the day colors match the map; "new trip" on desktop is a centered form, not full width; offline, write a journal entry (via a dev hook or the Wave-3 UI if available), reload, and it persists; re-optimize a trip with Turkish language set and the AI/place text comes back in Turkish.

### Wave 3: Feature UIs  *(Y3.1 ‖ Y3.2 ‖ Y3.3 ‖ Y3.4 ‖ Y3.5 in parallel; file ownership listed per step)*
- ☐ **Y3.1 Memories UI** — Agent: ui-specialist · Size: M · Depends: Y2.1, Y-P
  Task:
  - Owns `app/(app)/trip/[id]/memories.tsx`, `src/components/memories/*`, `app/(app)/place/[placeId].tsx`, `TripHubTab`/`TripHubCards` and `(tabs)/today.tsx`.
  - **Memories screen:** a timeline by day (day color rail), photo grid with thumbnails and a lightbox, the day journal editor, and an "Only me" toggle on every item.
  - **Place detail:** a "Your rating & review" block (1–5 stars + text), kept visually separate from "Reviews from Google".
  - **Hub:** a Memories card (count + latest thumbnail) and a **Discover** card linking to `/trip/[id]/discover` (the Y3.4 route).
  - **Today:** "Add photo" and "Write today's journal" quick actions.
  - Upload progress, queue state, `storage_full`/`quota_exceeded` messages, and the empty states (`empty-memories`, `empty-journal`).
  Verify: tsc; component Jest (the review block, the only-me toggle); `i18n:check`.
- ☐ **Y3.2 Multi-currency UI** — Agent: ui-specialist · Size: M · Depends: Y2.2
  Task:
  - Owns `src/components/budget/*` (incl. `ExpenseEditSheet`), `TripSettingsSheet` (home currency picker with the widened list), `(tabs)/analytics.tsx` + `components/analytics/*`.
  - The expense sheet has a currency chip row: home currency + recently used (e.g. EUR, TRY) + "More…" searchable. The keypad accepts the locale decimal separator, and a live "≈ ₺1.234,50 (CLDR tr-TR)" preview shows while typing.
  - Budget card: the home-currency total, a **per-currency breakdown**, an "at entry rate / today's rate" toggle, and a "rate pending" chip.
  - Analytics shows everything in home currency.
  - Changing the home currency shows a confirm explaining the re-derivation.
  Verify: tsc; existing BudgetCard/CategoryBreakdown Jest updated; `i18n:check`.
- ☐ **Y3.3 Flexible routes UI** — Agent: ui-specialist · Size: M · Depends: Y2.3
  Task:
  - Owns `ItineraryTab.tsx`, `itinerary/*`, `PlaceRow.tsx`, `DaySummaryCard.tsx`, `DayStartTimeControl.tsx`, `MapTab.tsx`, `src/components/Map/*`.
  - A **leg chip between consecutive stops** (mode icon + duration, with ≈ when estimated); tapping it opens a mode sheet (drive, walk, bike, transit, flight, ferry, plus optional minutes for flight, ferry and transit) that writes `arrival_mode`/`arrival_minutes` via Tier-1 and triggers a recompute.
  - A per-day default mode in the day header.
  - Map: per-mode polyline styles (walk dotted, transit dashed, flight geodesic arc, ferry dashed in blue), with legend chips.
  - A "Kept your order because this day has a flight" note, from `keptOrderDays`.
  - The drag path is unchanged.
  Verify: tsc; `dragRank`/timeline Jest; a code read that the C1 write path only touches `arrival_*` and `manual_rank`.
  Risks: [Med] ItineraryTab (~860 lines) grows further. Mitigation: the leg chip, mode sheet and day-mode control go into new files under `itinerary/`, and ItineraryTab only mounts them.
- ☐ **Y3.4 Recommendations + interests UI** — Agent: ui-specialist · Size: M · Depends: Y2.2, Y2.5, Y-P
  Task:
  - Owns `app/(app)/trip/[id]/discover.tsx`, `src/components/discover/*`, `QuickAddSheet.tsx`, `components/onboarding/*` (the interests card), and the Profile preferences section in `(tabs)/settings.tsx` (interests, default home currency, and the locale mirror to `user_preferences`).
  - Discover: interest chips (pre-selected from preferences), a center selector (trip day's centroid / current location / map center), a card list with the Wikipedia extract and thumbnail and attributions, and a map toggle.
  - **Tap → a RecDetailSheet** that resolves the place and shows the Google rating and reviews through the existing place-details hook (Tier-2; "Powered by Google").
  - "Add to Ideas / Day N" through the existing add path.
  - A "couldn't match to a map place" state, a quota-exhausted state, a kill-switch state, and the empty state (`empty-discover`).
  - QuickAddSheet gets a "Discover nearby" entry.
  Verify: tsc; component Jest (the interest mapping and attribution rendered); a code read that no Google field reaches Tier-1 or the persister.
- ☐ **Y3.5 Sharing controls + public page** — Agent: ui-specialist · Size: M · Depends: Y2.5
  Task:
  - Owns `ShareLinkCard.tsx`, `src/components/share/*`, `app/share/[token].tsx`.
  - The share card: link on/off, **show itinerary / show expenses (off by default) / show memories (off by default)** toggles, and re-showing the current link after reload (the new read). This fixes the stale header comment from M4.
  - Public page: an Expenses section (home-currency totals + currency breakdown) and a Memories section (gallery, journal quotes, star reviews), each rendered only when the payload includes it. It stays mobile-first, with OG tags unchanged.
  Verify: tsc; ShareLinkCard Jest updated; a code read that the page renders nothing for missing sections and has no auth dependency.
- ☐ **Y3.G Wave-3 gate** — Agent: reviewer. The gate items plus the file-ownership check (no two Wave-3 diffs touch the same file). **User "what to try":**
  - Add 3 photos from your phone to a day, write a journal entry, and rate a place 4★ with a review; a collaborator sees them, and "Only me" items stay hidden from them.
  - Add expenses in EUR and TRY on a trip with home currency TRY; the totals, the per-currency breakdown and the today's-rate toggle all work; enter "12,50" in Turkish.
  - Set Day 2 to transit and one leg to "drive"; set a flight leg with 120 min; the map shows the arc, the timeline shows ≈, and the order is kept.
  - Pick History and Food interests, open Discover in a city, tap a card to see the Google rating, and add it to Day 1.
  - Turn on "show memories" for a share link, open it in a private window, and expenses stay hidden until toggled on.

### Wave 4: Recap story, full extraction, non-UI strings  *(Y4.1 ‖ Y4.2 ‖ Y4.3 ‖ Y4.4 in parallel)*
- ☐ **Y4.1 Trip recap "story" + past-trip visuals** — Agent: ui-specialist · Size: M · Depends: Wave 3
  Task:
  - Owns `app/(app)/trip/[id]/recap.tsx`, `src/components/recap/*`, pure `src/lib/recap.ts` (+ Jest), `(tabs)/trips.tsx`, `TripCard.tsx` and `(tabs)/today.tsx`.
  - A full-screen swipeable story that works on a phone, desktop (centered 9:16 frame with keyboard arrows) and native. The slides: cover; days, places, km and hours; money spent in home currency with the top category; top-rated places (your stars); a photo per day; journal quotes; a "Plan the next one" CTA.
  - Entry points: past trips in the list get a **"Relive"** badge and use the best memory photo as the card cover (falling back to the generated cover); Today shows a "Your trip recap is ready" card after a trip ends.
  - Reduced motion shows static slides.
  Verify: tsc; `recap` Jest (empty memories, no expenses, 1-day trips); `i18n:check`.
- ☐ **Y4.2 i18n extraction A: trip and place surfaces** — Agent: ui-specialist · Size: M · Depends: Wave 3
  Task: Extract every remaining literal in `app/(app)/trip/**` (excluding the M5 routes already born translated), `app/(app)/place/*`, `app/invite/*`, `src/components/{trip-detail (files not touched in M5), DraggableItinerary, add-place, ai-edit, ai-plan, collaborators, accommodation, packing}`, and `print.tsx` (print dates use the app locale). Namespaces: `trip`, `place`, `ai`, `collab`, `stays`, `packing`. Add the TR translations.
  Verify: `i18n:check --strict` over those directories = 0 literals; tsc; touched Jest updated for text changes (prefer `testID` or role queries).
- ☐ **Y4.3 i18n extraction B: everything else** — Agent: ui-specialist · Size: M · Depends: Wave 3
  Task: Extract the rest, **excluding the files Y4.1 and Y4.2 own**: `components/{home, today, analytics (non-M5), charts, navigation, permissions}`, the root components (`EmptyState`, `emptyStates.ts`, `FilterSheet`, `TripActionsSheet`, `UndoToast`, `SyncStatusPill`, `StatusPill`, `TripCostRollup`, `ReactionChip`, `MapUnavailable`, `PlaceActionsSheet`, `PoweredByGoogle` stays English per Google's branding), and `app/(app)/_layout.tsx`. (`src/lib/tripsFilters.ts` belongs to Y4.4.) Add the TR translations. Then flip `i18n:check --strict` to cover **all** of `app/` and `src/components/`.
  Verify: the repo-wide strict check = 0; tsc; Jest.
  Risks: [Med] Jest suites assert English text. Mitigation: the test setup pins `en`; assertions use keys or roles where cheap.
- ☐ **Y4.4 Non-UI strings, collation, CI** — Agent: backend-specialist · Size: S · Depends: Y1.4
  Task:
  - `src/api/_errors.ts`: typed error codes mapped to `errors` namespace keys (Edge Functions keep English codes).
  - `.ics` event text (`src/lib/ics/*`, `src/api/ics*`) and the share-summary text (`src/lib/buildSummary.ts`) use the app locale.
  - Trips-list sorting and search use `Intl.Collator(appLocale)`, and the sort/filter labels move to i18n keys. This step owns all of `src/lib/tripsFilters.ts`.
  - Add `npm run i18n:check -- --strict` to `.github/workflows/ci.yml` as a required job.
  Verify: Jest for the error mapping, ics TR output and collation (`İstanbul` sorts under I/İ correctly); tsc.
- ☐ **Y4.G Wave-4 gate + phase close** — Agent: reviewer, then docs-specialist (features docs for memories, currency, routes, discover, i18n, recap; `overview.md`) and git-committer. **User "what to try":**
  - The whole app in Türkçe, with no English leftovers on any screen you visit (report any).
  - A finished trip shows "Relive"; open the story on a phone and on desktop.
  - Export a trip `.ics` in Turkish.
  - **Review the TR JSON** (blocker 2).
  - Cloud push: migrations 0031–0037; deploy `fx-rates`, `poi-recommend`, `optimize-trip`, `share-trip`, `place-details`, `places-autocomplete`, `ai-itinerary`, `ai-edit`, `delete-account`, `export-account`; confirm the `trip-memories` bucket exists on cloud.

### 📌 M5 known debt (accepted at planning)
- OSM candidates with no confident Google match can't be added (ADR-0013).
- The 1 GB Storage ceiling is global. R2 is the documented escape hatch (ADR-0014).
- Web photo uploads need a connection (native has a queue).
- The optimizer ignores per-leg overrides when *ordering* (it uses the day default) and keeps manual order on flight and ferry days.
- Transit is an estimate whenever Google transit isn't available.
- Legal text translated by an agent. Needs a human or legal read before store submission.

**Phase exit criteria (M5):**
1. With Profile → Language set to Türkçe, every screen is Turkish. `i18n:check --strict` passes repo-wide in CI. Dates, numbers and money follow the app language (`₺1.234,50 (CLDR tr-TR)` vs `€1,234.50`). System mode follows the device.
2. A trip with EUR and TRY expenses shows the home-currency total using the frozen rates, a per-currency breakdown, and a today's-rate view. An expense added offline gets its rate after reconnecting.
3. A day with mixed modes (a drive leg, a transit leg, a flight with minutes) renders correct legs, ETAs (≈ on estimates) and per-mode map styles. Flight and ferry days keep the user's order.
4. Photos upload at ≤ 350 KB with a thumbnail and no EXIF GPS. The journal and reviews work offline and sync. "Only me" items are invisible to other members and to the public. The quota and 900 MB guard produce clear messages.
5. Discover returns interest-matched OSM places with attributions. A tap shows the Google rating live (never persisted). Adding resolves to a `google_place_id`. The caps and kill switch work.
6. Share link toggles (itinerary, expenses off by default, memories off by default) control the public page, and the current link can be re-shown.
7. The visual track has shipped: trip hero, unified day colors, place thumbnails, desktop form widths, memory timeline, recap story, and the new empty-state art.
8. Every wave's gate is green: tsc ≤ recorded, Jest, `sync:validate` (including the new roots), web export, and Deno where available.

## 📱 M4 — Mobile-first experience & useful features  (X-track · planned 2026-09-28 · 🟡 code-complete 2026-09-29 through Wave 3 — X3.4 go-live pending user)
> **Why now:** the user's direction (2026-09-28) is to rework features, older code and the mobile design so the app is more useful day to day, test it on web plus a local APK, deploy on free tools, and then publish to Google Play and the App Store. **Name note:** "M4" is this phase's number. It is *not* part of the Monetization M1–M3 track, and its step ids use the prefix **X**.
> **Out of scope (treated as done):** the 18 review-finding fixes that are in flight: the trips list (empty state, grid, scroll), back navigation, the invite redirect, the add-place day picker, the place-photo key leak, native map refit, bottom-sheet focus, the location toggle, and the Cloudflare `_redirects` file.
> **QA model (CLAUDE.md, 2026-09-28):** there are no agent smoke steps. Each wave has one `reviewer` gate: the tsc count vs the count the reviewer records at wave start, targeted Jest, `sync:validate` when `src/sync/` changes, and a web export when config changes. The gate also includes a code read for broken golden paths, dead navigation and bad desktop layout. Every wave ends with a short **"what to try"** list, which the user runs on web and on the local APK.
> **What a phone walk-through of the current code (2026-09-28) found:** (1) There is no app-level navigation. Insights and Settings are emoji pills in the trips header, and the hero, title, search, sort, filter and segment stack take up most of a phone screen before the first trip card. (2) There is nothing for *during* the trip: no "where am I going next / how long / navigate" surface. The only directions link (`PlaceRow.buildTransitDeepLink`) sends an **origin with no destination**. (3) Trip detail on a phone is a tall `TripHeader` plus a Map/Itinerary/**Settings** tab bar plus a permanent full-width "Add a place" bar. Budget, stays, packing, docs, collaborators and share are all buried in "Settings" next to "Danger zone". (4) Loading states are plain "Loading…" text, there are no haptics, and pull-to-refresh exists only on the trips list. (5) The Unsplash hot-linked heroes and the emoji empty states will be replaced by the generated brand assets. (6) `app.json` has no icon, adaptive icon, splash, favicon or EAS `projectId`. The Maps keys are still `REPLACE_WITH_*`, and `Map.native.tsx` uses `PROVIDER_GOOGLE`, so on Android **a missing key crashes the app when the map opens** instead of showing `MapUnavailable`. (7) Offline: the S2.8 engine code is landed, but the flag is still OFF. The S2.8.13 blockers B1 (OPFS warm-up) and B2 (empty-root "Synced") are fixed **only in the uncommitted working tree** (`src/sync/hydrate.ts`, `persistence*.ts`). Expenses and packing are read-only Tier-1 roots, so they can't be edited offline mid-trip.

### ⏸ Blockers / needs the user
> **Status 2026-09-29:** 4 ✅ (brand art generated with Codex GPT-6 and shipped in `b43a606`). 5 applied (preview APK bakes `EXPO_PUBLIC_SYNC_TIER1=1`; production native stays OFF). 1–3 are still open and are folded into the X3.4 **Needs from user** list below.
1. **EAS account:** run `npx eas login`, then `npx eas init` from the repo root. This writes `extra.eas.projectId` and `owner`. It's needed before the first APK build at the end of Wave 1; X1.2 prepares everything else.
2. **Android Maps SDK key.** In Google Cloud, enable "Maps SDK for Android" and create a key restricted to package `com.tripvisor.app` plus the keystore SHA-1. The SHA-1 is available from `eas credentials` after the first build, so a first build can use an unrestricted key or none. Without a key, X1.2 makes the native map show the "maps unavailable" state instead of crashing. This is a native SDK key restricted to the app package, not the server HTTP key, so the no-HTTP-key-in-client rule still holds. The iOS key can wait for the iOS build.
3. **EAS env for the `preview` profile:** the cloud `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` values. `.env` is gitignored, so an EAS cloud build never sees it. This is the G6 REPLACE_ME lesson again. Either the user or an agent (after login) runs `eas env:create --environment preview`. Optional: a Sentry auth token. Without one, the preview build sets `SENTRY_DISABLE_AUTO_UPLOAD=true`.
4. **Brand images:** the Codex/GPT-6 set must be in `assets/images/` before X1.2 starts. Only `icon-1024.png` is present as of 2026-09-28.
5. **Veto window, native flag:** the plan bakes `EXPO_PUBLIC_SYNC_TIER1=1` into the **preview APK only**, so the user's APK test doubles as the owed native device check for S1.3 and S2. Production native builds stay OFF until that test passes. Object before X1.2 if you don't want this.
6. **Later, not blocking M4, but money:** a Google Play Console account ($25 one-time) and an Apple Developer account ($99/yr, not free). The App Store also needs Sign-in-with-Apple (P4.3) and an iOS build, which stay in P4.

### S2.8 decision: **IN this phase, split across X1.3 (land and flip locally) and X3.4 (flip live).**
Reasons: (a) the Today view is used exactly when the traveller is offline (roaming, metro, airports), so offline reliability is a feature requirement for this phase, not a separate engine concern. (b) About 95% is built: Waves A–C and S2.8.12 are committed, and the B1/B2 fixes are on disk. (c) Leaving the flag OFF means every new X feature has to be built and reasoned about on both paths, flag-off and flag-on. Flipping first means Waves 2–3 build on one path. (d) The rollback is cheap: the `app_config` `sync_tier1='off'` kill switch takes effect in under 60 s. S2.8.13's re-smoke items become user "what to try" items, and S2.8.14 is absorbed into X3.4.

### Wave 1: App shell, brand + APK, offline on  *(X1.1 ‖ X1.2 ‖ X1.3 in parallel; the files don't overlap)*
- ✅ **X1.1 Bottom-tab app shell + shared mobile primitives** — Agent: ui-specialist · Size: M · Depends: none
  **Status:** 2026-09-28 · `b43a606` · verified: tabs Trips/Today/Insights/Profile (bottom bar, desktop rail), Skeleton, haptics, `tripToday` + `directions` libs with Jest; tsc 1341 (M4 baseline) · jest 41/421 · web export ok.
  Task: Add an `app/(app)/(tabs)/_layout.tsx` Tabs group with **Trips · Today · Insights · Profile**. Move `trips.tsx`, `analytics.tsx` and `settings.tsx` into it. Group segments don't change URLs, so `/trips`, `/analytics` and `/settings` stay the same. Add a stub `today.tsx` ("No trip today" plus the next-trip countdown), which X2.1 fills in. Trip detail and every deep screen stay as Stack screens pushed over the tabs, so the tab bar is hidden there. Use a custom `tabBar`: a safe-area-aware bottom bar with Lucide icons under 1024 px, and a left rail at 1024 px and above so desktop isn't a stretched phone. Clean up the trips header: drop the Insights/Settings pills, turn the hero into a compact card that scrolls away with the list on phones, and drop the emoji `icon` override on the empty state so the illustration from X1.2 shows. Replace `router.push('/(app)/settings' as any)`-style casts with typed hrefs. **Shared primitives for Waves 2–3:** `src/lib/haptics.ts` (an `expo-haptics` wrapper that does nothing on web and respects reduced motion; the one new dep, iOS/Android native and web no-op, justified here), `src/components/Skeleton.tsx` (reduced-motion-aware), `src/lib/tripToday.ts` (`activeTripsOn(date)`, `dayIndexFor(trip, date)`, `nextUpcomingTrip`, all pure), and `src/lib/directions.ts` (`buildDirectionsUrl({ destination:{lat,lng,placeId?,label?}, origin?, mode })`: the Google universal URL on Android and web, Apple Maps on iOS with a Google fallback), plus Jest tests for the two libs.
  Output: the tabs shell on all 3 platforms, a lighter trips header, and 4 primitives. Verify: tsc at or under the count; the new lib tests pass; web export is clean; in code, Android hardware back from a tab root doesn't pop into auth, and `/trips`, `/settings` and `/analytics` deep links still resolve.
  Risks: [Med] expo-router v6 group move breaks typed routes or the `(app)/_layout` auth guard. Mitigation: keep the guard in `(app)/_layout`, with the tabs group nested inside it; grep every `'/(app)/…'` push. [Med] SDK 54 Android edge-to-edge puts the bar under the gesture nav. Mitigation: bottom padding from `useSafeAreaInsets`.
- ✅ **X1.2 Brand assets + Android APK buildability** — Agent: ui-specialist · Size: M · Depends: blocker 4 (images); blockers 1–3 only for the actual build
  **Status:** 2026-09-28 · `b43a606` · verified: `app.config.ts` (Maps keys from env), `eas.json` preview APK + production AAB, `MapUnavailable` without an Android key, brand art (Codex GPT-6) wired, Unsplash hotlinks removed; build guide in [`apk-build.md`](apk-build.md). First APK build still needs the user (see X3.4).
  Task: (a) Convert `app.json` to `app.config.ts`, keeping the static JSON values and injecting `android.config.googleMaps.apiKey` and `ios.config.googleMapsApiKey` from env **only when set**, so the `REPLACE_WITH_*` placeholders are gone. Add `icon`, `android.adaptiveIcon` (foreground plus a background color), an `expo-splash-screen` plugin block with image, backgroundColor and a dark variant, `web.favicon`, `android.versionCode`/`ios.buildNumber`, and `runtimeVersion`. (b) `Map.native.tsx` renders `MapUnavailable` when no native key is configured (check `Constants.expoConfig`), so there is no crash. (c) `eas.json`: `preview` = APK, `environment: "preview"`, and non-secret env (`EXPO_PUBLIC_SYNC_TIER1=1`, `EXPO_PUBLIC_MAP_PROVIDER`, `SENTRY_DISABLE_AUTO_UPLOAD=true`); `production` = app-bundle with `autoIncrement`. (d) Local assets replace the Unsplash hotlinks in `login.tsx`, `signup.tsx` and `HomeHero.tsx`, keeping the existing scrims. (e) `EmptyState` gains an `illustration` prop, and `emptyStates.ts` binds `empty-trips/places/search.png`. (f) Add a short "Build the APK" block to `docs/v2/deployment.md`, covering `eas build -p android --profile preview`, or the local alternative `npx expo run:android --variant release` (needs JDK 17 and the Android SDK).
  Output: `app.config.ts`, `eas.json`, wired assets, and a native map fallback. Verify: `npx expo config --type public` resolves with no placeholders; `npx expo-doctor` passes; web export is clean with the favicon present in `dist`; EmptyState Jest passes.
  Risks: [High] the EAS cloud build ships without the Supabase env (the G6 class of bug). Mitigation: EAS `environment` plus blocker 3; the gate greps `app.config.ts`/`eas.json` for the env wiring. [Med] the Sentry gradle upload fails the build without a token. Mitigation: set the disable flag in preview.
- ✅ **X1.3 Offline engine: land the S2.8.13 fixes and flip locally** — Agent: backend-specialist · Size: S · Depends: none
  **Status:** 2026-09-28 · `b43a606` · verified: B1 OPFS warm-up before sync probe, B2 load-state stamping, boot/teardown race hardening, `EXPO_PUBLIC_SYNC_TIER1=1`; sync Jest green. `sync:validate` NOT run (local Docker down) — carried to X3.4.
  Task: Review and finish the uncommitted B1 (async bounded OPFS warm-up, `bootInFlight` de-dupe) and B2 (`isLoaded`/`isGetting` stamping) work in `src/sync/hydrate.ts`, `persistence*.ts` and `persistence.types.ts`. Add Jest cases for the concurrent-boot share and for an empty root reaching "Synced". Re-run `npm run sync:validate` (16/16). Set `EXPO_PUBLIC_SYNC_TIER1=1` in `.env.example` and the local `.env`, with a comment on the kill switch. Confirm that `persistence.native.ts` resolves on the async contract (the APK runs flag-on per blocker 5). Mark S2.8.13 items 1, 5, 7, 8 and 9 as **user "what to try"**, not agent smoke.
  Output: B1/B2 landed; the flag is ON for local web and the preview APK. Verify: sync Jest passes; `sync:validate` 16/16; tsc at or under the count; web export is clean.
  Risks: [Med] Safari/WebKit stays on the degraded in-memory path (R5). Mitigation: the pill already shows "Local-only"; this is documented and not a blocker.
- ✅ **X1.G Wave-1 gate** — Agent: reviewer. The gate items listed above, plus a code read of the tabs guard and route moves. **User "what to try":** the bottom tabs on a phone-width browser and on desktop (left rail); Android back from each tab; offline in DevTools, then edit and reload a trip, and the edits persist; the pill reaches "Synced"; the APK installs, opens, and the map shows either the real map or the "maps unavailable" state, never a crash.
  **Status:** 2026-09-28 · `b43a606` · verified: tsc 1341 · jest 41 suites / 421 tests · web export ok · plus the 18 UI review fixes (trips list, `useSafeBack`, invite `pendingRedirect`, add-place day via `useMoveToDay`, place-photo proxy, map refit, `_redirects`).

### Wave 2: Daily-use features  *(X2.1 ‖ X2.2 ‖ X2.3 ‖ X2.4 ‖ X2.5 in parallel; the files don't overlap and hook signatures stay fixed)*
- ✅ **X2.1 "Today" view: live trip companion** — Agent: ui-specialist · Size: M · Depends: X1.1
  **Status:** 2026-09-28 · `38b056e` · verified: next stop (ETA, Navigate, Done/Skip with undo, running-late), per-device check-offs, tonight's stay, weather, quick expense; pre-trip countdown + prep card.
  Task: Fill in `app/(app)/(tabs)/today.tsx` and add `src/components/today/*`. **Trip selection:** use `tripToday` on owned and shared trips. If several trips are active, show a chip switcher. If none is active, show the next trip's countdown plus a prep card (packed X/Y, number of docs, stay booked?, first-day weather). If there are no trips at all, show the empty illustration plus "Plan with AI". **Live day:** today's `computeDayTimeline` shown as a compact vertical list. The **Next stop** card shows the name, planned arrival and time left, plus "≈ N min from you" when location is granted. That figure is a haversine estimate at the transport-mode speed, with no metered calls, labeled approximate and hidden without permission. It has a **Navigate** button (`buildDirectionsUrl` plus haptic), **Done / Skip** buttons (check-off stored per device, keyed trip/day; no migration and no server write), plus "Open on map" and "Add a place to today" (`/trip/[id]/add?day=N`). Also add a **Tonight's stay** card with a navigate-home button (reusing the StayingAtPill date logic), today's weather chip, and an **Add expense** quick action (opens the existing `ExpenseEditSheet`). Add pull-to-refresh and skeletons. Add a "Your trip is live → Today" banner to `HomeHero.tsx`.
  Output: a Today tab that is useful before and during the trip, and works offline because it reads from Tier-1-backed hooks; when cached legs are missing, the ETA chips degrade gracefully. Verify: tsc; Jest for the next-stop selection helper (clock vs timeline, check-off skips, no-stops day); a code read showing no Google calls on this screen.
  Risks: [Med] timezone: "today" means device local time vs the trip's `YYYY-MM-DD` string dates. Mitigation: `tripToday` compares local-date strings only (tested in X1.1).
- ✅ **X2.2 Trip detail, rebuilt for the phone** — Agent: ui-specialist · Size: M · Depends: X1.1
  **Status:** 2026-09-28 · `38b056e` · verified: compact header + menu sheet, Plan/Map/Trip (`?tab=`), `TripHubTab` + `TripSettingsSheet`, FAB + `QuickAddSheet`; v1 parity list reachable (reviewer read).
  Task: In `app/(app)/trip/[id]/index.tsx`, `TripHeader.tsx` and `SettingsTab.tsx`: (a) a compact header on phones (title, dates, overflow ⋯ menu for Print, Share, Trip settings). The route-summary card becomes a one-line chip row. (b) The tabs become **Plan · Map · Trip**, defaulting to Plan when places exist. Tab state goes into a `?tab=` param so back navigation and deep links keep it. (c) Split `SettingsTab` into a **`TripHubTab`**: summary cards that tap into the existing sections or routes (Budget spent/total bar, Stays next check-in, Packing X/Y, Docs N, People avatars plus invite, Share). Its companion **`TripSettingsSheet`** (dates, daily hours, transport, currency, cover, export, danger zone) is opened from the header, and the existing JSX moves across rather than being rewritten. (d) Replace the full-width "Add a place" bar with a **FAB and a `QuickAddSheet`**: search a place, paste a list (`ImportPlacesSheet`), ask AI (`AiEditSheet`), add expense. (e) Skeleton loading. The desktop split view is kept, and the hub replaces the Settings panel there.
  Output: the phone trip screen spends its vertical space on the plan. Verify: tsc; a code read of the v1 parity checklist (print, .ics, share, duplicate, export, notes, reactions, delete are all still reachable); the role gating (`canEditTrip`) holds on the FAB and in the hub.
  Risks: [Med] parity regressions when moving settings into a sheet. Mitigation: move the JSX without rewriting it; the reviewer walks the parity list.
- ✅ **X2.3 Itinerary usability on a phone** — Agent: ui-specialist · Size: M · Depends: X1.1
  **Status:** 2026-09-28 · `38b056e` · verified: day-jump strip, collapsible days, Assist menu, pull-to-refresh, skeletons, drag haptics; transit link now routes to the next stop; drag/rank path unchanged.
  Task: In `ItineraryTab.tsx`, `PlaceRow.tsx`, `DaySummaryCard.tsx` and `DayStartTimeControl.tsx`: a sticky **day-jump chip strip** (Ideas · D1 Mon 12 · …, with today highlighted, auto-scrolling to today's day while the trip is live); collapsible day sections (past days collapsed during a trip, remembered per device); the 3 tool chips (AI edit, import, gap-fill) folded into one "✨ Assist" menu; pull-to-refresh on places and legs; skeleton rows; a denser PlaceRow on phones with at least 44 pt targets; a haptic on drag pickup and drop. **Bug fix:** the transit link gets a real destination via `buildDirectionsUrl` (the next stop's coordinates, passed down from ItineraryTab's leg index).
  Output: a faster itinerary to scan and move around one-handed. Verify: tsc; `dragRank`/`computeDayTimeline` Jest still passing; a code read that the drag and flag-on rank path is unchanged apart from haptics.
  Risks: [Med] a sticky header inside a DraggableFlatList on native is fiddly. Mitigation: render the chip strip outside the list and scroll with `scrollToIndex`, not sticky list headers.
- ✅ **X2.4 Budget, stays and packing usability** — Agent: ui-specialist · Size: M · Depends: none (the X2.5 hooks keep their signatures)
  **Status:** 2026-09-28 · `38b056e` · verified: keypad-first expenses, daily spend strip, stay nights + navigate + copyable confirmation code, packing progress / hide-packed / collapsible categories / suggestion chips.
  Task: In `src/components/budget/*`, `accommodation/*`, `packing/*` and `app/(app)/trip/[id]/packing.tsx`: a keypad-first **quick expense** flow (amount, category chips, date defaulting to today, the trip's currency) and a per-day spend strip, with estimated vs actual kept category-based (never per-km). **Stays:** check-in/out plus nights, address with a Navigate button (`buildDirectionsUrl`), and a copyable confirmation code. **Packing:** haptic tick, a "hide packed" toggle, a progress bar, collapsible categories, and one-tap suggestion chips. Exported component props stay backward-compatible (X2.1 and X2.2 mount them).
  Output: the three trip-management surfaces are usable in 1–2 taps. Verify: tsc; existing BudgetCard, CategoryBreakdown and AccommodationCard Jest suites pass, updated where the markup changed.
- ✅ **X2.5 Offline writes for expenses and packing** — Agent: backend-specialist · Size: M · Depends: X1.3
  **Status:** 2026-09-28 · `38b056e` · verified: `trip_expenses` + `trip_packing_items` Tier-1 writable (C1/C3 intact, tombstones + undo), idempotent attach, account-switch hardening; review fixes: `networkMode: 'always'` on the 15 Tier-1 mutations, migrations 0029 (MV excludes deleted expenses) + 0030 (`duplicate_trip` skips tombstones); validate script +6 round-trip checks (22 total) — NOT run (Docker down), carried to X3.4.
  Task: Make `trip_expenses` and `trip_packing_items` Tier-1 **writable**. Specifically: `TIER1_WRITE_FIELDS` entries (the C3 and C1 firewalls unchanged), hydrate actions, `mutations.ts` create/update/tombstone with `UndoEntry` inverses (client UUIDs, never `created_at`), and facades in the expense and packing hooks in `src/api/`, on the same always-call pattern as S2.8.3/5 with **unchanged hook signatures**. Hard-delete paths become tombstones. Every remaining direct read filters `deleted=false`. Extend `sync:validate` with an expense and packing create→edit→tombstone round trip.
  Output: expenses added and packing ticked offline mid-trip survive a reload and sync on reconnect. Verify: sync Jest passes; `sync:validate` all passing (16 + new); tsc.
  Risks: [Med] packing bulk-seed (≤30 rows) racing its own unacked creates (beta finding). Mitigation: write complete rows; the seed is one batch; covered by a validate assertion. [Med] a viewer-role offline write is rejected by RLS on reconnect. Mitigation: the UI stays role-gated, and rejections surface in the existing issues sheet.
- ✅ **X2.G Wave-2 gate** — Agent: reviewer. **User "what to try":** create a trip dated today, then open Today and use Next stop → Navigate (it opens Google Maps with the right destination); check off stops; offline, add an expense and tick packing, reload, go back online, and confirm they synced; on the trip screen, use the FAB quick add, the hub cards, and the ⋯ menu for settings and print; check that the day chips jump correctly and past days are collapsed.
  **Status:** 2026-09-28 · `38b056e` · verified: tsc 1155 · jest 59 suites / 565 tests · web export ok · `sync:validate` pending (local stack down).

### Wave 3: Polish, first run, sharing, and going live  *(X3.1 ‖ X3.2 ‖ X3.3 in parallel; X3.4 last)*
- ✅ **X3.1 Design polish sweep (dark mode, icons, touch, feedback)** — Agent: ui-specialist · Size: M · Depends: Wave 2
  **Status:** 2026-09-29 · `8dd2ae4` · verified: WCAG AA tokens (`primaryInk`, `dangerText`, `scrim`, chart palette) in both themes; dark basemap (OpenFreeMap dark / Android night / iOS system); keyboard-safe edge-to-edge sheets; emoji → Lucide; 44 pt targets; skeletons + pull-to-refresh on place detail and Insights; print CSS via `nativeID`/`dataSet`.
  Task: A cross-screen sweep **excluding** the auth, onboarding, legal, settings, share, invite and collaborators files, which belong to X3.2/X3.3. It covers: a dark-mode audit of the secondary surfaces (budget, stays, sheets, charts, place detail, analytics, print); a dark basemap on MapLibre if a keyless OpenFreeMap style exists, otherwise dark chrome only; the remaining functional emoji replaced with Lucide icons; skeletons and pull-to-refresh on the remaining lists (place detail, analytics); keyboard-avoiding and safe-area behavior on every form sheet under Android edge-to-edge; consistent pressed states plus haptics on primary actions; at least 44 pt targets. Closes the P4.4 "desktop polish" item where touched.
  Verify: tsc; the touched component tests pass; a code read of contrast tokens in both themes (WCAG AA).
- ✅ **X3.2 First run + store-required pages** — Agent: ui-specialist · Size: M · Depends: X1.2
  **Status:** 2026-09-29 · `8dd2ae4` · verified: 3-card onboarding (once per device, TTL-aware redirect check, never traps deep links), location pre-permission explainer, public `/legal/privacy` + `/legal/terms` (privacy matches reality), clearer magic-link auth, findable account deletion (now also removes `trip-docs` Storage objects); Change password removed.
  Task: A 3-card onboarding (Plan with AI, a route that optimizes itself, works offline) using local art. It shows once, with a device flag, and is gated in `app/index.tsx`. A location **pre-permission explainer** comes before the OS prompt (used by Today and the map). Public **`app/legal/privacy.tsx`** and **`terms.tsx`** pages sit outside the auth guard. They are required for the Play listing and the Data-safety form, and are linked from signup and settings. The account-deletion entry must be easy to find in settings (a Play policy requirement). Login and signup get phone polish: keyboard avoiding and clear magic-link vs password copy.
  Verify: tsc; a code read that onboarding never traps a returning or deep-linked user (invite and share cold starts bypass it).
- ✅ **X3.3 Sharing and collaboration polish** — Agent: ui-specialist · Size: M · Depends: none
  **Status:** 2026-09-29 · `8dd2ae4` · verified: native share sheet (web Share API + clipboard fallback), https share links on native (`EXPO_PUBLIC_APP_URL`, default `https://tripvisor.pages.dev`), mobile-first public trip page (day tabs, map, timeline; Map-builtin shadowing crash fixed), collaborators phone layout; static OG tags + Pages Function `functions/share/[token].ts` for per-trip previews. Android App Links ⏭ P4 (no release SHA-256).
  Task: In `ShareLinkCard.tsx`, `app/share/[token].tsx`, `app/invite/[token].tsx` and `app/(app)/trip/[id]/collaborators.tsx`: use the **native share sheet** (RN `Share.share`; on web, `navigator.share` with a clipboard fallback) for the public and invite links; a phone layout for collaborators (role chips, pending invites, resend/revoke); a **mobile-first public share page** (day tabs, timeline, map, "Plan your own with Tripvisor" CTA, per-trip OG meta). Android App Links (`intentFilters` plus `/.well-known/assetlinks.json`) are done only if the release SHA-256 is available; otherwise ⏭ deferred to P4 and noted.
  Verify: tsc; ShareLinkCard Jest passes; a code read that the share page leaks no Google content beyond Tier-2 and has no auth dependency.
- ☐ **X3.4 Go live: cloud + flag-on web deploy (absorbs S2.8.14)** — Agent: backend-specialist · Size: S · Depends: X3.1–X3.3 gated
  **Status (2026-09-29):** ☐ X3.1–X3.3 are gated; this step is blocked on the user. **Needs from user:**
  1. Start Docker, then `npx supabase start` + `npm run sync:validate` (22 checks: 16 + 6 from X2.5; not run in any M4 wave).
  2. `npx supabase db push` — 0029, 0030, plus anything pending since 0027 (check `npx supabase migration list --linked` first).
  3. `npx supabase functions deploy delete-account share-trip optimize-trip` (+ `ai-*` if changed since the last deploy).
  4. Cloudflare Pages env `SUPABASE_URL` + `SUPABASE_ANON_KEY` (read by the Pages Function `functions/share/[token].ts` for per-trip OG tags), and `wrangler login` for the deploy.
  5. EAS: `npx eas login` + `npx eas init`, then `eas env:create --environment preview` for `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (+ optional `GOOGLE_MAPS_ANDROID_KEY`), then `eas build -p android --profile preview`. See [`apk-build.md`](apk-build.md).
  6. Install Deno to run `supabase/functions/delete-account/index.test.ts`.
  After 1–4, an agent finishes the rest of the task below (bundle grep, headers curl, kill-switch drill, `deploy:web` script).
  Task: Run `supabase migration list --linked` and push any pending migrations (0027 must be on cloud). Deploy the Edge Functions touched since the 2026-06-12 deploy (`optimize-trip` manual_rank branch, `share-trip`, `ai-*`, `export-account` as changed). Export web with the cloud env and `EXPO_PUBLIC_SYNC_TIER1=1`, then **grep the bundle** for the cloud URL, the flag literal and zero `127.0.0.1`/`REPLACE_ME` (the G6 lesson). Confirm `dist/_headers` and `dist/_redirects` are present. Run `wrangler pages deploy`, then `curl -I` for COOP/COEP. Kill-switch drill: add an `app_config` row `sync_tier1='off'`, check it, then delete it. Add a truthful `npm run deploy:web` script to replace the misleading `deploy:web:preview` echo.
  Output: tripvisor.pages.dev serves M4 flag-on; rollback is proven. Verify: the bundle grep, the header curl and the drill are recorded in this log.
  Risks: [High] cloud migration drift. Mitigation: the migration list comes first; stop and report on any conflict.
- ✅ **X3.G Wave-3 gate** — Agent: reviewer. The wave-3 gate items above; docs-specialist then writes one close-out pass (features and overview, and ticks the platforms the user verified). **User "what to try":** a fresh install shows onboarding once; privacy and terms pages open while signed out; share a trip from a phone and open the link in a private window; dark mode on every surface; the live site works on a phone browser, including offline edit and reload.
  **Status:** 2026-09-29 · `8dd2ae4` · verified: tsc 1109 · jest 72 suites / 625 tests · web export ok · Deno tests for `delete-account` written, not run (no Deno) · `sync:validate` NOT run (Docker down). Gate is code-level only; X3.4 stays open.

### 🧪 M4 — What to try (web + APK)
*Consolidated from the X1.G/X2.G/X3.G lists and the commit bodies. Run on a phone-width browser, desktop, and the preview APK.*
- **Tabs:** Trips · Today · Insights · Profile as a bottom bar on a phone and a left rail on desktop; Android back from each tab root never drops you into auth; every deep screen has a way back.
- **APK:** installs and opens with the brand icon + splash; the map shows either the real map or "maps unavailable", never a crash.
- **Today:** on a trip dated today, Next stop → Navigate opens the maps app at the right destination; Done/Skip (with undo) persists across a restart; tonight's stay, weather and quick expense show. Before a trip: countdown + prep card.
- **Trip screen (phone):** Plan/Map/Trip tabs; the FAB quick add (search, paste list, AI, expense); hub cards; the ⋯ menu for settings, share and print.
- **Itinerary:** day chips jump to the right day, past days are collapsed during a trip, the Assist menu works, drag has haptics, the transit link routes to the next stop.
- **Budget/stays/packing:** keypad expense in two taps; daily spend strip; copy a stay's confirmation code; hide-packed and suggestion chips.
- **Offline:** go offline (DevTools or airplane mode), edit a place, drag, add an expense and tick packing; reload; go back online; the pill reaches "Synced" and everything survived.
- **Add place:** the chosen day is actually applied (needs connectivity for the day move).
- **First run:** a fresh install/browser shows onboarding once; an invite or share link opened cold skips it; the location explainer appears before the OS prompt.
- **Legal + account:** `/legal/privacy` and `/legal/terms` open while signed out; account deletion is easy to find in Profile.
- **Sharing:** share a trip from a phone (native share sheet; link is `https://tripvisor.pages.dev/share/…`), open it in a private window (day tabs, map, timeline); paste the link in a chat app for a preview card (after X3.4 deploy).
- **Dark mode + print:** every surface readable in dark mode (incl. the dark basemap); print a trip and check ink-on-paper output.

### 📌 M4 known follow-ups / debt
- Collaborators: no resend-invite API (the UI can only revoke + re-invite).
- Sharing: no "get current share link" read, so an existing link can't be re-shown after reload without creating a new one.
- Trip dates are not editable (`UpdateTripPatch` has no start/end dates).
- Files over 500 lines: `trips.tsx` ~808, `settings.tsx` ~700, `add.tsx` ~540, `ItineraryTab` ~860, `MapTab` ~640, `AccommodationEditSheet` ~613.
- Android App Links (`intentFilters` + `assetlinks.json`) ⏭ P4, pending a release SHA-256.
- `trip-docs` Storage objects orphaned by account deletions *before* `8dd2ae4` stay in the bucket (needs a one-off cleanup).
- Add-place day scheduling needs connectivity: an accepted C1 exception (goes through `useMoveToDay`, not the Tier-1 offline path).
- Stale code comment: `src/components/ShareLinkCard.tsx` header still mentions a native "deep link only" warning (code is correct; owner: ui-specialist).
- `sync:validate` (22) and the `delete-account` Deno tests have not been run for M4 (see X3.4).

**Phase exit criteria (M4):** ① The bottom tabs (Trips · Today · Insights · Profile) work on web (a rail on desktop) and in the APK, and every deep screen has a back route. ② On a trip dated today, Today shows the next stop with its planned arrival, a Navigate button opens the device maps app to the correct destination, and check-offs persist across a restart. ③ Tier-1 is ON for web (live) and for the preview APK. An offline place edit, drag, expense and packing tick each survive a reload and sync on reconnect, the pill reaches "Synced" with empty roots, and the kill-switch drill is recorded. ④ The phone trip screen has Plan/Map/Trip tabs, a FAB quick add and the hub; the v1 parity list is all reachable. ⑤ The app icon, adaptive icon, splash, favicon, empty-state illustrations and local heroes ship, with zero Unsplash URLs (`grep unsplash` = 0). ⑥ `eas build -p android --profile preview` produces an installable APK, and there is no native crash without a Maps key. ⑦ Public privacy and terms pages exist, plus onboarding. ⑧ Gates at every wave: tsc at or under the recorded count, targeted Jest passing, `sync:validate` all passing, web export clean.
**Deferred to P4 (unchanged):** Expo Push (P4.2), Sign-in-with-Apple (P4.3, the App Store gate), the iOS build, native flag-on in *production* builds (after the user's APK test), and Android App Links if no SHA-256 is available.

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
- 🟡 S2.8 status as of 2026-09-28: the code has landed (Waves A–C plus S2.8.12, commits `b97af68`…`2c58cf4`, `sync:validate` 16/16). The S2.8.13 smoke found blockers B1/B2 (see `docs/smoke/s2-8.md`); their fixes are uncommitted in the working tree *(update 2026-09-28: landed in X1.3, `b43a606`)*. **What remains is absorbed into M4: X1.3 (land the fixes and flip locally plus in the preview APK) and X3.4 (live flip plus the kill-switch drill, formerly S2.8.14).** The original scope, for reference: (flag-flip phase) **Remainder**: UI repoint per entity (reads off the Tier-1 store, retire reorderDay dual-path) + persister retirement + v1-user migration + sign-out `clearPersist` policy decision + undo toast/button + issues-sheet resolver actions + `_headers` COOP/COEP on Pages (prefer `credentialless` — `require-corp` can break cross-origin tiles/fonts).

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
- 🐛➡✅ G6 **LIVE AUTH BROKEN — env-inlining production bug (2026-06-12, user report: "CORS fetch failed" on signup/signin + Google "not secure").** Root cause: `readEnv()` in supabase.ts (+ place-photos, useEdgeRuntimeHealth) used a **computed** `process.env?.[key]` lookup, and 5 more sites used the **optional-chained** `process.env?.EXPO_PUBLIC_X` form — Expo's babel preset inlines ONLY literal `process.env.EXPO_PUBLIC_X` member expressions, so the production bundle shipped with the `https://REPLACE_ME.supabase.co` fallback live (verified: neither cloud nor local URL nor the maps key present in the exported JS). Auth fetches died at DNS (surfaced as "fetch failed"); the Google click NAVIGATED to the dead host (ISP NXDOMAIN-hijack page = the "not secure"). Dev always worked because the dev server injects runtime `process.env`. **Fix: 8 sites repointed to static-first reads** (literal member expression, dynamic read kept as dev/jest fallback — Map.web.test mutates env at runtime). Server side verified healthy first: preflight 200 ACAO=*, password-grant 400-with-CORS from origin tripvisor.pages.dev. Re-export verified (cloud URL + maps key IN bundle, zero 127.0.0.1) → **redeployed** https://17db7e79.tripvisor.pages.dev → tripvisor.pages.dev (also ships all post-go-live code: S1/S2/P3/T1/design v3 — the 06-11 deploy was pre-S1). **Why never caught: G5 live smoke was blocked on TLS propagation — the live bundle had never been auth-smoked.** Still open: Google provider OFF in cloud (`external_google_enabled=false`, G2b user-owed); email confirmation DISABLED 2026-06-12 (`mailer_autoconfirm=true`, user-confirmed explicitly) so live signups work instantly — **revert to confirmed email when Resend SMTP lands (G2b)**.

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
- 2026-06-12 — **S2 Waves 3a+3b SHIPPED** (`5b830a1` + `a8466a8`): mutations/undo/auth lifecycle, offline drag with pending-recompute pill, SyncStatusPill, metro.config.js web-export fix. R6 re-verified 7/7 post-Wave-3. Flag stays OFF. **Next:** S2.8 flag-flip phase, or P4 native parity (S1 device smoke still owed by user), or grounding-quality tuning.
- 2026-06-12 — **G6 live-auth hotfix SHIPPED + REDEPLOYED** (user's first live report): env-inlining bug — computed/optional-chained `process.env` reads are not inlined by Expo at build time; live bundle ran with REPLACE_ME Supabase URL. 8 sites fixed to static-first reads; gates green (tsc 1341 ±0, jest 28/346); fresh cloud-env export verified then deployed → tripvisor.pages.dev. Google provider (G2b) + Resend SMTP still user-owed.
- 2026-09-29 — **M5 planned** (Y-track: memories, multi-currency, flexible routes, recommendations, TR+EN i18n, visual track). 4 waves, 19 steps + M5.S security placeholder; migrations 0032–0035 (0031 reserved for M5.S); new Edge Fns `fx-rates` + `poi-recommend`; ADR-0011…0014.
