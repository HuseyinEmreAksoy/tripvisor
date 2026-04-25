# expenses

**Status**: 🚧 In progress — data layer shipped Phase 20 (2026-04-25); UI deferred to Phase 21.
**Owner agents**: backend-specialist (data layer), ui-specialist (UI — Phase 21)
**Depends on**: trip-crud

## Platforms verified
- ☐ iOS — pending Phase 21 UI implementation
- ☐ Android — pending Phase 21 UI implementation
- ☐ Web — pending Phase 21 UI implementation
(Data layer is live on all platforms; UI implementation is Phase 21.)

## User story
As a trip planner, I want to track estimated and actual expenses by category (accommodation, food, transport, etc.) and set a total trip budget, so I can see whether my holiday is on track financially.

## UI
- Phase 21 — not yet implemented.
- Planned surfaces: expense entry sheet (category picker, kind toggle, amount field, optional day); budget summary card on trip detail; estimated vs actual rollup.

## Data

### `trips.total_budget`
New nullable column `total_budget numeric null` on the `trips` table (migration `0010_trip_budget_categories.sql`). Stores the user's overall financial budget for the trip. Currency inherited from `trips.currency`. The old `cost_per_km` column is retained for backwards compatibility but marked deprecated via `COMMENT ON COLUMN`.

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

**RLS**: four policies (select / insert / update / delete) all scoped via `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())`.

## APIs
- `src/api/trip-expenses.ts` — Zod schema + TypeScript types; TanStack Query hooks:
  - `useTripExpenses(tripId)` — reads all expenses for a trip
  - `useCreateTripExpense()` — inserts a new expense row
  - `useUpdateTripExpense()` — updates amount, label, category, or kind
  - `useDeleteTripExpense()` — deletes an expense row
- Query keys live in `src/api/_keys.ts` (shared leaf module, avoids circular imports).
- Re-exported from `src/api/index.ts`.

## Edge cases
- `amount` must be non-negative (enforced by CHECK constraint and Zod schema).
- `category` and `kind` are closed enums — the Zod schema rejects unknown values before they reach the DB.
- `day_index` is optional; a trip-level expense (e.g. "flight booking") omits it.
- Deleting a trip cascades to `trip_expenses` via FK.

## Test plan
- Unit: Zod schema validation (valid/invalid category, kind, amount < 0).
- Integration: RLS two-user isolation (user A cannot read/write user B's expenses).
- E2E: deferred to Phase 21 (no UI surface yet).
- Manual native smoke: deferred to Phase 21.

## Known limitations
- No UI yet — the data layer is ready but expense entry requires Phase 21 implementation.
- `cost_per_km` on `trips` is deprecated but not dropped; any existing UI referencing it should be considered legacy.
- Per-leg or per-place expense granularity is out of scope for MVP; `day_index` provides day-level granularity.
