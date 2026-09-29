-- Tripvisor v2: per-user daily quota for the Google/ORS-metered Edge Functions
-- (security audit 2026-09-29, finding #2)
--
-- places-autocomplete / place-details / distance-matrix / directions-polyline
-- now require a real signed-in user (supabase/functions/_shared/auth.ts
-- requireUser). On top of that, each call consumes a per-user, per-UTC-day
-- budget so ONE account (compromised, scripted, or a runaway client loop)
-- cannot drain the shared Google free credit. The same applies to the
-- place-photo fallback signer.
--
-- Ledger: reuse public.ai_usage (0020 §c). The panel decision there made it
-- "the quota table AND the usage ledger from day one", keyed
-- (user_id, day = current_date) in UTC buckets. This migration adds four
-- counters, one per metered kind:
--
--   places_autocomplete_calls  places-autocomplete requests
--   place_details_calls        place-details requests
--   routing_elements           billable routing elements:
--                              distance-matrix = origins × destinations,
--                              directions-polyline = 1 per route
--                              (2 when > 10 intermediates)
--   photo_signs                photo names signed via POST place-photo
--
-- The existing 0020 `routing_calls` column stays untouched ("reserved for
-- N5"; never written). Elements, not calls, are what Google bills for the
-- matrix, so a new column beats silently redefining the old one.
--
-- consume_usage_quota(p_user, p_kind, p_units, p_cap) is the single write
-- path for the new counters. It is atomic: one INSERT … ON CONFLICT DO UPDATE
-- … WHERE <counter> + p_units <= p_cap. Concurrent calls serialize on the
-- (user_id, day) row lock, and READ COMMITTED re-evaluates the WHERE against
-- the committed row, so the counter can never pass the cap. When the call
-- would exceed the cap NOTHING is consumed and it returns false (a client
-- retry storm on the 429 cannot wind the counter up).
--
-- The caps are NOT stored here. They live as constants in
-- supabase/functions/_shared/auth.ts (DAILY_QUOTA) and are passed per call,
-- the same "tuning is a redeploy, not a migration" rule as 0020 §d / 0021.
--
-- Privileges: EXECUTE for service_role ONLY. Edge Functions call it through
-- the admin client with the GoTrue-verified caller id. If `authenticated`
-- could call it, any user could exhaust another user's daily budget.
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon + authenticated, so both are revoked explicitly below.
--
-- Additive and idempotent: `add column if not exists`,
-- `create or replace function`, and revoke/grant are all safe to re-run.
-- Client contract unchanged: ai_usage SELECT-own RLS (0020) already covers
-- the new columns, and no client code reads them yet.
--
-- Inverse (rollback)
-- ------------------
--   drop function if exists public.consume_usage_quota(uuid, text, int, int);
--   alter table public.ai_usage
--     drop column if exists places_autocomplete_calls,
--     drop column if exists place_details_calls,
--     drop column if exists routing_elements,
--     drop column if exists photo_signs;
--   -- Roll back the Edge Functions FIRST. consumeQuota fails CLOSED: with
--   -- the RPC gone, every metered call answers 503 quota_unavailable.
--
-- Deploy order: apply this migration BEFORE deploying places-autocomplete,
-- place-details, distance-matrix, directions-polyline, place-photo and
-- optimize-trip, for the same reason.

-- ============================================================
-- 1. Counters on the existing ledger
-- ============================================================

alter table public.ai_usage
  add column if not exists places_autocomplete_calls int not null default 0,
  add column if not exists place_details_calls       int not null default 0,
  add column if not exists routing_elements          int not null default 0,
  add column if not exists photo_signs               int not null default 0;

comment on column public.ai_usage.places_autocomplete_calls is
  '0032: places-autocomplete requests today (UTC). Written only by consume_usage_quota().';
comment on column public.ai_usage.place_details_calls is
  '0032: place-details requests today (UTC). Written only by consume_usage_quota().';
comment on column public.ai_usage.routing_elements is
  '0032: billable routing elements today (UTC): distance-matrix origins×destinations + directions-polyline routes (2 when >10 intermediates). Written only by consume_usage_quota().';
comment on column public.ai_usage.photo_signs is
  '0032: photo names signed via POST place-photo today (UTC). Written only by consume_usage_quota().';

-- ============================================================
-- 2. consume_usage_quota — atomic check-and-increment
-- ============================================================

create or replace function public.consume_usage_quota(
  p_user  uuid,
  p_kind  text,
  p_units int,
  p_cap   int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user is null then
    raise exception 'consume_usage_quota: p_user is required';
  end if;
  if p_units is null or p_units < 1 then
    raise exception 'consume_usage_quota: p_units must be >= 1';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'consume_usage_quota: p_cap must be >= 0';
  end if;

  -- A single request larger than the whole daily budget can never fit.
  if p_units > p_cap then
    return false;
  end if;

  -- One statement per kind. The column name is never built from input
  -- (no dynamic SQL), so p_kind cannot inject anything.
  if p_kind = 'places_autocomplete' then
    insert into public.ai_usage as u (user_id, day, places_autocomplete_calls)
    values (p_user, current_date, p_units)
    on conflict (user_id, day) do update
      set places_autocomplete_calls = u.places_autocomplete_calls + excluded.places_autocomplete_calls
      where u.places_autocomplete_calls + excluded.places_autocomplete_calls <= p_cap;
  elsif p_kind = 'place_details' then
    insert into public.ai_usage as u (user_id, day, place_details_calls)
    values (p_user, current_date, p_units)
    on conflict (user_id, day) do update
      set place_details_calls = u.place_details_calls + excluded.place_details_calls
      where u.place_details_calls + excluded.place_details_calls <= p_cap;
  elsif p_kind = 'routing_elements' then
    insert into public.ai_usage as u (user_id, day, routing_elements)
    values (p_user, current_date, p_units)
    on conflict (user_id, day) do update
      set routing_elements = u.routing_elements + excluded.routing_elements
      where u.routing_elements + excluded.routing_elements <= p_cap;
  elsif p_kind = 'photo_sign' then
    insert into public.ai_usage as u (user_id, day, photo_signs)
    values (p_user, current_date, p_units)
    on conflict (user_id, day) do update
      set photo_signs = u.photo_signs + excluded.photo_signs
      where u.photo_signs + excluded.photo_signs <= p_cap;
  else
    raise exception 'consume_usage_quota: unknown kind %', p_kind;
  end if;

  -- FOUND is true when the INSERT inserted a row or the guarded DO UPDATE
  -- updated one. It is false only when the conflict row's WHERE (cap)
  -- rejected the update.
  return found;
end;
$$;

comment on function public.consume_usage_quota(uuid, text, int, int) is
  '0032 (audit #2): atomic per-user per-UTC-day quota check-and-increment over ai_usage. Kinds: places_autocomplete | place_details | routing_elements | photo_sign. Returns true and adds p_units when the new total stays <= p_cap; returns false and consumes NOTHING otherwise. Caps are passed by the caller (DAILY_QUOTA in supabase/functions/_shared/auth.ts). SECURITY DEFINER, search_path pinned, EXECUTE for service_role only.';

revoke all on function public.consume_usage_quota(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.consume_usage_quota(uuid, text, int, int) to service_role;
