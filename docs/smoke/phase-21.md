# Smoke log — Phase 21

**Phase**: 21 — Budget tracking + collaboration + accommodation tracking
**Date**: 2026-04-25
**Status**: DEFERRED — automated tests and live smoke explicitly skipped per user direction on 2026-04-25.

## Deferred state

The user directed the team to skip automated tests (Step 21.14) and live smoke (Step 21.15) for this phase. No Playwright E2E scripts were authored, no browser golden-path walk was performed, and no platform verification was recorded. Steps 21.16 (reviewer pass) and 21.17 (fix loop) were also skipped as a consequence.

This file exists to make the deferred state visible to anyone reading the smoke log directory. The three feature docs (`docs/features/expenses.md`, `docs/features/collaboration.md`, `docs/features/accommodation.md`) all carry empty platform-verified boxes reflecting this state.

## Code-complete, unverified items

The following user-priority deliverables shipped at the code level in Phase 21 and are considered code-complete but unverified:

- Budget UI — `BudgetCard`, `BudgetEditSheet`, `CategoryBreakdown`, `ExpenseList`, `ExpenseEditSheet` integrated into trip detail Settings tab; role-gated via `canEditTrip`; color-coded spend thresholds (green / amber / red).
- Trip collaboration — `trip_collaborators` table + RLS; `manage-collaborators` Edge Function (invite / accept / decline / revoke / list); collaborators management screen; invite-accept screen with auth guard; "Shared with me" section on trips list; `useTripRole` hook gating edit affordances across trip-scoped screens.
- Accommodation tracking — `trip_accommodations` table + RLS (owner-only in `0012`, collaborator-aware in `0013`); `AccommodationList`, `AccommodationCard`, `AccommodationEditSheet`, `StayingAtPill`; integrated into trip detail Settings tab and itinerary day headers.
- `user_can_access_trip` SQL helper and `current_user_email` helper replacing per-table owner-only RLS policies across all trip-child tables.
- Six new budget theme tokens in `src/theme/tokens.ts`.
- `tripCollaboratorsKeys` and `tripAccommodationsKeys` in `src/api/_keys.ts`.

## Action required before feature status can advance to "Done"

1. Run automated tests: `npm test` (unit + RLS integration) and `npm run test:e2e` (Playwright E2E for all three golden paths).
2. Walk web golden paths in a real browser and record PASS / FAIL per path in an updated version of this file (or a separate phase-21-recheck.md).
3. Tick platform-verified boxes in `docs/features/expenses.md`, `docs/features/collaboration.md`, and `docs/features/accommodation.md` only after smoke passes on each platform.
4. Run reviewer pass (Step 21.16) covering RLS correctness, email-enumeration safety, ToS compliance, and viewer-role gating.
