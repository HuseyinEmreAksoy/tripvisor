-- Tripvisor Phase 20 Step 6: category-based budget model (replaces cost_per_km).
--
-- Why this exists
-- ---------------
-- User feedback (2026-04-25, issue #10): the per-kilometer cost rate model
-- (introduced in 0005_trip_cost_meta.sql) only estimates *travel* cost and is
-- not how holiday budgets are actually tracked. Real planning thinks in
-- categories — accommodation, food, transport, shopping, activities, other —
-- with optional total-trip ceiling and post-trip "actual" reconciliation.
--
-- This migration introduces the data model. UI surfaces follow in Phase 21
-- Step 4. `trips.cost_per_km` is intentionally KEPT (deprecated, not dropped)
-- so existing data and the existing TripCostRollup component keep working
-- until the UI fully migrates.
--
-- Schema additions
-- ----------------
-- 1. `trips.total_budget numeric null` — optional total-trip ceiling. Any
--    currency (the existing `trips.currency` column carries the unit). Sum
--    of `trip_expenses.amount` may exceed or fall short of this; the UI
--    will display both for at-a-glance tracking. Nullable so trips that
--    only track per-category have nothing forced on them.
--
-- 2. `public.trip_expenses` — one row per expense entry. Supports:
--    - `category` ∈ {accommodation, food, transport, shopping, activities, other}
--      (matches the user's request literally; `activities` is a useful 6th
--      bucket that came up in the brainstorm and is cheap to add now).
--    - `kind` ∈ {estimated, actual} — both can coexist for the same
--      trip/category. Estimated rows are pre-trip planning; actual rows
--      are post-trip reconciliation. Phase 21 will surface variance.
--    - `day_index int null` — optional pinning to a specific day (`null`
--      means "trip-level"). No FK to trip_days because trip_days rows are
--      sparse (only created when the user pins anchors / writes notes);
--      the day_index is a logical reference, validated by the UI.
--    - `label text null` — free-text line item ("Hotel night 2", "Lunch").
--      Intentionally NOT a place reference — categories like
--      accommodation/food are routinely entered without a Google place,
--      and tying them to trip_places would force users into the place
--      search flow for a coffee receipt.
--    - `amount numeric` (no precision cap) — currency-agnostic; the parent
--      trip's `currency` column carries the unit. Check constraint
--      `amount >= 0` rejects negative entries (refunds get a separate
--      categorization later if product asks).
--
-- RLS
-- ---
-- Matches the existing trip-children pattern: gate every operation on
-- `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())`. We split
-- into per-action policies (select/insert/update/delete) rather than the
-- single `for all` that the older 0001_init tables use, because PostgREST
-- emits clearer error envelopes when a specific verb is denied — useful
-- for the Phase 21 UI surface that may distinguish "you can't see this"
-- (no select) from "you can't change this" (no update).
--
-- Index
-- -----
-- One index on `trip_id` covers the dominant query pattern: list a trip's
-- expenses (`SELECT * FROM trip_expenses WHERE trip_id = $1`). No
-- composite (trip_id, category) index because the per-category sums are
-- a tiny aggregate (typically <50 rows / trip) and the UI re-aggregates
-- in JS anyway.
--
-- updated_at trigger
-- ------------------
-- Reuses `public.set_updated_at()` from 0001_init.sql, matching the
-- convention used by trip_places.
--
-- Rollback
-- --------
--   drop trigger if exists trip_expenses_set_updated_at on public.trip_expenses;
--   drop table  if exists public.trip_expenses;
--   alter table public.trips drop column if exists total_budget;

-- ============================================================
-- 1. trips.total_budget
-- ============================================================
alter table public.trips
  add column if not exists total_budget numeric null;

comment on column public.trips.total_budget is
  'Optional total-trip budget (any currency; unit is trips.currency). Sum of trip_expenses.amount may exceed or fall short of this; UI displays both for at-a-glance tracking.';

-- ============================================================
-- 2. trip_expenses
-- ============================================================
create table if not exists public.trip_expenses (
  id          uuid primary key default uuid_generate_v4(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  category    text not null
              check (category in (
                'accommodation','food','transport','shopping','activities','other'
              )),
  amount      numeric not null check (amount >= 0),
  -- estimated: planned spend before/during trip
  -- actual: recorded after the fact
  kind        text not null
              check (kind in ('estimated','actual'))
              default 'estimated',
  -- Optional day scoping; null means "trip-level" (not pinned to a specific day).
  day_index   int null,
  -- Free-text label for the line item. NOT a place reference; intentionally separate.
  label       text null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.trip_expenses is
  'Phase 20 Step 6: category-based expense tracking. Replaces the per-km cost rate model. estimated rows are planned spend; actual rows are recorded after the fact. Both can coexist for the same trip/category.';

-- ============================================================
-- 3. RLS — scope every action through trips.user_id
-- ============================================================
alter table public.trip_expenses enable row level security;

create policy "trip_expenses_owner_select" on public.trip_expenses
  for select to authenticated
  using (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_expenses_owner_insert" on public.trip_expenses
  for insert to authenticated
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_expenses_owner_update" on public.trip_expenses
  for update to authenticated
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_expenses_owner_delete" on public.trip_expenses
  for delete to authenticated
  using (trip_id in (select id from public.trips where user_id = auth.uid()));

-- ============================================================
-- 4. Index for the dominant access pattern
-- ============================================================
create index if not exists trip_expenses_trip_id_idx on public.trip_expenses (trip_id);

-- ============================================================
-- 5. updated_at trigger (reuses public.set_updated_at from 0001_init.sql)
-- ============================================================
create trigger trip_expenses_set_updated_at
  before update on public.trip_expenses
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Deprecate trips.cost_per_km (kept for back-compat; future migration will drop)
-- ============================================================
comment on column public.trips.cost_per_km is
  'DEPRECATED 2026-04-25 (Phase 20 Step 6). Use trip_expenses table for category-based budget tracking. Kept for back-compat until UI fully migrates.';
