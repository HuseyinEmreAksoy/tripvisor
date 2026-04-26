# Smoke log — Phase 22

**Phase**: 22 — Phase 21 cleanup + hardening
**Date**: 2026-04-26
**Status**: DEFERRED — automated tests (Step 22.9) and live smoke (Step 22.10) explicitly skipped per user direction on 2026-04-26. Same policy as Phase 21.

## Deferred state

The user directed the team to skip automated tests (Step 22.9) and live smoke (Step 22.10) for this phase. The hygiene check in Step 22.8 (`npx tsc --noEmit` + `npx supabase db reset`) was run and confirmed clean, but no browser golden-path walk was performed and no platform verification was recorded.

This file exists to make the deferred state visible. The three feature docs (`docs/features/expenses.md`, `docs/features/collaboration.md`, `docs/features/accommodation.md`) continue to carry empty platform-verified boxes — none were ticked in Phase 22.

## Note on migration filename

The editor-budget RLS migration was planned as `0014_trip_editor_budget_update.sql` but landed as `0015_trips_editor_budget_rls.sql` — slot 0014 was already taken by a prior fix migration. All references to this migration in docs use the actual filename `0015_trips_editor_budget_rls.sql`.

## Code-complete, unverified items

The following deliverables shipped at the code level in Phase 22 and are considered code-complete but unverified by smoke:

- **Editor-budget RLS** (`supabase/migrations/0015_trips_editor_budget_rls.sql`) — `trips_editor_budget_update` policy + `enforce_trips_column_restrictions` BEFORE UPDATE trigger. Owner short-circuits; editors may only update `total_budget` and `updated_at`; all other column changes raise `42501 insufficient_privilege`.
- **`manage-collaborators` `update` action** — owner-only; payload `{ collaboratorId, role }`; role whitelist `'viewer' | 'editor'`; idempotent. Error codes: `invalid_input` (400), `not_authenticated` (401), `not_owner` (403), `collaborator_not_found` (404).
- **`useUpdateCollaborator()` hook** (`src/api/trip-collaborators.ts`) — optimistic update + rollback; invalidates `tripCollaboratorsKeys.forTrip(tripId)` on success.
- **Unified `useTrips()`** (`src/api/trips.ts`) — returns UNION of owned + accepted-collaborator trips via RLS; secondary query attaches `{ isOwner, collaboratorRole }` per row; stable sort with `id.localeCompare` tiebreaker.
- **`Trip` type extension** (`src/api/types.ts`) — optional `isOwner?: boolean` + `collaboratorRole?: TripCollaboratorRole | null` (derived, not stored).
- **`useCollaboratedTrips()` deprecated** — JSDoc `@deprecated` pointing at `useTrips() and filter by isOwner === false`; implementation retained for Phase 23+ cleanup.
- **Cache invalidation**: `useDeclineCollaboratorInvite.onSuccess` and `useRevokeCollaborator.onSuccess` now invalidate `tripsKeys.all`.
- **Trips list** (`app/(app)/trips.tsx`) — dropped `useCollaboratedTrips`; consumes unified `useTrips()`, partitions by `isOwner`.
- **Collaborators screen** (`app/(app)/trip/[id]/collaborators.tsx`) — role chips on accepted rows are tappable in-place controls wired to `useUpdateCollaborator()`; "revoke + re-invite" notice removed.
- **`src/lib/formatCurrency.ts`** — `formatCurrency(amount, currency)` via `Intl.NumberFormat`; fallback for invalid codes; defaults to `'USD'`.
- **All five budget components** (`BudgetCard`, `BudgetEditSheet`, `CategoryBreakdown`, `ExpenseList`, `ExpenseEditSheet`) — accept `currency` prop; call `formatCurrency()`; amount inputs show currency code/symbol as read-only prefix; no hardcoded `$` remains.
- **`SettingsTab`** (`app/(app)/trip/[id]/index.tsx`) — threads `trip.currency` to all budget components.
- **`AccommodationEditSheet.tsx`** — `usePlacesAutocomplete` + `usePlaceDetails` wired with one `sessionToken` per sheet mount; suggestions list with day-color accents; "Linked: <name>" chip with X to unlink; `PlacesError` / `server_misconfigured` caught and rendered inline; manual address fallback preserved.

## Action required before feature status can advance to "Done"

1. Run automated tests: `npm test` and `npm run test:e2e` covering the four Phase 22 golden paths (editor budget update, in-place role change, unified trips list, accommodation autocomplete).
2. Walk web golden paths in a real browser and record PASS / FAIL per path.
3. Tick platform-verified boxes in `docs/features/expenses.md`, `docs/features/collaboration.md`, and `docs/features/accommodation.md` only after smoke passes on each platform.
4. Run reviewer pass covering the new RLS trigger, `update` action owner-gate, and `useTrips()` UNION correctness.
