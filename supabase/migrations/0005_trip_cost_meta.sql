-- Tripvisor Phase 8: trip-level cost rollup metadata (ADR-0007)
--
-- Adds two columns to public.trips so each trip can carry the unit-of-account
-- and the per-kilometer rate that the client-side cost rollup multiplies
-- against trip_legs.distance_meters. Per ADR-0007 the rollup itself is
-- computed on the client (pure function over already-cached data) so the
-- backend's only job here is to store the inputs.
--
-- Columns:
--   1. currency text not null default 'USD'
--      Bounded to a small fixed list ('USD','EUR','GBP','TRY','JPY') via
--      check constraint so the UI can render a segmented control / picker
--      without a free-form ISO list. Adding more (CHF, CAD, AUD, ...) is a
--      single-line ALTER on the constraint when product asks for it.
--   2. cost_per_km numeric(8,4) not null default 0.20
--      Precision (8,4) allows up to 9999.9999 — overkill but harmless and
--      cheaper than a future widening migration. Default 0.20 is a neutral
--      starter rate documented in ADR-0007; users override per-trip.
--
-- Backfill: `not null default ...` populates existing rows automatically as
-- part of the ALTER TABLE — no separate UPDATE needed.
--
-- RLS: unchanged. The existing `trips_owner_all` policy (auth.uid() =
-- user_id) gates both reads and writes for the whole row, including these
-- two new columns. RLS is row-level, not column-level, so additive columns
-- inherit the policy automatically.
--
-- Indexes: none. Both columns are read on a single-row trip query
-- (`select ... where id = $1`) and never used as filter / sort keys.
--
-- Rollback:
--   alter table public.trips drop constraint if exists trips_currency_check;
--   alter table public.trips drop column if exists cost_per_km;
--   alter table public.trips drop column if exists currency;

alter table public.trips
  add column if not exists currency text not null default 'USD',
  add column if not exists cost_per_km numeric(8,4) not null default 0.20;

alter table public.trips
  add constraint trips_currency_check
  check (currency in ('USD','EUR','GBP','TRY','JPY'));
