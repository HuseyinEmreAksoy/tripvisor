-- Tripvisor Phase 21 Steps 21.8 / 21.9: dedicated trip_accommodations table.
--
-- Why this exists
-- ---------------
-- User feedback (2026-04-25) promoted accommodation tracking from a brainstorm
-- bullet to a near-term roadmap item. Two design choices, both locked in
-- plan.md:
--
-- 1. Dedicated table (NOT an extension of `trip_expenses`).
--    Accommodations have date-range semantics — "Hilton Rome, check-in Apr 12,
--    check-out Apr 15" is one logical entity that spans three nights — that
--    don't fit the single-event `trip_expenses` row shape. Modelling them as
--    expenses would force either:
--      (a) one row per night (duplicates the lodging name N times, forces N
--          edits when you change the address), or
--      (b) overloading `label` / `created_at` to encode dates (defeats the
--          purpose of a typed schema).
--    A dedicated table with explicit `check_in_date` / `check_out_date`
--    columns is clean and lets the trip detail surface render a stay as a
--    single timeline span.
--
-- 2. Optional `google_place_id` + free-text `address` fallback.
--    Most users will autocomplete a hotel via the existing Places API flow,
--    and we want the lat/lng anchor for map rendering and (later) routing.
--    But Airbnb / "staying with Sarah" / a guesthouse the user found on a
--    blog often won't have a clean Google Place match — forcing one would
--    push users into typing fake names into autocomplete. The schema lets
--    either branch exist via two paired CHECK constraints (see below).
--
-- 3. Cost is OUT OF SCOPE.
--    The accommodation cost stays a regular `trip_expenses` row in the
--    `accommodation` category. We do NOT add `accommodation_id` to
--    `trip_expenses` here — the back-link is a future phase if/when product
--    asks for "show the cost broken down by stay". For v1 the two tables
--    are logically separate; the UI sums per-category as today.
--
-- Schema
-- ------
-- See the locked spec in plan.md. Highlights:
--   - id / trip_id / created_at / updated_at — standard trip-child shape.
--   - name (not null) — what the user calls the place ("Hilton Rome",
--     "Sarah's flat"). Always present, regardless of whether
--     google_place_id is set.
--   - google_place_id (nullable) — optional anchor; when present, we ALSO
--     persist the lat/lng coordinates that Google returned, which is
--     permitted under Google's ToS because they are tied to (and
--     refreshable from) `google_place_id`. The lat/lng are NOT independent
--     persisted Place data — they are the identifier's cached location,
--     same pattern as `trip_places`.
--   - address (nullable) — free-text fallback when no Google place. Either
--     branch (google_place_id or address) is acceptable on its own; both
--     can coexist if the user picked a Google place AND wants to override
--     the displayed address.
--   - check_in_date / check_out_date (both not null, dates only — we don't
--     model time-of-day check-in for v1; product will revisit if hourly
--     hotel scheduling becomes a thing).
--   - notes (nullable) — free-text per-stay notes.
--
-- CHECK constraints
-- -----------------
-- 1. check_out_date > check_in_date — a single-night stay is Apr 12 -> Apr
--    13, not Apr 12 -> Apr 12. Strictly greater, not >=, because a zero-
--    night stay is meaningless and almost certainly a UI bug.
-- 2. (google_place_id IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL)
--    — if anchored to a Google place, both coordinates must be present.
--    The inverse (address-only with no place id) is allowed without
--    coordinates because we have no reliable geocoder budget to enforce
--    them; the map surface will simply omit free-text-only stays from the
--    overview map (or geocode lazily client-side if product asks later).
--
-- RLS
-- ---
-- TEMPORARILY scoped via the existing trip-child pattern:
--   trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())
-- The collaboration spine slice (running concurrently in this phase) will
-- rewrite RLS across all trip-child tables to use a `user_can_access_trip`
-- helper. We deliberately do NOT reference that helper here because it
-- may not exist when this migration runs — migrations replay in numeric
-- order and 0011 (the collaboration migration) sits between us and 0010,
-- but a future re-ordering or partial replay must not break this slice.
-- The collaboration agent will rewrite these policies as part of its
-- sweep; this is intentional and coordinated.
--
-- Per-action policies (select / insert / update / delete) instead of a
-- single `for all`, matching the 0010 pattern — PostgREST emits cleaner
-- error envelopes per verb.
--
-- Index
-- -----
-- (trip_id, check_in_date) — the dominant query pattern is "list a trip's
-- stays in chronological order for the trip detail screen". A composite
-- index serves both the WHERE and the ORDER BY in one scan.
--
-- updated_at trigger
-- ------------------
-- Reuses `public.set_updated_at()` from 0001_init.sql, matching the
-- convention used by trip_places / trip_expenses.
--
-- Rollback
-- --------
--   drop trigger if exists trip_accommodations_set_updated_at on public.trip_accommodations;
--   drop table   if exists public.trip_accommodations;

-- ============================================================
-- 1. trip_accommodations
-- ============================================================
create table if not exists public.trip_accommodations (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  name            text not null,
  -- Optional Google Place anchor; nullable so users can record a stay that
  -- has no Google match (Airbnb, friend's flat, indie guesthouse).
  google_place_id text null,
  -- Free-text fallback address; rendered when google_place_id is null.
  address         text null,
  -- Denormalized coordinates for the Google place (permitted by ToS as
  -- they are tied to google_place_id, same pattern as trip_places).
  lat             numeric null,
  lng             numeric null,
  check_in_date   date not null,
  check_out_date  date not null,
  notes           text null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A stay must span at least one night.
  constraint trip_accommodations_dates_chk
    check (check_out_date > check_in_date),
  -- If anchored to a Google place, both coordinates must be present.
  -- The inverse (address-only) is allowed without coordinates.
  constraint trip_accommodations_place_coords_chk
    check (
      google_place_id is null
      or (lat is not null and lng is not null)
    )
);

comment on table public.trip_accommodations is
  'Phase 21: per-trip lodging entries with date-range semantics. Anchored to a Google Place when available; falls back to free-text address. Cost is recorded separately in trip_expenses (category=accommodation).';

comment on column public.trip_accommodations.google_place_id is
  'Optional Google Place anchor. When set, lat/lng MUST be set (CHECK constraint). When null, address is the user-facing location.';

comment on column public.trip_accommodations.lat is
  'Denormalized from the Google Place referenced by google_place_id. Permitted under Google ToS only because it is tied to google_place_id.';

-- ============================================================
-- 2. RLS — TEMPORARY owner-only policies.
--    The collaboration migration (0011) will rewrite these to use the
--    user_can_access_trip helper. Keep this section minimal and
--    self-contained so the collab sweep is a clean replace.
-- ============================================================
alter table public.trip_accommodations enable row level security;

create policy "trip_accommodations_owner_select" on public.trip_accommodations
  for select to authenticated
  using (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_accommodations_owner_insert" on public.trip_accommodations
  for insert to authenticated
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_accommodations_owner_update" on public.trip_accommodations
  for update to authenticated
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_accommodations_owner_delete" on public.trip_accommodations
  for delete to authenticated
  using (trip_id in (select id from public.trips where user_id = auth.uid()));

-- ============================================================
-- 3. Index for the dominant access pattern (trip detail render)
-- ============================================================
create index if not exists trip_accommodations_trip_checkin_idx
  on public.trip_accommodations (trip_id, check_in_date);

-- ============================================================
-- 4. updated_at trigger (reuses public.set_updated_at from 0001_init.sql)
-- ============================================================
create trigger trip_accommodations_set_updated_at
  before update on public.trip_accommodations
  for each row execute function public.set_updated_at();
