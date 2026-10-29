# Tripvisor — Project Instructions

Holiday route planner. Expo universal app (iOS / Android / Web) + Supabase + Google Maps Platform.

## Stack

- Expo SDK 54, Expo Router, TypeScript strict (v2 rewrite: see `plan-v2.md` + `docs/v2/BUILD-LOG.md`)
- Offline-first Tier-1 store: Legend-State + expo-sqlite (`src/sync/`); web map: MapLibre + OpenFreeMap (Google fallback)
- React Native + React Native Web (one codebase, three platforms)
- Supabase (Postgres + Auth + Edge Functions) on free tier
- Google Maps Platform (Places API New + Routes API) within $200/mo free credit
- TanStack Query + AsyncStorage persister for server state
- Deploy: Cloudflare Pages for web, EAS for native

## Commands

- `npm run start` — Expo dev server (choose iOS / Android / web from menu)
- `npm run web` — Expo web only
- `npm run ios` / `npm run android` — requires EAS dev client (no Expo Go)
- `npx supabase start` — local Supabase (Postgres + Edge Functions)
- `npx supabase functions serve` — run Edge Functions locally
- `npx supabase db reset` — reset + reapply migrations (LOCAL ONLY)
- `npm test` — Jest
- `npm run test:e2e` — Playwright (web)

## Platform targets (all three, from one codebase)

Tripvisor ships to **iOS, Android, and Web** from the same Expo tree. Every feature must work on all three platforms. There is no separate "mobile developer" agent — `ui-specialist` owns native config (EAS, `app.json`, permissions, splash/icons, deep links, OTA updates) and web config (static export, meta tags) in addition to components. If a capability is inherently single-platform, it must be explicitly scoped that way in the plan and feature doc, with justification.

A feature isn't "Done" in `docs/features/overview.md` until `docs-specialist` has ticked all three "Platforms verified" boxes (iOS, Android, Web) in its feature doc.

## Product vision (user, 2026-09-29): read before adding features

Tripvisor is a **holiday planner and an after-trip memory and review app**.
- **Plan:** routes and days, with per-leg transport (drive part of the way, then transit).
- **Expenses:** tracked in any currency, converted to a home currency, with a per-currency breakdown.
- **Memories:** photos, journal, and a personal rating and review per place. Google ratings and reviews show on tap only and are never stored.
- **Discovery:** interest-based recommendations (history, food, nature, …) from free OSM/Wikipedia.
- **Sharing:** per trip with friends and family. The public link has toggles; memories are private by default.
- **Languages:** Turkish and English. New UI strings go through `t()` with both `en` and `tr` keys, and dates, numbers and money are formatted in the app language.
- **Zero extra spend:** free tiers only. A paid dependency is a blocker.
- Phase plan: §M5 in `docs/v2/BUILD-LOG.md`.

## Current user priorities (2026-04-25)

- Tripvisor must feel like a travel product, not a bare CRUD shell. Auth, empty states, and primary app surfaces should use richer travel-oriented UI, destination imagery, and stronger visual hierarchy.
- Navigation must be explicit. Deep screens need visible back affordances, and users should never get stuck without a clear route back.
- Web must not be treated as a stretched mobile screen. Key screens should have desktop-aware layout, spacing, and hierarchy.
- Google Maps and add-place are load-bearing flows. Broken map rendering, missing server keys, or other runtime misconfiguration must be treated as blockers and surfaced clearly (e.g. an in-app "maps unavailable" state).
- Time and duration are the primary planning model. Avoid `cost per km`; if expense tracking exists it should be category-based (`accommodation`, `food`, `transport`, `shopping`, etc.) with total-trip budget plus estimated-vs-actual tracking.
- Budget tracking, trip sharing/collaboration, and accommodation tracking are promoted roadmap items, not distant brainstorm-only ideas.
- **QA model (user decision 2026-09-28): no agent-run smoke tests.** The user tests on web + a local APK. Agents spend effort on features, code quality and mobile design, and keep gates cheap (tsc count, targeted Jest, web export when config changes). The reviewer reads the code for broken golden paths, dead navigation and bad desktop layout; each wave ends with a short "what to try" list for the user.

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Platform-split components use `Foo.native.tsx` / `Foo.web.tsx` (and `.ios.tsx` / `.android.tsx` when needed); consumers import as `./Foo`.
- Server state via TanStack Query hooks in `src/api/`.
- Never persist Google Place data server-side beyond `google_place_id` + coordinates (30-day ToS ceiling).
- Never ship Google HTTP API keys to the client — proxy everything through Edge Functions.
- RLS on every child table, always scoped via `trips.user_id`.

## Sub-agents (all on `model: opus`, Opus 5.5; `effort: xhigh` for planner/ui/backend/reviewer, `medium` docs, `low` git-committer; one role each)

- `planner` — decomposes a new phase or multi-step feature into waves in `docs/v2/BUILD-LOG.md` (skip it for small fixes)
- `ui-specialist` — `app/`, `src/components|hooks|theme/`, `app.json`/EAS/web config, plus component tests for its own code
- `backend-specialist` — Supabase, Edge Functions, `src/api/`, `src/sync/`, optimizer, plus unit tests for its own code
- `reviewer` — read-only; **owns the verification gate** (tsc vs recorded count, Jest, `sync:validate`, web export) and the diff review
- `docs-specialist` — BUILD-LOG, `docs/v2/`, `docs/features/`, `plan-v2.md` status
- `git-committer` — explicit-path staging, Conventional Commits, ff-push; every commit ends with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer (user decision 2026-10-30)
- `test-specialist` — **disabled** (`.md.disabled`). Tests are written by the owning specialist, and the reviewer runs the gate.

**Orchestration (per wave, not per step):**
`planner` (new phase only) → `ui-specialist` ‖ `backend-specialist` (parallel on disjoint files; one well-scoped brief each) → `reviewer` (one gate + review) → fixes routed to the owning specialist → `docs-specialist` (one pass) → `git-committer` (one commit per wave).
- Keep spawns few and briefs complete: pass the BUILD-LOG step ids, file paths, and acceptance checks so agents don't re-explore.
- Tiny changes (a single file, obvious fix) can be done directly by the orchestrator, followed by a reviewer gate. No planner is needed.
- Specialists self-verify (tsc plus touched Jest paths) before returning, so the reviewer gate is a confirmation rather than a discovery step.

Release path: web on Cloudflare Pages + Android APK via EAS `preview` profile (or local build) for user testing → free-tier deploys → Google Play + App Store at the final version.

## Don'ts

- Don't install packages with `-g` globally.
- Don't run `supabase db reset` against anything other than local.
- Don't hardcode API keys; use `.env` / Supabase secrets.
- Don't bypass sub-agent roles — each one owns its scope.
- Don't force-push, rewrite history, or push to protected branches (`main`, `master`, `release/*`) as a force-push without explicit user confirmation. Regular fast-forward pushes by the `git-committer` agent are pre-authorized.
