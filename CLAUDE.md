# Tripvisor — Project Instructions

Holiday route planner. Expo universal app (iOS / Android / Web) + Supabase + Google Maps Platform.

## Stack

- Expo (SDK 52+), Expo Router v4, TypeScript strict
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

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Platform-split components use `Foo.native.tsx` / `Foo.web.tsx` (and `.ios.tsx` / `.android.tsx` when needed); consumers import as `./Foo`.
- Server state via TanStack Query hooks in `src/api/`.
- Never persist Google Place data server-side beyond `google_place_id` + coordinates (30-day ToS ceiling).
- Never ship Google HTTP API keys to the client — proxy everything through Edge Functions.
- RLS on every child table, always scoped via `trips.user_id`.

## Sub-agents (use proactively, one role each)

- `planner` — phase decomposition + risk surfacing before work starts
- `ui-specialist` — UI code only
- `backend-specialist` — Supabase, Edge Functions, optimizer
- `test-specialist` — tests
- `reviewer` — debug + review (no code writes)
- `docs-specialist` — plan.md + docs/

Workflow per phase: `planner` → `ui-specialist` + `backend-specialist` (parallel) → `test-specialist` → `reviewer` → fixes → `docs-specialist`.

## Don'ts

- Don't install packages with `-g` globally.
- Don't push to git without explicit user confirmation.
- Don't run `supabase db reset` against anything other than local.
- Don't hardcode API keys; use `.env` / Supabase secrets.
- Don't bypass sub-agent roles — each one owns its scope.
