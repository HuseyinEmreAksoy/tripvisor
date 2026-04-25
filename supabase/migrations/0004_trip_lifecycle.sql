-- Tripvisor Phase 7: trip lifecycle (archive / duplicate / delete account)
--
-- Adds:
--   1. trips.archived_at — nullable timestamptz; nullable means "active".
--   2. trips_user_active_idx — partial index keeping the default Active list
--      query fast (filtered to archived_at IS NULL).
--   3. duplicate_trip(p_trip_id uuid) RETURNS uuid — clones a trip + its
--      trip_places per ADR-0006. Does NOT clone trip_legs / trip_days /
--      trip_shares; resets day_index, order_in_day, anchor_place_id,
--      archived_at on the new copy.
--   4. delete_account_cascade() RETURNS void — deletes all trips for the
--      caller. Cascade FKs on trips clean trip_places, trip_legs, trip_days,
--      trip_shares (verified in 0001_init.sql + 0003_share_links.sql — all
--      child FKs are ON DELETE CASCADE). The auth.users row is removed by
--      the delete-account Edge Function via the service-role admin client;
--      this RPC is a public.* cleanup primitive and does not touch auth.*.
--
-- Both functions are SECURITY DEFINER with `set search_path = public, auth`
-- to silence the Supabase linter and to lock the function's resolution path.
-- Authorization is enforced inside the function body via auth.uid().
--
-- RLS: existing `trips_owner_all` policy (auth.uid() = user_id) already gates
-- access to archived_at — no policy changes needed. The column lives on the
-- same row as user_id so the existing policy authorizes both reads and
-- writes (e.g. setting archived_at via .update() from the client).
--
-- Rollback:
--   drop function if exists public.duplicate_trip(uuid);
--   drop function if exists public.delete_account_cascade();
--   drop index  if exists public.trips_user_active_idx;
--   alter table public.trips drop column if exists archived_at;

-- ============================================================
-- 1. archived_at column + active partial index
-- ============================================================
alter table public.trips
  add column if not exists archived_at timestamptz;

create index if not exists trips_user_active_idx
  on public.trips(user_id)
  where archived_at is null;

-- ============================================================
-- 2. duplicate_trip(p_trip_id) — clones places, resets schedule
-- ============================================================
-- Per ADR-0006:
--   - Clone trip_places (google_place_id, lat, lng, user_title, category,
--     visit_duration_minutes, notes); reset day_index + order_in_day.
--   - Do NOT clone trip_legs / trip_days / trip_shares.
--   - Reset anchor_place_id (source anchor refers to source's trip_place row
--     and resolving the corresponding new row is non-trivial; user re-picks).
--   - Reset archived_at (a duplicate is always active, even from an archived
--     source).
--   - Title = source.title || ' (copy)'.
--
-- Authorization: caller must equal trips.user_id of the source. The function
-- raises 'not_authorized' (errcode 42501) on a foreign trip and 'not_found'
-- (errcode P0002) on an unknown id.
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
  where trip_id = p_trip_id;

  return v_new_id;
end;
$$;

grant execute on function public.duplicate_trip(uuid) to authenticated;

-- ============================================================
-- 3. delete_account_cascade() — wipe caller's public.* trip data
-- ============================================================
-- Wipes every trip belonging to the caller. FK cascades on trip_places,
-- trip_legs, trip_days, trip_shares (declared in 0001_init.sql /
-- 0003_share_links.sql) clean child rows automatically.
--
-- This RPC does NOT delete the auth.users row. The companion Edge Function
-- `delete-account` deletes the auth row via the admin client first (so a
-- partial failure leaves the user signed-in with their data intact), then
-- service-role-deletes public.* rows directly (since the JWT context is gone
-- after auth-delete and this RPC is RLS-gated by auth.uid()).
create or replace function public.delete_account_cascade()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.trips where user_id = v_caller;
end;
$$;

grant execute on function public.delete_account_cascade() to authenticated;
