# Phase 3 — live smoke

**Date**: 2026-04-24
**Tester**: test-specialist (acting role)
**Build**: `master @ 8bfc57c` plus uncommitted Playwright infra
**Runner**: `npx playwright test e2e/web/phase-3-manual-edit.spec.ts`
**Status**: ⏸ **Blocked on Phase 2 prerequisites + seeded data** — 0 / 2 checks executed

## Web (Chromium, localhost:8081)

- ⏸ Itinerary tab offers tab + add-place action — **skipped**: needs authenticated session and at least one existing trip
- ⏸ Settings tab exposes budget slider + transport mode — **skipped**: same preconditions

## iOS / Android

- Deferred to user smoke

## Why this phase can't smoke yet

Phase 3 layers on Phase 2. The drag / move-to-day / duration-override UI requires a trip with ≥ 2 places already added + optimized. Running Phase 3 smoke demands:

1. Everything from Phase 1 + 2 (Supabase, Edge Functions, GCP keys)
2. A pre-seeded trip fixture, **or** an authenticated session that the Playwright script can reuse across specs

Neither exists yet. Formal E2E coverage is a Phase 4 deliverable.

## Unblock checklist

All Phase 2 unblock items, plus either:

- **For Playwright automation**: write `tests/e2e/fixtures/auth.ts` that logs in once and saves `storageState`, then use `test.use({ storageState })` in Phase 3 specs; add a `test.beforeAll` that seeds a trip with 5 fixed places via direct Supabase calls. Defer to Phase 4.
- **For manual smoke now**: do the Phase 2 manual smoke first, then continue with the steps below.

## Manual smoke — recommended for Phase 3

Assuming Phase 2 manual smoke passed and you have a trip with 5 places:

1. On **Itinerary** tab, **drag** the 2nd place in Day 1 above the 1st — release
   - Order persists immediately (no `Optimizing…` pill, because this is a local reorder)
   - Reload the page → order is still the manual one
2. **Long-press** (or click-and-hold ~400ms on web) any place row → `PlaceActionsSheet` opens from the bottom
3. In the sheet, tap the **+** on the duration stepper three times — duration jumps by 45 minutes
   - Close sheet; within ~1s `StatusPill` shows "Optimizing…" because the budget shifted
   - Itinerary re-renders; day split may change if the increase pushed a day over budget
4. Re-open the sheet → tap **Move to day** → pick "Day 2" (or "Day 3 (new)")
   - Place disappears from Day 1, appears in Day 2
   - `trip_legs` will not fetch from Google because the matrix is cached; polyline for the affected day will be re-fetched
5. Re-open the sheet → **Delete this place** → confirm
   - Place disappears everywhere; optimize re-runs
6. On **Settings** tab, drag the **Daily hours budget** slider from 8 to 4
   - `Optimizing…` appears; itinerary now spans more days (places per day halved)
7. Change **Transport mode** to Walk
   - Optimize re-runs; travel times between places jump dramatically (walking is slower); some days may overflow

## Accessibility smoke (web)

1. Tab through the itinerary with keyboard only
   - Each place is focusable via Tab
   - Duration stepper reachable via Tab + Arrow keys adjust it
2. Open the place-actions sheet → Escape closes it; focus returns to the trigger
3. VoiceOver / TalkBack: each place row announces as "Open details for <name>. Long-press to change day, duration, or delete."

## Findings

**None yet** — nothing was executed live.
