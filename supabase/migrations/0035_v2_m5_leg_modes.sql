-- Tripvisor M5 Y1.1: per-leg transport modes ("drive half, transit the rest").
--
-- WHY: the product vision (2026-09-29) plans routes with flexible per-leg
-- transport. Today a trip has ONE transport_mode for every leg. M5 lets the
-- user override the mode of the leg INTO a place, set a default per day, and
-- add flight/ferry legs that no routing API computes.
--
-- WHAT (all additive, nullable = "inherit"):
--   §1  trip_places.arrival_mode / arrival_minutes: the user's override for the
--       leg that ARRIVES at this place (from its predecessor in the day).
--       Effective leg mode (Y2.3, optimize-trip):
--         to_place.arrival_mode ?? trip_days.transport_mode ?? trips.transport_mode
--       arrival_minutes is an optional user-given duration (flight/ferry/
--       transit); Y2.3 uses it as the leg duration with source 'user'.
--   §2  trip_days.transport_mode: per-day default mode (the 4 routable trip
--       modes; flight/ferry are per-leg only).
--   §3  trip_legs.source: who produced the leg ('ors' | 'google' | 'estimate' |
--       'user'); an estimate renders as "≈" in the timeline.
--   §4  duplicate_trip copies the trip home currency and the new place columns.
--
-- Roles: trip_places/trip_days keep their 0011 collab RLS: editors (and the
-- owner) may write arrival_mode/arrival_minutes/transport_mode; viewers stay
-- read-only. C1: these are USER-intent fields (client-writable, LWW-synced);
-- trip_legs stays server-written (optimize-trip) and never enters Tier-1.
--
-- Deploy order (cloud): push BEFORE any client build whose Tier-1 allowlist
-- lists arrival_mode/arrival_minutes/transport_mode (the hydration SELECT names
-- every allowlisted column; a client ahead of the DB gets PostgREST 400s on the
-- trip_places and trip_days roots). optimize-trip may keep inserting legs
-- without `source` until Y2.3 ships: the column default covers it.
--
-- Inverse (local only):
--   §4  re-run the `create or replace function public.duplicate_trip` block
--       from 0030 (grants are unchanged by CREATE OR REPLACE).
--   §3  alter table public.trip_legs drop constraint if exists trip_legs_source_check,
--         drop column if exists source;
--   §2  alter table public.trip_days drop constraint if exists trip_days_transport_mode_check,
--         drop column if exists transport_mode;
--   §1  alter table public.trip_places
--         drop constraint if exists trip_places_arrival_mode_check,
--         drop constraint if exists trip_places_arrival_minutes_check,
--         drop column if exists arrival_minutes, drop column if exists arrival_mode;
--   (LOSSY for user overrides; export first.)

-- ============================================================
-- §1. trip_places: per-leg arrival override
-- ============================================================
alter table public.trip_places
  add column if not exists arrival_mode    text,
  add column if not exists arrival_minutes integer;

alter table public.trip_places drop constraint if exists trip_places_arrival_mode_check;
alter table public.trip_places
  add constraint trip_places_arrival_mode_check
  check (arrival_mode is null
         or arrival_mode in ('driving', 'walking', 'bicycling', 'transit', 'flight', 'ferry'));

-- 1 minute to 24 h. Independent of arrival_mode on purpose: a cross-column
-- rule would turn a UI that clears the mode before the minutes into a Tier-1
-- write the server rejects forever (hydrate.ts retry caveat). Consumers only
-- read arrival_minutes when arrival_mode is set.
alter table public.trip_places drop constraint if exists trip_places_arrival_minutes_check;
alter table public.trip_places
  add constraint trip_places_arrival_minutes_check
  check (arrival_minutes is null or arrival_minutes between 1 and 1440);

comment on column public.trip_places.arrival_mode is
  'M5 (0035): user override for the leg ARRIVING at this place: driving|walking|bicycling|transit|flight|ferry. NULL = inherit trip_days.transport_mode, then trips.transport_mode. Client-writable (editor+), Tier-1 synced.';
comment on column public.trip_places.arrival_minutes is
  'M5 (0035): optional user-given duration (1–1440 min) of the arriving leg, used when arrival_mode is set (flight/ferry/transit). NULL = compute or estimate.';

-- ============================================================
-- §2. trip_days: per-day default mode
-- ============================================================
alter table public.trip_days
  add column if not exists transport_mode text;

-- Same 4 values as trips_transport_mode_check (0016).
alter table public.trip_days drop constraint if exists trip_days_transport_mode_check;
alter table public.trip_days
  add constraint trip_days_transport_mode_check
  check (transport_mode is null
         or transport_mode in ('driving', 'walking', 'transit', 'bicycling'));

comment on column public.trip_days.transport_mode is
  'M5 (0035): per-day default leg mode (driving|walking|transit|bicycling). NULL = inherit trips.transport_mode. Overridden per leg by trip_places.arrival_mode.';

-- ============================================================
-- §3. trip_legs.source
-- ============================================================
-- NOT NULL with a constant default: a metadata-only ADD COLUMN (no table
-- rewrite). Existing rows read 'ors'.
alter table public.trip_legs
  add column if not exists source text not null default 'ors';

alter table public.trip_legs drop constraint if exists trip_legs_source_check;
alter table public.trip_legs
  add constraint trip_legs_source_check
  check (source in ('ors', 'google', 'estimate', 'user'));

-- Transit has only ever been computed by Google (ORS has no transit profile),
-- so label the existing transit legs truthfully. The provider of the other
-- legacy legs is not recorded anywhere; they keep the default and age out
-- under the 30-day ToS purge (0019 §4b) within a month.
update public.trip_legs
   set source = 'google'
 where transport_mode = 'transit'
   and source = 'ors';

comment on column public.trip_legs.source is
  'M5 (0035): leg provenance: ors | google | estimate (haversine-based fallback, shown as ≈) | user (trip_places.arrival_minutes). Written only by optimize-trip (C1).';

-- ============================================================
-- §4. duplicate_trip: carry the home currency + the new place columns
-- ============================================================
-- 0030 body, plus:
--   - trips.currency is copied. Before M5 the copy silently fell back to the
--     column default ('USD'), which is wrong for any non-USD trip and matters
--     now that expense rates are frozen against the home currency.
--   - trip_places.arrival_mode / arrival_minutes are copied (user intent, like
--     notes). day_index/order_in_day still reset to NULL (ADR-0006), so the
--     optimizer re-places the stops on its next run.
-- Unchanged on purpose (ADR-0006): trip_legs, trip_days (incl. the new
-- transport_mode), trip_shares, trip_expenses and every memory table are NOT
-- cloned: a duplicate is a fresh plan, and copying recorded spend would
-- double-count it in analytics. Same signature, SECURITY DEFINER,
-- search_path, authorization checks; CREATE OR REPLACE keeps the 0031 ACL
-- (authenticated + service_role, no anon/PUBLIC), re-asserted below.
create or replace function public.duplicate_trip(p_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_new_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select user_id into v_owner from public.trips where id = p_trip_id;
  if v_owner is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_owner <> v_caller then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.trips (
    user_id, title, daily_hours_budget, transport_mode, timezone,
    start_date, end_date, anchor_place_id, archived_at, currency
  )
  select
    user_id, title || ' (copy)', daily_hours_budget, transport_mode, timezone,
    start_date, end_date, null, null, currency
  from public.trips
  where id = p_trip_id
  returning id into v_new_id;

  insert into public.trip_places (
    trip_id, google_place_id, lat, lng, user_title, category,
    visit_duration_minutes, notes, day_index, order_in_day,
    arrival_mode, arrival_minutes
  )
  select
    v_new_id, google_place_id, lat, lng, user_title, category,
    visit_duration_minutes, notes, null, null,
    arrival_mode, arrival_minutes
  from public.trip_places
  where trip_id = p_trip_id
    and deleted = false;  -- v2: never resurrect tombstoned places in the copy

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_trip(uuid) from public, anon;
grant execute on function public.duplicate_trip(uuid) to authenticated, service_role;
