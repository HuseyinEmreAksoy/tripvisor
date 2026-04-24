# Phase 2 — live smoke

**Date**: 2026-04-24
**Tester**: test-specialist (acting role)
**Build**: `master @ 8bfc57c` plus uncommitted Playwright infra
**Runner**: `npx playwright test e2e/web/phase-2-optimize.spec.ts`
**Status**: ⏸ **Blocked on live backend + auth fixture** — 0 / 1 checks executed

## Web (Chromium, localhost:8081)

- ⏸ Create trip → add places → tabs render — **skipped**: `EXPO_PUBLIC_SUPABASE_URL` blank; even with live backend, this spec needs a pre-authenticated `storageState` fixture (Phase 4 work)

## iOS / Android

- Deferred to user smoke

## Why this phase can't smoke yet

Phase 2's exit criteria require an authenticated user + at least 2 places added to a trip. That chain involves:

1. Supabase project provisioned (shared with Phase 1)
2. Edge Functions deployed: `places-autocomplete`, `place-details`, `distance-matrix`, `directions-polyline`, `optimize-trip`
3. Google Cloud project with Places API (New) + Routes API enabled + two keys (server into Supabase secrets, web client into `.env`)
4. A Playwright `storageState` fixture containing an authenticated session cookie/localStorage — not yet written

(3) is the heaviest step and is a one-time operator task. (4) is a Phase 4 test-specialist task; in the meantime, manual smoke by the user can cover this surface.

## Unblock checklist

Everything from Phase 1, plus:

1. Enable **Routes API** in Google Cloud Console (you likely already enabled Places API for Phase 1)
2. Create a server-only API key; do **not** restrict it by HTTP referer (it's called server-side)
3. Create a second key for the web client; restrict it by HTTP referer to `localhost:8081/*` + your deployed host
4. `npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=<server-key> ALLOWED_ORIGINS=http://localhost:8081`
5. `npx supabase functions deploy places-autocomplete place-details distance-matrix directions-polyline optimize-trip`
6. Add `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=<web-key>` to `.env`
7. For the Playwright fixture (Phase 4 work): capture an authenticated session via `page.goto('/login') → paste magic link`, then `context.storageState({ path: 'playwright/.auth/user.json' })`. Or, for a manual smoke now, sign up once in a real browser session and then click through the steps below

## Manual smoke — recommended for Phase 2 until Phase 4 lands

Once you've finished the unblock checklist:

1. Open `http://localhost:8081`, sign up + click magic link
2. Tap "New trip" → title "Lisbon 3 days", 8 h / day, Drive → Create
3. Tap "Add a place" → search "Belem Tower" → select → Add
4. Repeat with: "Jerónimos Monastery", "Alfama", "Castelo de São Jorge", "Oceanário"
5. Wait ~1 second — `StatusPill` should show "Optimizing…" then disappear
6. Switch to **Map** tab — expect day-color-coded pins + polyline overlay
7. Switch to **Itinerary** tab — expect places grouped under "Day 1" / "Day 2" headers with travel-time rows between them
8. Open Supabase Studio → `trip_legs` — rows present with non-null `polyline` and recent `computed_at`

Record any bug as a structured finding below.

## Findings

**None yet** — nothing was executed live.
