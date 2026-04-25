# expenses

**Status**: 🚧 In progress — data layer shipped Phase 20 (2026-04-25); UI shipped Phase 21 (2026-04-25); web smoke pending (skipped per user direction).
**Owner agents**: backend-specialist (data layer), ui-specialist (UI)
**Depends on**: trip-crud

## Platforms verified
- ☐ iOS — smoke not yet run
- ☐ Android — smoke not yet run
- ☐ Web — smoke explicitly skipped per user direction 2026-04-25
(Automated tests and live smoke were skipped for Phase 21 per user direction. No platform box may be ticked until smoke is run.)

## User story
As a trip planner, I want to track estimated and actual expenses by category (accommodation, food, transport, etc.) and set a total trip budget, so I can see whether my holiday is on track financially.

## UI (shipped Phase 21)

Components live in `src/components/budget/`:

- **`BudgetCard.tsx`** — summary card on the trip detail Settings tab showing total budget, total estimated, total actual, remaining amount. Color-coded: green (`budgetOk`) when under budget, amber (`budgetWarn`) when within 10% of limit, red (`budgetOverLimit`) when over. Uses theme tokens from `src/theme/tokens.ts`.
- **`BudgetEditSheet.tsx`** — modal sheet for setting `trips.total_budget`. Calls `useUpdateTripBudget`. Owner-only (gated via `canEditTrip && isOwner`).
- **`CategoryBreakdown.tsx`** — per-category horizontal bar rollup. Read-only; derived from `useTripExpenseRollup`.
- **`ExpenseList.tsx`** — scrollable list of all expenses with edit/delete row actions. Gated: edit and delete affordances hidden for viewers.
- **`ExpenseEditSheet.tsx`** — create/edit sheet with category picker, kind toggle (estimated / actual), amount field, optional day picker, optional label.

All five components are integrated into the Settings tab of `app/(app)/trip/[id]/index.tsx`.

Budget currency symbol is currently rendered as a static `$`. `trip.currency` is not yet threaded through — see Known limitations.

### Color thresholds

| State | Condition | Token |
|---|---|---|
| Ok | spent < 90% of budget | `budgetOk` / `budgetOkLight` |
| Warn | 90% <= spent < 100% | `budgetWarn` / `budgetWarnLight` |
| Over | spent >= 100% | `budgetOverLimit` / `budgetOverLimitLight` |

### Role gating

`useTripRole(tripId)` returns `canEditTrip`. When `canEditTrip` is false (viewer or not a member) all add/edit/delete affordances are hidden. The budget edit sheet is additionally restricted to `isOwner` because `trips.total_budget` is owner-write-only at the RLS level.

## Data

### `trips.total_budget`
Nullable column `total_budget numeric null` on `trips` (migration `0010_trip_budget_categories.sql`). Currency inherited from `trips.currency`. The deprecated `cost_per_km` column is retained for backwards compatibility with a `COMMENT ON COLUMN` deprecation note.

### `trip_expenses` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_id` | `uuid fk trips` | cascade on delete |
| `category` | `text` | CHECK IN (`accommodation`, `food`, `transport`, `shopping`, `activities`, `other`) |
| `kind` | `text` | CHECK IN (`estimated`, `actual`) |
| `amount` | `numeric` | CHECK `amount >= 0` |
| `label` | `text null` | optional user description |
| `day_index` | `int null` | links to a specific trip day; null = trip-level |
| `created_at` | `timestamptz` | `now()` |

**RLS** (updated Phase 21 migration `0011`): SELECT delegates to `user_can_access_trip(trip_id, auth.uid(), 'viewer')`; INSERT/UPDATE/DELETE delegates to `user_can_access_trip(trip_id, auth.uid(), 'editor')`. Replaces the previous owner-only policies from migration `0010`.

## APIs
- `src/api/trip-expenses.ts` — Zod schema + TypeScript types; TanStack Query hooks:
  - `useTripExpenses(tripId)` — reads all expenses for a trip
  - `useCreateTripExpense()` — inserts a new expense row (optimistic + rollback)
  - `useUpdateTripExpense()` — updates amount, label, category, or kind (optimistic + rollback)
  - `useDeleteTripExpense()` — deletes an expense row (optimistic + rollback)
  - `useTripExpenseRollup(tripId)` — derived hook; memoized; returns `{ byCategory, totalEstimated, totalActual, budget, remaining, hasBudget }`; no extra network request
- `src/api/trips.ts` — `useUpdateTripBudget(tripId)` mutation; optimistic + rollback
- Query keys live in `src/api/_keys.ts` (shared leaf module).

## Edge cases
- `amount` must be non-negative (enforced by CHECK constraint and Zod schema).
- `category` and `kind` are closed enums — Zod rejects unknown values before they reach the DB.
- `day_index` is optional; a trip-level expense (e.g. "flight booking") omits it.
- Deleting a trip cascades to `trip_expenses` via FK.
- Viewer collaborators can see the budget and expenses but cannot add, edit, or delete.
- Editor collaborators can add/edit/delete expenses but cannot change `total_budget` (owner-only RLS on `trips`).

## Test plan
- Unit: `useTripExpenseRollup` math (zero expenses, null budget, single category, mixed kinds). Deferred — Phase 21 tests skipped per user direction.
- Integration: RLS two-user isolation (viewer can SELECT but not INSERT; editor can INSERT; non-member gets 0 rows). Deferred — Phase 21 tests skipped.
- E2E (web Playwright): enter 5 expenses across categories, verify rollup, edit one, delete one. Deferred.
- Manual native smoke (iOS + Android): deferred.

## Known limitations
1. Budget UI uses static `$` symbol — `trip.currency` is not threaded through budget components.
2. Editor collaborators cannot edit `trips.total_budget` (owner-only RLS on `trips`). May require a per-column policy relaxation in Phase 22.
3. Per-leg or per-place expense granularity is out of scope for MVP; `day_index` provides day-level granularity.
4. `cost_per_km` on `trips` is deprecated but not dropped; any UI referencing it is legacy.
