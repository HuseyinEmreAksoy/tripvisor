-- Tripvisor v2 M5 (Y1.2): share-link toggles, user preferences, POI cache,
-- global service counters. BUILD-LOG §M5, ADR-0013 (recommendations),
-- ADR-0014 (memories), user decision 2026-09-29 (memories private by default).
--
-- Sections (each idempotent):
--   1. trip_shares.{show_itinerary, show_expenses, show_memories}
--   2. user_preferences (owner-only)
--   3. poi_cache (service-role writes, authenticated reads) + nightly purge
--   4. service_usage + consume_service_usage()  (global per-service day caps)
--   5. ai_usage.poi_requests + consume_poi_quota() (per-user day cap)
--   6. EXECUTE matrix (0031 posture: nothing for anon/PUBLIC)
--
-- ===========================================================================
-- SQL CONTRACT FOR Y1.3 (fx-rates / poi-recommend) and Y2.x
-- ===========================================================================
-- All writes below are SERVICE ROLE ONLY (Edge Functions' admin client).
-- Clients can read poi_cache / service_usage (non-sensitive), never write.
--
-- poi_cache (key text PK, payload jsonb, fetched_at timestamptz)
--   Key convention (recommended, versioned so a payload-shape change is a
--   cache miss instead of a parse error):
--     'ovp:v1:<geohash5>:<interest>'        one Overpass tile x interest
--     'wiki:v1:<wikidataQid>:<lang>'        one Wikipedia summary
--     'wgeo:v1:<geohash5>:<lang>'           Wikipedia GeoSearch fallback
--   key: 1-200 chars. payload: TRIMMED JSON, at most 256 KiB as text (a
--   bigger upsert fails with 23514: treat as "don't cache", never fatal).
--   Freshness: a row is a HIT only when fetched_at > now() - 30 days;
--   pg_cron deletes rows older than 30 days nightly (04:30 UTC).
--     read : admin.from('poi_cache').select('payload, fetched_at')
--              .eq('key', k).gt('fetched_at', <now-30d>).maybeSingle()
--     write: admin.from('poi_cache').upsert(
--              { key: k, payload, fetched_at: new Date().toISOString() },
--              { onConflict: 'key' })
--
-- service_usage (service text, day date, count int) PK (service, day)
--   Global per-UTC-day counter per upstream (e.g. 'overpass', 'wikipedia').
--     admin.rpc('consume_service_usage',
--               { p_service: 'overpass', p_units: 1, p_cap: 2000 })
--       -> true  = reserved (count += p_units)
--       -> false = cap reached, NOTHING consumed (fail over / degrade)
--   Atomic (INSERT ... ON CONFLICT DO UPDATE ... WHERE count + units <= cap).
--   service must match ^[a-z][a-z0-9_]{0,39}$. p_units >= 1, p_cap >= 0.
--
-- ai_usage.poi_requests (per user, per UTC day; ledger from 0020)
--     admin.rpc('consume_poi_quota',
--               { p_user: <GoTrue-verified id>, p_units: 1, p_cap: 40 })
--       -> true / false with the same semantics. Readable by the user
--          through the existing ai_usage SELECT-own policy (quota meter).
--
-- trip_shares toggles (owner-set through share-trip, service role; the
-- 0003 owner policies still apply to any direct write):
--   show_itinerary default TRUE  (existing links keep today's behavior)
--   show_expenses  default FALSE
--   show_memories  default FALSE
--   share-trip must include memories ONLY when show_memories = true, and
--   then only rows with visibility = 'trip' AND deleted = false (AND
--   status = 'ready' for trip_photos), see 0036.
--
-- user_preferences (user_id PK default auth.uid(), locale, home_currency,
--   interests text[]) — owner-only RLS; the client upserts its own row:
--     supabase.from('user_preferences').upsert({ locale, home_currency,
--       interests }, { onConflict: 'user_id' })
--   locale NULL = follow the device ("System"); home_currency ISO 4217
--   (^[A-Z]{3}$) or NULL; interests = lower-case keys (^[a-z][a-z0-9_]{0,31}$,
--   max 16, e.g. the ADR-0013 set: history, food, nature, museums,
--   nightlife, shopping, kids, viewpoints; the key list itself is owned by
--   supabase/functions/_shared/interests.ts, not by a DB CHECK).
--
-- fx_rates is NOT here: it lands in 0034 (Y1.1) with the same posture
-- (authenticated read, service-role write).
--
-- Inverse (local only):
--   select cron.unschedule('tripvisor-poi-cache-purge-nightly');
--   drop function if exists public.consume_poi_quota(uuid, int, int);
--   drop function if exists public.consume_service_usage(text, int, int);
--   alter table public.ai_usage drop constraint if exists ai_usage_poi_requests_nonnegative;
--   alter table public.ai_usage drop column if exists poi_requests;
--   drop table if exists public.service_usage;
--   drop table if exists public.poi_cache;
--   drop table if exists public.user_preferences;
--   alter table public.trip_shares drop column if exists show_itinerary,
--     drop column if exists show_expenses, drop column if exists show_memories;
--
-- Deploy order (cloud): push BEFORE deploying poi-recommend (it calls
-- consume_* and fails closed without them) and share-trip (Y2.5 reads the
-- toggles).

-- ============================================================
-- 1. Share-link toggles
-- ============================================================
alter table public.trip_shares
  add column if not exists show_itinerary boolean not null default true,
  add column if not exists show_expenses  boolean not null default false,
  add column if not exists show_memories  boolean not null default false;

comment on column public.trip_shares.show_itinerary is
  'M5: public link shows the day-by-day itinerary. Default TRUE (pre-M5 links behave as before).';
comment on column public.trip_shares.show_expenses is
  'M5: public link shows the expenses SUMMARY (home-currency totals by category + per-currency breakdown; never line items). Default FALSE.';
comment on column public.trip_shares.show_memories is
  'M5: public link shows memories. Default FALSE. Even when TRUE, only rows with visibility = ''trip'' AND deleted = false (photos: status = ''ready'') are included; only_me items never are.';

-- ============================================================
-- 2. user_preferences
-- ============================================================
create table if not exists public.user_preferences (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  -- NULL = follow the device language ("System" in Profile -> Language).
  locale         text null check (locale is null or locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  -- Default home currency for NEW trips (ISO 4217). NULL = not chosen.
  home_currency  text null check (home_currency is null or home_currency ~ '^[A-Z]{3}$'),
  interests      text[] not null default '{}'::text[]
                 check (
                   cardinality(interests) <= 16
                   and array_position(interests, null::text) is null
                   and array_to_string(interests, ',') ~ '^([a-z][a-z0-9_]{0,31}(,[a-z][a-z0-9_]{0,31})*)?$'
                 ),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.user_preferences is
  'M5: one row per user: app language (NULL = device), default home currency, recommendation interests. Owner-only RLS; the client upserts its own row (user_id defaults to auth.uid()). Never read by other users or the share link.';

drop trigger if exists user_preferences_handle_times on public.user_preferences;
create trigger user_preferences_handle_times
  before insert or update on public.user_preferences
  for each row execute function public.handle_times();

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_own_select" on public.user_preferences;
create policy "user_preferences_own_select"
  on public.user_preferences for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_preferences_own_insert" on public.user_preferences;
create policy "user_preferences_own_insert"
  on public.user_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_preferences_own_update" on public.user_preferences;
create policy "user_preferences_own_update"
  on public.user_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_preferences_own_delete" on public.user_preferences;
create policy "user_preferences_own_delete"
  on public.user_preferences for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.user_preferences from anon, authenticated;
grant select, insert, update, delete on table public.user_preferences to authenticated;
grant all on table public.user_preferences to service_role;

-- ============================================================
-- 3. poi_cache
-- ============================================================
-- Only OSM (ODbL) and Wikipedia/Wikidata (CC BY-SA) derived data belongs
-- here. NEVER Google Places content (ToS): `resolve` results are not cached.
create table if not exists public.poi_cache (
  key         text primary key check (char_length(key) between 1 and 200),
  payload     jsonb not null check (octet_length(payload::text) <= 262144),
  fetched_at  timestamptz not null default now()
);

comment on table public.poi_cache is
  'M5 (ADR-0013): 30-day cache of trimmed OSM Overpass tiles (geohash-5 x interest) and Wikipedia summaries (wikidata x lang). Keys: ovp:v1:<gh5>:<interest> | wiki:v1:<qid>:<lang> | wgeo:v1:<gh5>:<lang>. A row is fresh while fetched_at > now() - 30 days; pg_cron purges older rows nightly. Writes: service role only (poi-recommend). Reads: authenticated (public data). NEVER Google data.';

create index if not exists poi_cache_fetched_at_idx on public.poi_cache (fetched_at);

alter table public.poi_cache enable row level security;

drop policy if exists "poi_cache_authenticated_select" on public.poi_cache;
create policy "poi_cache_authenticated_select"
  on public.poi_cache for select
  to authenticated
  using (true);
-- No insert/update/delete policies: the service role bypasses RLS.

revoke all on table public.poi_cache from anon, authenticated;
grant select on table public.poi_cache to authenticated;
grant all on table public.poi_cache to service_role;

do $cronjobs$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: tripvisor-poi-cache-purge-nightly NOT scheduled. Re-run this block after enabling the extension.';
    return;
  end if;
  perform cron.schedule(
    'tripvisor-poi-cache-purge-nightly',
    '30 4 * * *',
    $job$ delete from public.poi_cache where fetched_at < now() - interval '30 days' $job$
  );
  raise notice 'pg_cron job scheduled: tripvisor-poi-cache-purge-nightly (04:30 UTC).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to schedule pg_cron jobs: schedule tripvisor-poi-cache-purge-nightly from the Dashboard.';
end
$cronjobs$;

-- ============================================================
-- 4. service_usage + consume_service_usage()
-- ============================================================
create table if not exists public.service_usage (
  service  text not null check (service ~ '^[a-z][a-z0-9_]{0,39}$'),
  day      date not null default current_date,
  count    integer not null default 0 check (count >= 0),
  primary key (service, day)
);

comment on table public.service_usage is
  'M5 (ADR-0013): global per-upstream, per-UTC-day call counters (e.g. overpass capped at 2,000/day). Written ONLY by consume_service_usage() (service role). Readable by authenticated (non-sensitive aggregate).';

alter table public.service_usage enable row level security;

drop policy if exists "service_usage_authenticated_select" on public.service_usage;
create policy "service_usage_authenticated_select"
  on public.service_usage for select
  to authenticated
  using (true);

revoke all on table public.service_usage from anon, authenticated;
grant select on table public.service_usage to authenticated;
grant all on table public.service_usage to service_role;

-- Atomic check-and-increment, same shape as 0032 consume_usage_quota: the
-- conflicting row is locked and READ COMMITTED re-evaluates the WHERE on
-- its latest version, so concurrent callers can never pass the cap, and a
-- refused call consumes nothing.
create or replace function public.consume_service_usage(
  p_service text,
  p_units   integer,
  p_cap     integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_service is null or p_service !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'consume_service_usage: invalid service %', p_service using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 then
    raise exception 'consume_service_usage: p_units must be >= 1' using errcode = '22023';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'consume_service_usage: p_cap must be >= 0' using errcode = '22023';
  end if;
  if p_units > p_cap then
    return false;
  end if;

  insert into public.service_usage as s (service, day, count)
  values (p_service, current_date, p_units)
  on conflict (service, day) do update
    set count = s.count + excluded.count
    where s.count + excluded.count <= p_cap;

  -- FOUND: true when the INSERT or the guarded UPDATE wrote a row.
  return found;
end;
$$;

comment on function public.consume_service_usage(text, integer, integer) is
  'M5 (ADR-0013): atomic global per-service per-UTC-day cap. Returns true and adds p_units when the new total stays <= p_cap; returns false and consumes NOTHING otherwise. Cap passed by the caller (poi-recommend constants). SECURITY DEFINER, EXECUTE service_role only.';

-- ============================================================
-- 5. ai_usage.poi_requests + consume_poi_quota()
-- ============================================================
-- A dedicated function (not a new kind in 0032's consume_usage_quota):
-- re-creating that function here could silently overwrite a later edit,
-- the same reasoning as 0033.
alter table public.ai_usage
  add column if not exists poi_requests integer not null default 0;

alter table public.ai_usage drop constraint if exists ai_usage_poi_requests_nonnegative;
alter table public.ai_usage
  add constraint ai_usage_poi_requests_nonnegative check (poi_requests >= 0);

comment on column public.ai_usage.poi_requests is
  'M5 (ADR-0013): poi-recommend requests today (UTC), default cap 40/user/day. Written only by consume_poi_quota().';

create or replace function public.consume_poi_quota(
  p_user  uuid,
  p_units integer,
  p_cap   integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user is null then
    raise exception 'consume_poi_quota: p_user is required' using errcode = '22004';
  end if;
  if p_units is null or p_units < 1 then
    raise exception 'consume_poi_quota: p_units must be >= 1' using errcode = '22023';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'consume_poi_quota: p_cap must be >= 0' using errcode = '22023';
  end if;
  -- Belt and braces (EXECUTE is service_role only, where auth.uid() is NULL).
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'consume_poi_quota: callers may only consume their own quota' using errcode = '42501';
  end if;
  if p_units > p_cap then
    return false;
  end if;

  insert into public.ai_usage as u (user_id, day, poi_requests)
  values (p_user, current_date, p_units)
  on conflict (user_id, day) do update
    set poi_requests = u.poi_requests + excluded.poi_requests
    where u.poi_requests + excluded.poi_requests <= p_cap;

  return found;
end;
$$;

comment on function public.consume_poi_quota(uuid, integer, integer) is
  'M5 (ADR-0013): atomic per-user per-UTC-day poi-recommend cap over ai_usage.poi_requests. Returns true and adds p_units when the new total stays <= p_cap; returns false and consumes NOTHING otherwise. SECURITY DEFINER, EXECUTE service_role only.';

-- ============================================================
-- 6. EXECUTE matrix (0031 posture)
-- ============================================================
--   function                                   anon  authenticated  service_role
--   consume_service_usage(text,int,int)        -     -              X  poi-recommend (admin client)
--   consume_poi_quota(uuid,int,int)            -     -              X  poi-recommend (admin client)
-- If authenticated could call them, any user could burn the global
-- Overpass budget or another user's daily quota.
revoke all on function public.consume_service_usage(text, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_poi_quota(uuid, integer, integer)    from public, anon, authenticated;
grant execute on function public.consume_service_usage(text, integer, integer) to service_role;
grant execute on function public.consume_poi_quota(uuid, integer, integer)    to service_role;
