-- Tripvisor v2: duplicate_trip skips tombstoned trip_places
--
-- Bug: 0027_v2_sync_foundation added the `deleted` tombstone column to the
-- Tier-1 synced tables (flag-on deletes are `UPDATE … SET deleted = true`,
-- not hard DELETEs). duplicate_trip (0004_trip_lifecycle.sql; not redefined
-- by any later migration) still copied EVERY trip_places row of the source,
-- so places the user had deleted reappeared — live — in the copy.
--
-- Fix: recreate the function with `and deleted = false` on the trip_places
-- copy. trip_places is the only child table duplicate_trip copies (per
-- ADR-0006 trip_legs / trip_days / trip_shares are NOT cloned; trips itself
-- has no `deleted` column — archive is its lifecycle), so this is the only
-- filter needed. Everything else is byte-identical to 0004: same signature
-- (p_trip_id uuid) returns uuid, plpgsql, SECURITY DEFINER,
-- `set search_path = public, auth`, same authorization checks, same copied
-- columns, same grant to authenticated.
--
-- Additive: `create or replace` on an unchanged signature — no drop, no
-- client contract change (useDuplicateTrip keeps calling
-- rpc('duplicate_trip', { p_trip_id })).
--
-- Inverse (restores the 0004 behavior, i.e. re-introduces the bug): re-run
-- the `create or replace function public.duplicate_trip` block from
-- 0004_trip_lifecycle.sql (identical to the body below minus the
-- `and deleted = false` line). The grant is unchanged either way.

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
    start_date, end_date, anchor_place_id, archived_at
  )
  select
    user_id, title || ' (copy)', daily_hours_budget, transport_mode, timezone,
    start_date, end_date, null, null
  from public.trips
  where id = p_trip_id
  returning id into v_new_id;

  insert into public.trip_places (
    trip_id, google_place_id, lat, lng, user_title, category,
    visit_duration_minutes, notes, day_index, order_in_day
  )
  select
    v_new_id, google_place_id, lat, lng, user_title, category,
    visit_duration_minutes, notes, null, null
  from public.trip_places
  where trip_id = p_trip_id
    and deleted = false;  -- v2: never resurrect tombstoned places in the copy

  return v_new_id;
end;
$$;

grant execute on function public.duplicate_trip(uuid) to authenticated;
