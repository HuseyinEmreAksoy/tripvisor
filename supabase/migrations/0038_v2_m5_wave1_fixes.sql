-- Tripvisor v2 M5: Wave-1 review fixes for 0034 / 0036 / 0037.
--
-- Findings fixed (numbers = the Wave-1 review list):
--   #1 [high]   Photo quota counted ROWS, not BYTES, so one account could fill
--               the shared 1 GB Storage. A tombstone or hard delete freed the
--               slot while its objects stayed; the object INSERT policy never
--               checked the global guard; the pending purge dropped rows and
--               left their objects behind.                              -> §2
--   #4 [medium] The analytics MV multiplied a row whose rate could not be
--               resolved by `coalesce(fx_rate, 1)`. That is a rate into a
--               DIFFERENT currency (or 1:1), so totals were wrong after a
--               home-currency change.                                   -> §1
--   #5 [medium] trip_place_reviews.trip_place_id ON DELETE CASCADE let any
--               editor destroy other members' private reviews by removing a
--               place.                                                  -> §3
--   #9 [low]    poi_cache / service_usage were readable by every signed-in
--               user (service_usage also holds pseudonymous per-user fx
--               counters). No client reads them.                        -> §4
--   #11 [low]   The per-trip photo cap counted revoked members' rows.   -> §2
--   #8 (DB)     service_usage grew forever: nightly 30-day purge.       -> §5
--
-- All sections are idempotent: the file is safe to re-run (verified locally
-- by applying it twice more after `migration up`).
--
-- ===========================================================================
-- CONTRACT CHANGES (read before Y2.1 / Y2.2 / Y3.1 / Y3.2)
-- ===========================================================================
-- Money (§1). The conversion order supersedes 0034 step 4 and matches the
-- TripExpense JSDoc in src/api/types.ts:
--   1. currency NULL or = trips.currency                    -> x 1
--   2. fx_rate set AND fx_home_currency = trips.currency     -> x fx_rate
--   3. fx_date set AND fx_rates has both legs on fx_date     -> x rate(home)/rate(ccy)
--                                                              (rate('EUR') = 1)
--   4. otherwise PENDING: excluded from total_* and reported instead.
--      A row is never multiplied by a rate into another currency, and never
--      counted 1:1.
--   get_my_trip_stats() gains 3 columns, appended (additive):
--     pending_count                  int    live expenses in state 4 (both kinds)
--     pending_actual_by_currency     jsonb  {"EUR": 12.5, ...} original amounts
--     pending_estimated_by_currency  jsonb  same, kind = 'estimated'
--   ('{}' when nothing is pending, never NULL.) The home-currency change
--   flow (Y3.2) must warm fx-rates for every distinct fx_date of the trip's
--   expenses. Pending rows then re-derive on the next nightly refresh.
--
-- Photo quota (§2). Storage use is counted in BYTES, from storage.objects
-- (bucket trip-memories, author = 2nd path segment), so a photo holds its
-- quota until its OBJECTS are gone, whatever happened to its row. New
-- app_config keys (absent = default):
--   memories_user_bytes_cap    default 104857600 (100 MiB of objects per author)
--   memories_user_pending_cap  default 20 (photos an author may have pending
--                              at once; this bounds the bytes that can be in
--                              flight past the checks)
--   Errors (unchanged tokens, new scopes in details.scope):
--     quota_exceeded {scope:'user'}        live photos + photos whose objects remain >= user_cap
--     quota_exceeded {scope:'user_bytes'}  author bytes >= user_bytes_cap
--     quota_exceeded {scope:'pending'}     pending photos >= pending_cap
--     quota_exceeded {scope:'trip'}        live photos by CURRENT members >= trip_cap (#11)
--     storage_full   {scope:'global'}      all buckets >= storage guard
--   The Storage INSERT policy enforces the byte cap and the global guard too.
--   It sees the declared contentLength, so an object that would cross a
--   limit is refused (Storage answers 403; call get_memory_quota to explain
--   it in the UI).
--   get_memory_quota() keys (additive, one changed meaning):
--     user_bytes        NOW the bytes of the caller's objects (tombstoned and
--                       orphaned included), not the sum of live rows' bytes.
--     user_used         live photos + photos whose objects are still stored.
--     trip_used         live photos authored by current members.
--     user_bytes_cap, user_pending, user_pending_cap   new.
--   Client consequences (Y2.1): delete a photo's two objects when it is
--   tombstoned or hard-deleted (the author can always delete in their own
--   folder), because otherwise the space stays used. Keep at most
--   user_pending_cap photos pending: process uploads with bounded
--   concurrency, and on quota_exceeded {scope:'pending'} wait for in-flight
--   uploads to finish.
--
-- Orphan objects (§2d). Postgres cannot delete Storage objects safely.
-- storage.protect_delete blocks SQL deletes, and a SQL delete would drop only
-- the metadata row and leave the file in the object store. So the hourly
-- pending purge still deletes the ROWS only. Their objects become ORPHANS
-- (an object with no trip_photos row). They keep counting against the
-- author and the global guard until removed, and they are listed by
--   rpc('trip_memories_sweep_candidates', { p_min_age, p_limit })   (service role)
-- FOLLOW-UP (a function-based sweep, not in this migration): a service-role
-- Edge Function reads the candidates and calls
-- storage.from('trip-memories').remove(names) in batches of <= 1000. It is
-- scheduled through Supabase Cron (pg_cron + pg_net + Vault). Deleting a
-- missing name is not an error, so the sweep is idempotent. Until it ships,
-- authors can still remove their own orphans (own-folder DELETE policy), and
-- delete-trip / delete-account remove everything under a trip prefix.
--
-- Reviews (§3). trip_place_reviews.trip_place_id is now NULLABLE with
-- ON DELETE SET NULL. Removing a place DETACHES its reviews and never deletes
-- them. Two server-owned columns keep the review readable afterwards:
--   place_name_snapshot       trip_places.user_title (user trip data; may be NULL)
--   place_google_id_snapshot  trip_places.google_place_id (the one durable
--                             Google field; the UI can re-resolve the name
--                             on tap through place-details / Tier-2)
--   Coordinates are NOT snapshotted: that would be a second durable copy
--   outside the trip_places refresh path. No other Google content is stored.
--   Both columns are refreshed from the place on every INSERT/UPDATE of the
--   review, and once more just before the place row is deleted, then frozen.
--   Client values are ignored.
--   A NEW review still needs an existing place of the same trip (INSERT
--   policy unchanged). Only the FK action or the service role may set
--   trip_place_id to NULL; clients still get immutable_column. RLS keeps
--   using the review's own trip_id, which is unchanged.
--   Y2.1 allowlist: the two snapshot columns are READ-only (hydrate, never
--   write); trip_place_id becomes `string | null`.
--
-- poi_cache / service_usage (§4): no client access at all (service role only).
--
-- Deploy order (cloud): push 0034-0038 together, BEFORE any client build
-- that reads the new stats columns or the review snapshot columns.
--
-- Inverse (local only; run in this order):
--   §5  select cron.unschedule('tripvisor-service-usage-purge-nightly');
--       drop index if exists public.service_usage_day_idx;
--   §4  re-run 0037 §3 / §4 policy + grant statements
--       (poi_cache_authenticated_select, service_usage_authenticated_select,
--        grant select ... to authenticated).
--   §3  drop trigger if exists trip_places_snapshot_reviews on public.trip_places;
--       drop function if exists public.trip_places_snapshot_reviews();
--       drop trigger if exists trip_place_reviews_place_snapshot on public.trip_place_reviews;
--       drop function if exists public.trip_place_reviews_place_snapshot();
--       re-run 0036 §4a (trip_memories_guard) verbatim;
--       delete from public.trip_place_reviews where trip_place_id is null;  (LOSSY: detached reviews)
--       alter table public.trip_place_reviews drop constraint trip_place_reviews_trip_place_id_fkey,
--         add constraint trip_place_reviews_trip_place_id_fkey foreign key (trip_place_id)
--           references public.trip_places(id) on delete cascade,
--         alter column trip_place_id set not null,
--         drop column if exists place_name_snapshot, drop column if exists place_google_id_snapshot;
--   §2  drop function if exists public.trip_memories_sweep_candidates(interval, integer),
--         public.trip_memories_upload_allowed(text, jsonb),
--         public.trip_memories_trip_photo_count(uuid, uuid),
--         public.trip_memories_author_usage(uuid, uuid),
--         public.trip_memories_author_bytes(uuid),
--         public.trip_memories_storage_total_bytes();
--       drop function public.memory_quota_limits(); then re-run 0036 §3c, §3d,
--       §4c and §6 (the trip_memories_author_insert policy) and the §9 grants.
--   §1  drop function if exists public.get_my_trip_stats();
--       drop materialized view if exists public.analytics_user_trip_stats;
--       then re-run 0034 §4 verbatim.

-- ============================================================
-- §1. Money: pending rows are excluded, never mis-converted (#4)
-- ============================================================
-- 0029/0034 mechanics: drop the dependent function (it returns the MV's row
-- type), drop the MV, recreate MV + unique index + REVOKE + function + grants.
-- The first seven columns are unchanged (TripStatsRow); three are appended.
-- The 0019 pg_cron job refreshes the MV by name (concurrently): no change.

drop function if exists public.get_my_trip_stats();
drop materialized view if exists public.analytics_user_trip_stats;

create materialized view public.analytics_user_trip_stats as
with user_trips as (
  -- Owner rows, plus accepted, bound collaborators (UNION dedupes).
  select t.user_id, t.id as trip_id
  from public.trips t
  union
  select c.user_id, c.trip_id
  from public.trip_collaborators c
  where c.status = 'accepted'
    and c.user_id is not null
),
expense_rows as (
  -- One row per live expense with its factor into the trip's CURRENT home
  -- currency, or NULL = pending (see the header for the order).
  select
    te.trip_id,
    te.kind,
    te.amount,
    te.currency as orig_currency,
    case
      when te.currency is null or te.currency = t.currency then 1::numeric
      when te.fx_rate is not null and te.fx_home_currency = t.currency then te.fx_rate
      when te.fx_date is not null then
        -- NULL when either leg is missing on fx_date (numeric / NULL = NULL).
        (case when t.currency = 'EUR' then 1::numeric
              else (select r.rate from public.fx_rates r
                     where r.base = 'EUR' and r.quote = t.currency and r.rate_date = te.fx_date)
         end)
        /
        (case when te.currency = 'EUR' then 1::numeric
              else (select r.rate from public.fx_rates r
                     where r.base = 'EUR' and r.quote = te.currency and r.rate_date = te.fx_date)
         end)
      else null
    end as home_rate
  from public.trip_expenses te
  join public.trips t on t.id = te.trip_id
  where te.deleted = false
),
expense_totals as (
  select
    er.trip_id,
    coalesce(sum(er.amount * er.home_rate) filter (where er.kind = 'actual'    and er.home_rate is not null), 0) as total_actual_spend,
    coalesce(sum(er.amount * er.home_rate) filter (where er.kind = 'estimated' and er.home_rate is not null), 0) as total_estimated_spend,
    count(*) filter (where er.home_rate is null) as pending_count
  from expense_rows er
  group by er.trip_id
),
pending_sums as (
  -- orig_currency is never NULL here (a NULL currency converts at 1).
  select er.trip_id, er.kind, er.orig_currency, sum(er.amount) as amount
  from expense_rows er
  where er.home_rate is null
  group by er.trip_id, er.kind, er.orig_currency
),
pending_totals as (
  select
    ps.trip_id,
    coalesce(jsonb_object_agg(ps.orig_currency, ps.amount) filter (where ps.kind = 'actual'),    '{}'::jsonb) as pending_actual_by_currency,
    coalesce(jsonb_object_agg(ps.orig_currency, ps.amount) filter (where ps.kind = 'estimated'), '{}'::jsonb) as pending_estimated_by_currency
  from pending_sums ps
  group by ps.trip_id
),
place_counts as (
  -- S2.8: tombstoned places never count.
  select tp.trip_id, count(*) as place_count
  from public.trip_places tp
  where tp.deleted = false
  group by tp.trip_id
),
reaction_counts as (
  -- Per (trip, reacting user); tombstone hygiene on both sides (0028).
  select
    tp.trip_id,
    r.user_id,
    count(*) filter (where r.reaction = 'liked')    as liked_count,
    count(*) filter (where r.reaction = 'disliked') as disliked_count
  from public.trip_place_reactions r
  join public.trip_places tp
    on tp.id = r.trip_place_id
   and tp.deleted = false
  where r.deleted = false
  group by tp.trip_id, r.user_id
)
select
  ut.user_id,
  ut.trip_id,
  coalesce(et.total_actual_spend,    0)::numeric as total_actual_spend,
  coalesce(et.total_estimated_spend, 0)::numeric as total_estimated_spend,
  coalesce(rc.liked_count,    0)::int as liked_count,
  coalesce(rc.disliked_count, 0)::int as disliked_count,
  coalesce(pc.place_count,    0)::int as place_count,
  -- 0038 (appended; additive for get_my_trip_stats consumers):
  coalesce(et.pending_count, 0)::int as pending_count,
  coalesce(pt.pending_actual_by_currency,    '{}'::jsonb) as pending_actual_by_currency,
  coalesce(pt.pending_estimated_by_currency, '{}'::jsonb) as pending_estimated_by_currency
from user_trips ut
left join expense_totals  et on et.trip_id = ut.trip_id
left join pending_totals  pt on pt.trip_id = ut.trip_id
left join place_counts    pc on pc.trip_id = ut.trip_id
left join reaction_counts rc on rc.trip_id = ut.trip_id
                            and rc.user_id = ut.user_id;

comment on materialized view public.analytics_user_trip_stats is
  'v2 N2.3 (tombstone-filtered 0028/0029; home-currency 0034; pending 0038): per-(user, trip) rollup. total_actual_spend / total_estimated_spend are in the trip HOME currency (trips.currency) and include only expenses whose rate is known: same currency (x1), a frozen fx_rate for the current home, or both fx_rates legs on fx_date. Every other live expense is PENDING: counted in pending_count and summed per ORIGINAL currency in pending_actual_by_currency / pending_estimated_by_currency (jsonb, {} when none), never converted with a wrong rate. Also place count and personal liked/disliked counts. Tombstones excluded. User dimension = owner UNION accepted collaborators. No RLS on MVs: SELECT revoked from anon/authenticated; clients read ONLY via get_my_trip_stats(). Refreshed nightly by pg_cron (concurrently: see the unique index).';

create unique index if not exists analytics_user_trip_stats_user_trip_idx
  on public.analytics_user_trip_stats (user_id, trip_id);

-- Load-bearing: default privileges re-grant SELECT on the new relation.
revoke all on public.analytics_user_trip_stats from public, anon, authenticated;

create or replace function public.get_my_trip_stats()
returns setof public.analytics_user_trip_stats
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select *
  from public.analytics_user_trip_stats
  where user_id = auth.uid();
$$;

comment on function public.get_my_trip_stats() is
  'v2 N2.3: the ONLY client read path for analytics_user_trip_stats (MVs cannot carry RLS). SECURITY DEFINER + WHERE user_id = auth.uid(). One row per trip the caller owns or collaborates on (nightly-refreshed; pair with a live fallback). Spend totals are in each trip''s home currency (0034) and exclude pending conversions, which are reported in pending_count / pending_actual_by_currency / pending_estimated_by_currency (0038). Call via supabase.rpc(''get_my_trip_stats'').';

revoke all on function public.get_my_trip_stats() from public, anon;
grant execute on function public.get_my_trip_stats() to authenticated, service_role;

-- ============================================================
-- §2. Photo quota in BYTES + global guard on uploads (#1, #11)
-- ============================================================

-- §2a. Limits: two new keys appended to the OUT list (additive for any
-- rpc('memory_quota_limits') caller). The OUT list changes the result type,
-- so the function is dropped and recreated. Its callers are plpgsql/SQL
-- bodies resolved at run time, so no dependency is recorded.
drop function if exists public.memory_quota_limits();
create function public.memory_quota_limits(
  out user_cap            integer,
  out trip_cap            integer,
  out storage_guard_bytes bigint,
  out user_bytes_cap      bigint,
  out pending_cap         integer
)
language sql
stable
set search_path = public, pg_catalog
as $$
  select
    coalesce(
      (select case when c.value ~ '^[0-9]{1,9}$' then c.value::integer end
         from public.app_config c where c.key = 'memories_user_cap'),
      300),
    coalesce(
      (select case when c.value ~ '^[0-9]{1,9}$' then c.value::integer end
         from public.app_config c where c.key = 'memories_trip_cap'),
      500),
    coalesce(
      (select case when c.value ~ '^[0-9]{1,15}$' then c.value::bigint end
         from public.app_config c where c.key = 'memories_storage_guard_bytes'),
      943718400),
    coalesce(
      (select case when c.value ~ '^[0-9]{1,15}$' then c.value::bigint end
         from public.app_config c where c.key = 'memories_user_bytes_cap'),
      104857600),
    coalesce(
      (select case when c.value ~ '^[0-9]{1,9}$' then c.value::integer end
         from public.app_config c where c.key = 'memories_user_pending_cap'),
      20);
$$;

comment on function public.memory_quota_limits() is
  'M5 photo quota limits (0036, extended 0038). app_config keys: memories_user_cap (default 300 photos per author: live rows + photos whose objects remain), memories_trip_cap (500 live photos by current members per trip), memories_storage_guard_bytes (943718400 = 900 MiB, compared with the TOTAL bytes of every Storage bucket), memories_user_bytes_cap (104857600 = 100 MiB of trip-memories objects per author), memories_user_pending_cap (20 pending photos per author). Absent or non-numeric = default.';

-- §2b. Byte counters. SECURITY DEFINER (they read every storage.objects
-- row), search_path pinned, EXECUTE for service_role only: clients reach
-- them only through the definer functions below, so they are not an
-- oracle for other users' usage.

-- Total bytes stored in EVERY bucket (the 1 GB free tier is project-wide).
create or replace function public.trip_memories_storage_total_bytes()
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                           then (o.metadata->>'size')::bigint else 0 end), 0)::bigint
    from storage.objects o;
$$;

comment on function public.trip_memories_storage_total_bytes() is
  'M5 (0038): total bytes of every object in every Storage bucket (metadata.size). Used by the photo quota trigger, the trip-memories upload policy and get_memory_quota. service_role EXECUTE only.';

-- Bytes of every trip-memories object in the author's folders, on any trip:
-- key <trip>/<author>/<photo>(_t).jpg. Tombstoned, purged and hard-deleted
-- photos keep counting here until their OBJECTS are removed.
create or replace function public.trip_memories_author_bytes(p_author uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                           then (o.metadata->>'size')::bigint else 0 end), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'trip-memories'
     and split_part(o.name, '/', 2) = p_author::text;
$$;

comment on function public.trip_memories_author_bytes(uuid) is
  'M5 (0038): bytes of the author''s trip-memories objects (bucket trip-memories, 2nd key segment = author id), whatever the state of the photo rows. service_role EXECUTE only.';

-- Per-author usage. `photos` = distinct photo ids that hold a slot: live
-- rows, plus photos (any row state, or no row) whose objects are still
-- stored. `pending` = live pending rows. p_exclude_photo leaves one photo
-- out (the row being inserted or restored).
create or replace function public.trip_memories_author_usage(
  p_author        uuid,
  p_exclude_photo uuid default null,
  out photos      integer,
  out bytes       bigint,
  out pending     integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    (select count(*)::integer
       from (
         select p.id
           from public.trip_photos p
          where p.author_id = p_author
            and not p.deleted
            and p.id is distinct from p_exclude_photo
         union
         select public.trip_memory_photo_id(o.name)
           from storage.objects o
          where o.bucket_id = 'trip-memories'
            and split_part(o.name, '/', 2) = p_author::text
            and public.trip_memory_photo_id(o.name) is not null
            and public.trip_memory_photo_id(o.name) is distinct from p_exclude_photo
       ) s),
    public.trip_memories_author_bytes(p_author),
    (select count(*)::integer
       from public.trip_photos p
      where p.author_id = p_author
        and not p.deleted
        and p.status = 'pending'
        and p.id is distinct from p_exclude_photo);
$$;

comment on function public.trip_memories_author_usage(uuid, uuid) is
  'M5 (0038): {photos, bytes, pending} for one author. photos = live rows UNION photos whose objects remain (a tombstone or delete frees the slot only once the objects are gone); bytes = trip_memories_author_bytes; pending = live pending rows. service_role EXECUTE only.';

-- Per-trip count (#11): live photos whose author is STILL the owner or an
-- accepted collaborator. A revoked member's rows no longer take the trip's
-- slots (their objects still count against their own byte quota).
create or replace function public.trip_memories_trip_photo_count(p_trip uuid, p_exclude_photo uuid default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::integer
    from public.trip_photos p
    join public.trips t on t.id = p.trip_id
   where p.trip_id = p_trip
     and not p.deleted
     and p.id is distinct from p_exclude_photo
     and (
       p.author_id = t.user_id
       or exists (select 1 from public.trip_collaborators c
                   where c.trip_id = p.trip_id
                     and c.user_id = p.author_id
                     and c.status = 'accepted')
     );
$$;

comment on function public.trip_memories_trip_photo_count(uuid, uuid) is
  'M5 (0038): live photos of a trip authored by its owner or a currently accepted collaborator (revoked / declined members excluded). service_role EXECUTE only.';

-- §2c. Upload gate for the storage.objects INSERT policy. It runs as the
-- uploader (authenticated), so it needs EXECUTE. It answers only for the
-- caller's own folder (false otherwise) and returns only a boolean.
--
-- How storage-api evaluates it (checked against the local storage-api build):
-- the RLS check is a TEST insert, rolled back, run BEFORE the file is
-- stored, with metadata {mimetype, contentLength} (declared length, may be
-- absent). The real row is then written as the storage superuser (no RLS)
-- with metadata.size. So the incoming size is size ?? contentLength ?? 0.
-- Checks cannot serialize with the final write, so concurrent uploads can
-- overshoot by at most the bytes in flight. The per-author pending cap
-- bounds that: each pending photo allows exactly two objects, and the bucket
-- limits each object to 1 MiB.
create or replace function public.trip_memories_upload_allowed(p_name text, p_metadata jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid      uuid := auth.uid();
  v_incoming bigint;
  v_limits   record;
  v_bytes    bigint;
  v_total    bigint;
begin
  if v_uid is null or split_part(coalesce(p_name, ''), '/', 2) is distinct from v_uid::text then
    return false;
  end if;

  v_incoming := coalesce(
    case when p_metadata->>'size' ~ '^[0-9]{1,12}$' then (p_metadata->>'size')::bigint end,
    case when p_metadata->>'contentLength' ~ '^[0-9]{1,12}$' then (p_metadata->>'contentLength')::bigint end,
    0);

  select * into v_limits from public.memory_quota_limits();

  v_bytes := public.trip_memories_author_bytes(v_uid);
  if v_bytes >= v_limits.user_bytes_cap or v_bytes + v_incoming > v_limits.user_bytes_cap then
    return false;
  end if;

  v_total := public.trip_memories_storage_total_bytes();
  if v_total >= v_limits.storage_guard_bytes or v_total + v_incoming > v_limits.storage_guard_bytes then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.trip_memories_upload_allowed(text, jsonb) is
  'M5 (0038): true when the caller may store this trip-memories object: it is in their own <trip>/<uid>/ folder, and their bytes plus the incoming size (metadata size ?? contentLength ?? 0) stay within memories_user_bytes_cap, and the total of all buckets plus the incoming size stays within memories_storage_guard_bytes. Called by the trip_memories_author_insert storage policy (authenticated). Boolean only; no usage numbers leave the function.';

-- §2d. Orphan objects: Storage objects of trip-memories with no trip_photos
-- row (purged pending rows, hard-deleted rows, rows removed by a cascade).
-- SQL must not delete them (storage.protect_delete; a SQL delete drops
-- only the metadata row and leaves the file in the object store). A
-- function-based sweep removes them through the Storage API instead (see the
-- header). Tombstoned rows keep their objects (undo), so they are never
-- candidates. p_min_age protects a just-deleted row that a client retry
-- re-inserts with the same id (the object is then no longer an orphan).
create or replace function public.trip_memories_sweep_candidates(
  p_min_age interval default interval '1 hour',
  p_limit   integer  default 1000
)
returns table (name text, bytes bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select o.name,
         case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint else 0 end,
         o.created_at
    from storage.objects o
   where o.bucket_id = 'trip-memories'
     and o.created_at < now() - coalesce(p_min_age, interval '1 hour')
     and not exists (select 1 from public.trip_photos p where p.storage_path = o.name)
     and not exists (select 1 from public.trip_photos p where p.thumb_path   = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.trip_memories_sweep_candidates(interval, integer) is
  'M5 (0038): up to p_limit (max 1000) trip-memories object names with no trip_photos row, older than p_min_age (default 1 h), oldest first. Input for the function-based Storage sweep: admin.rpc(''trip_memories_sweep_candidates'') then storage.from(''trip-memories'').remove(names). service_role EXECUTE only.';

comment on function public.purge_stale_pending_photos(interval) is
  'M5 Y1.2: hard-deletes trip_photos rows still pending after p_older_than (default 24 h, by server-stamped updated_at). Scheduled hourly by pg_cron (tripvisor-trip-photos-pending-purge). 0038: SQL cannot delete Storage objects, so any objects of a purged row become orphans. They keep counting against the author''s byte quota and the global guard until the function-based sweep (trip_memories_sweep_candidates) removes them. service_role / postgres only.';

-- §2e. Quota trigger (same trigger, same name, same advisory lock order:
-- user, then trip).
--   INSERT (always pending) and un-delete:
--     user     photos holding a slot (live + objects remaining)  >= user_cap
--     trip     live photos by current members                    >= trip_cap
--   additionally when the row is/stays pending (it will bring new bytes):
--     pending  other pending photos of the author                >= pending_cap
--     bytes    the author's stored bytes                         >= user_bytes_cap
--     global   bytes of every bucket                             >= storage guard
--   A restored READY photo brings no new bytes (its objects are either still
--   counted or gone), so it is not refused for bytes.
create or replace function public.trip_photos_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limits record;
  v_usage  record;
  v_used   integer;
  v_total  bigint;
begin
  if new.deleted then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.deleted then
    return new;
  end if;

  select * into v_limits from public.memory_quota_limits();

  perform pg_advisory_xact_lock(hashtextextended('trip_photos_quota:user:' || new.author_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('trip_photos_quota:trip:' || new.trip_id::text, 0));

  select * into v_usage from public.trip_memories_author_usage(new.author_id, new.id);

  if v_usage.photos >= v_limits.user_cap then
    raise exception 'quota_exceeded' using errcode = 'P0001',
      detail = json_build_object('scope', 'user', 'limit', v_limits.user_cap, 'used', v_usage.photos)::text,
      hint = 'You have reached your photo limit. Remove some photos to add new ones.';
  end if;

  if new.status = 'pending' then
    if v_usage.pending >= v_limits.pending_cap then
      raise exception 'quota_exceeded' using errcode = 'P0001',
        detail = json_build_object('scope', 'pending', 'limit', v_limits.pending_cap, 'used', v_usage.pending)::text,
        hint = 'Too many photos are uploading at once. Wait for the current uploads to finish.';
    end if;
    if v_usage.bytes >= v_limits.user_bytes_cap then
      raise exception 'quota_exceeded' using errcode = 'P0001',
        detail = json_build_object('scope', 'user_bytes', 'limit', v_limits.user_bytes_cap, 'used', v_usage.bytes)::text,
        hint = 'Your photo storage is full. Remove some photos to add new ones.';
    end if;
  end if;

  v_used := public.trip_memories_trip_photo_count(new.trip_id, new.id);
  if v_used >= v_limits.trip_cap then
    raise exception 'quota_exceeded' using errcode = 'P0001',
      detail = json_build_object('scope', 'trip', 'limit', v_limits.trip_cap, 'used', v_used)::text,
      hint = 'This trip has reached its photo limit.';
  end if;

  if new.status = 'pending' then
    v_total := public.trip_memories_storage_total_bytes();
    if v_total >= v_limits.storage_guard_bytes then
      raise exception 'storage_full' using errcode = 'P0001',
        detail = json_build_object('scope', 'global', 'limit', v_limits.storage_guard_bytes, 'used', v_total)::text,
        hint = 'Photo storage is full right now.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.trip_photos_enforce_quota() is
  'M5 (0036, bytes-based since 0038): BEFORE INSERT / un-delete on trip_photos. quota_exceeded scopes: user (photos holding a slot: live rows + photos whose objects remain), trip (live photos by current members), pending (pending photos per author), user_bytes (author''s trip-memories bytes). storage_full: all buckets >= guard. Byte, pending and global checks apply only to rows that are/stay pending (they bring new bytes). Limits from memory_quota_limits(). SECURITY DEFINER; advisory-locked per author, then per trip.';

-- §2f. Quota RPC (same signature, same jsonb shape plus new keys).
create or replace function public.get_memory_quota(p_trip_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid       uuid := auth.uid();
  v_limits    record;
  v_usage     record;
  v_trip_used integer;
  v_total     bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_trip_id is not null and not public.user_can_access_trip(p_trip_id, v_uid, 'viewer') then
    raise exception 'not_found' using errcode = '42501', hint = 'Trip not found or not shared with you.';
  end if;

  select * into v_limits from public.memory_quota_limits();
  select * into v_usage  from public.trip_memories_author_usage(v_uid);

  if p_trip_id is not null then
    v_trip_used := public.trip_memories_trip_photo_count(p_trip_id);
  end if;

  v_total := public.trip_memories_storage_total_bytes();

  return jsonb_build_object(
    'user_used',        v_usage.photos,
    'user_cap',         v_limits.user_cap,
    'user_bytes',       v_usage.bytes,
    'user_bytes_cap',   v_limits.user_bytes_cap,
    'user_pending',     v_usage.pending,
    'user_pending_cap', v_limits.pending_cap,
    'trip_used',        v_trip_used,
    'trip_cap',         case when p_trip_id is null then null else v_limits.trip_cap end,
    'storage_full',     v_total >= v_limits.storage_guard_bytes
  );
end;
$$;

comment on function public.get_memory_quota(uuid) is
  'M5 (0036; bytes-based since 0038): {user_used, user_cap, user_bytes, user_bytes_cap, user_pending, user_pending_cap, trip_used, trip_cap, storage_full} for the caller (and optionally a trip they can read). user_used = live photos + photos whose objects remain; user_bytes = bytes of the caller''s trip-memories objects (tombstoned / orphaned included); trip_used = live photos by current members. rpc(''get_memory_quota'', { p_trip_id }). authenticated only.';

-- §2g. storage.objects INSERT policy: 0036 rules plus the byte cap and the
-- global guard (trip_memories_upload_allowed). The per-object 1 MiB check
-- now also reads contentLength, the size storage-api supplies at
-- permission time. Environment-tolerant like 0036 §6.
do $objpolicies$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    raise notice 'storage.objects not found: skipping the trip-memories insert policy.';
    return;
  end if;

  drop policy if exists "trip_memories_author_insert" on storage.objects;
  create policy "trip_memories_author_insert"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'trip-memories'
      and exists (
        select 1 from public.trip_photos p
         where p.id = public.trip_memory_photo_id(objects.name)
           and (p.storage_path = objects.name or p.thumb_path = objects.name)
           and p.author_id = auth.uid()
           and p.status = 'pending'
           and not p.deleted
      )
      and public.user_can_access_trip(public.storage_path_trip_id(objects.name), auth.uid(), 'viewer')
      and case
            when coalesce(objects.metadata->>'size', objects.metadata->>'contentLength') is null then true
            when coalesce(objects.metadata->>'size', objects.metadata->>'contentLength') ~ '^[0-9]{1,12}$'
              then coalesce(objects.metadata->>'size', objects.metadata->>'contentLength')::bigint <= 1048576
            else false
          end
      and (objects.metadata->>'mimetype' is null
           or objects.metadata->>'mimetype' in ('image/jpeg', 'image/webp'))
      and public.trip_memories_upload_allowed(objects.name, objects.metadata)
    );

  raise notice 'storage.objects policy trip_memories_author_insert recreated (0038: byte cap + global guard).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to manage storage.objects policies: re-run section 2g of 0038_v2_m5_wave1_fixes.sql from the Dashboard SQL editor.';
end
$objpolicies$;

-- ============================================================
-- §3. Reviews survive place removal (#5)
-- ============================================================

-- §3a. Snapshot columns (server-owned; see the header for what is and is
-- not allowed here).
alter table public.trip_place_reviews
  add column if not exists place_name_snapshot      text,
  add column if not exists place_google_id_snapshot text;

comment on column public.trip_place_reviews.place_name_snapshot is
  'M5 (0038): server-owned copy of trip_places.user_title (user trip data), refreshed while the place exists and frozen when it is removed. NULL when the place had no user title. Never Google content.';
comment on column public.trip_place_reviews.place_google_id_snapshot is
  'M5 (0038): server-owned copy of trip_places.google_place_id (the one durable Google field), so a detached review can still re-resolve its place on tap (Tier-2). No coordinates, names, ratings or other Google content are stored.';

-- §3b. trip_place_id: nullable + ON DELETE SET NULL (was NOT NULL + CASCADE).
alter table public.trip_place_reviews alter column trip_place_id drop not null;
alter table public.trip_place_reviews drop constraint if exists trip_place_reviews_trip_place_id_fkey;
alter table public.trip_place_reviews
  add constraint trip_place_reviews_trip_place_id_fkey
  foreign key (trip_place_id) references public.trip_places(id) on delete set null;

comment on column public.trip_place_reviews.trip_place_id is
  'M5 (0038): the reviewed trip place. NULL = the place was removed from the trip; the review survives (ON DELETE SET NULL) and keeps place_name_snapshot / place_google_id_snapshot. Immutable for clients; a new review needs an existing place of the same trip.';

-- §3c. Snapshot filler. SECURITY DEFINER so the copy never depends on what
-- the caller can see (owner moderation runs as the definer, an author as
-- themselves). It reads one trip_places row by the review's own immutable
-- place id, so it reveals nothing.
create or replace function public.trip_place_reviews_place_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_title text;
  v_gpid  text;
  v_found boolean := false;
begin
  if new.trip_place_id is not null then
    select tp.user_title, tp.google_place_id into v_title, v_gpid
      from public.trip_places tp
     where tp.id = new.trip_place_id;
    v_found := found;
  end if;

  if v_found then
    new.place_name_snapshot      := v_title;
    new.place_google_id_snapshot := v_gpid;
  elsif tg_op = 'UPDATE' then
    -- Detached (or the place is going away): keep the last copy.
    new.place_name_snapshot      := old.place_name_snapshot;
    new.place_google_id_snapshot := old.place_google_id_snapshot;
  else
    new.place_name_snapshot      := null;
    new.place_google_id_snapshot := null;
  end if;
  return new;
end;
$$;

comment on function public.trip_place_reviews_place_snapshot() is
  'M5 (0038): BEFORE INSERT/UPDATE on trip_place_reviews. Copies trip_places.user_title / google_place_id into place_name_snapshot / place_google_id_snapshot while the place exists; keeps the last copy once trip_place_id is NULL. Client-supplied snapshot values are always replaced. Trigger-only.';

-- Name sorts after *_guard and *_handle_times and before *_supersede.
drop trigger if exists trip_place_reviews_place_snapshot on public.trip_place_reviews;
create trigger trip_place_reviews_place_snapshot
  before insert or update on public.trip_place_reviews
  for each row execute function public.trip_place_reviews_place_snapshot();

-- §3d. Guard: 0036 §4a verbatim, except that a review's trip_place_id may
-- now go to NULL on a SERVER path (the ON DELETE SET NULL action runs nested,
-- pg_trigger_depth() > 1; or the service role). Any other change is still
-- `immutable_column`, including a client setting it to NULL.
create or replace function public.trip_memories_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_uid    uuid    := auth.uid();
  v_server boolean := auth.uid() is null or pg_trigger_depth() > 1;
  v_full   bigint;
  v_thumb  bigint;
begin
  if tg_op = 'INSERT' then
    if new.author_id is null then
      new.author_id := v_uid;
    end if;
    if new.author_id is null then
      raise exception 'author_required' using errcode = '23502';
    end if;
    if v_uid is not null and new.author_id <> v_uid then
      raise exception 'author_mismatch' using errcode = '42501',
        hint = 'A memory is always authored by the signed-in user.';
    end if;
    if tg_table_name = 'trip_photos' then
      new.status       := 'pending';
      new.bytes        := null;
      new.thumb_bytes  := null;
      new.storage_path := new.trip_id::text || '/' || new.author_id::text || '/' || new.id::text || '.jpg';
      new.thumb_path   := new.trip_id::text || '/' || new.author_id::text || '/' || new.id::text || '_t.jpg';
    end if;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------
  if new.id is distinct from old.id
     or new.trip_id is distinct from old.trip_id
     or new.author_id is distinct from old.author_id then
    raise exception 'immutable_column' using errcode = '42501',
      detail = 'id, trip_id and author_id cannot change after creation.';
  end if;

  if tg_table_name = 'trip_place_reviews' then
    if new.trip_place_id is distinct from old.trip_place_id
       and not (v_server and new.trip_place_id is null) then
      raise exception 'immutable_column' using errcode = '42501',
        detail = 'A review cannot move to another place.';
    end if;
  elsif tg_table_name = 'trip_photos' then
    new.storage_path := old.storage_path;
    new.thumb_path   := old.thumb_path;
  end if;

  if not v_server and new.author_id <> v_uid then
    -- Non-author (the trip owner moderating a shared item): tombstone only.
    if (to_jsonb(new) - array['deleted', 'updated_at', 'created_at'])
         is distinct from (to_jsonb(old) - array['deleted', 'updated_at', 'created_at'])
       or (old.deleted and not new.deleted) then
      raise exception 'not_author' using errcode = '42501',
        hint = 'Only the author can edit a memory; the trip owner can only remove a shared one.';
    end if;
    return new;
  end if;

  if tg_table_name = 'trip_photos' then
    if old.status = 'ready' and new.status <> 'ready' then
      raise exception 'invalid_status_transition' using errcode = 'P0001',
        detail = 'A ready photo cannot go back to pending.';
    elsif old.status = 'pending' and new.status = 'ready' then
      select s.full_bytes, s.thumb_bytes into v_full, v_thumb
        from public.trip_photo_object_sizes(old.storage_path, old.thumb_path) s;
      if v_full is null or v_thumb is null then
        raise exception 'upload_incomplete' using errcode = 'P0001',
          detail = json_build_object('full', v_full is not null, 'thumb', v_thumb is not null)::text,
          hint = 'Upload both the photo and its thumbnail before marking it ready.';
      end if;
      new.bytes       := v_full;
      new.thumb_bytes := v_thumb;
    else
      new.bytes       := old.bytes;
      new.thumb_bytes := old.thumb_bytes;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.trip_memories_guard() is
  'M5 Y1.2 (0036; 0038: server paths may detach a review from a removed place): BEFORE INSERT/UPDATE guard for trip_journal_entries / trip_place_reviews / trip_photos: author pinning, immutable id/trip_id/author_id (+ review place, except the ON DELETE SET NULL action), owner = tombstone-only moderation, trip_photos path stamping + pending -> ready verification. Errors: author_mismatch, immutable_column, not_author, invalid_status_transition, upload_incomplete.';

-- §3e. Final refresh at removal time. Without it a review would keep the
-- title from its own last edit (a later rename of the place would be lost).
-- BEFORE DELETE, while the place row still exists. SECURITY DEFINER: it
-- must reach every member's review, private ones included (it writes only
-- the two snapshot columns, which the review filler re-derives from this same
-- row). The nested UPDATE is a server path for the guard (pg_trigger_depth
-- > 1). Only rows whose snapshot would change are touched.
create or replace function public.trip_places_snapshot_reviews()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.trip_place_reviews r
     set place_name_snapshot      = old.user_title,
         place_google_id_snapshot = old.google_place_id
   where r.trip_place_id = old.id
     and (r.place_name_snapshot      is distinct from old.user_title
          or r.place_google_id_snapshot is distinct from old.google_place_id);
  return old;
end;
$$;

comment on function public.trip_places_snapshot_reviews() is
  'M5 (0038): BEFORE DELETE on trip_places. Refreshes place_name_snapshot / place_google_id_snapshot on every review of the place (all authors) just before ON DELETE SET NULL detaches them. Trigger-only.';

drop trigger if exists trip_places_snapshot_reviews on public.trip_places;
create trigger trip_places_snapshot_reviews
  before delete on public.trip_places
  for each row execute function public.trip_places_snapshot_reviews();

-- §3f. Backfill snapshots for reviews written before 0038 (the trigger fills
-- the values; this only touches rows that still lack them).
update public.trip_place_reviews r
   set place_google_id_snapshot = tp.google_place_id
  from public.trip_places tp
 where tp.id = r.trip_place_id
   and r.place_google_id_snapshot is null;

-- ============================================================
-- §4. poi_cache / service_usage: service role only (#9)
-- ============================================================
-- Confirmed by grep: only Edge Functions read or write them, through the
-- service-role admin client (poi-recommend, fx-rates, _shared/service-usage.ts).
-- service_usage also stores pseudonymous per-user fx counters, which no
-- other user should be able to enumerate. RLS stays enabled with no
-- policies (default deny); the service role bypasses RLS.
drop policy if exists "poi_cache_authenticated_select" on public.poi_cache;
revoke all on table public.poi_cache from public, anon, authenticated;
grant all on table public.poi_cache to service_role;

drop policy if exists "service_usage_authenticated_select" on public.service_usage;
revoke all on table public.service_usage from public, anon, authenticated;
grant all on table public.service_usage to service_role;

comment on table public.poi_cache is
  'M5 (ADR-0013): 30-day cache of trimmed OSM Overpass tiles (geohash-5 x interest) and Wikipedia summaries (wikidata x lang). Keys: ovp:v1:<gh5>:<interest> | wiki:v1:<qid>:<lang> | wgeo:v1:<gh5>:<lang>. Fresh while fetched_at > now() - 30 days; pg_cron purges older rows nightly. SERVICE ROLE ONLY (0038: no client read access). NEVER Google data.';
comment on table public.service_usage is
  'M5 (ADR-0013): global per-upstream (and pseudonymous per-user) per-UTC-day call counters. Written ONLY by consume_service_usage(). SERVICE ROLE ONLY (0038: no client read access). Rows older than 30 days are purged nightly by pg_cron.';

-- ============================================================
-- §5. service_usage nightly purge (#8, DB half)
-- ============================================================
-- Counters are per UTC day and only today's row is ever consumed; 30 days
-- are kept for debugging and abuse review. Same pg_cron pattern as 0019 /
-- 0037 (cron.schedule upserts by job name, so re-runs are safe).
create index if not exists service_usage_day_idx on public.service_usage (day);

do $cronjobs$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: tripvisor-service-usage-purge-nightly NOT scheduled. Re-run this block after enabling the extension.';
    return;
  end if;
  perform cron.schedule(
    'tripvisor-service-usage-purge-nightly',
    '45 4 * * *',
    $job$ delete from public.service_usage where day < current_date - 30 $job$
  );
  raise notice 'pg_cron job scheduled: tripvisor-service-usage-purge-nightly (04:45 UTC).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to schedule pg_cron jobs: schedule tripvisor-service-usage-purge-nightly from the Dashboard.';
end
$cronjobs$;

-- ============================================================
-- §6. EXECUTE matrix (0031 posture: nothing for anon/PUBLIC)
-- ============================================================
--   function                                          anon  authenticated              service_role
--   memory_quota_limits()                             -     X (app_config is public)   X
--   trip_memories_storage_total_bytes()               -     -                          X
--   trip_memories_author_bytes(uuid)                  -     -                          X
--   trip_memories_author_usage(uuid,uuid)             -     -                          X
--   trip_memories_trip_photo_count(uuid,uuid)         -     -                          X
--   trip_memories_upload_allowed(text,jsonb)          -     X storage insert policy    X
--   trip_memories_sweep_candidates(interval,integer)  -     -                          X (sweep function)
--   get_memory_quota(uuid)                            -     X                          X
--   trip_place_reviews_place_snapshot()               -     - (trigger)                -
--   trip_places_snapshot_reviews()                    -     - (trigger)                -
--   (default privileges grant new functions to authenticated: revoke first)
revoke all on function public.memory_quota_limits()                                from public, anon;
revoke all on function public.trip_memories_storage_total_bytes()                  from public, anon, authenticated;
revoke all on function public.trip_memories_author_bytes(uuid)                     from public, anon, authenticated;
revoke all on function public.trip_memories_author_usage(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.trip_memories_trip_photo_count(uuid, uuid)           from public, anon, authenticated;
revoke all on function public.trip_memories_upload_allowed(text, jsonb)            from public, anon;
revoke all on function public.trip_memories_sweep_candidates(interval, integer)    from public, anon, authenticated;
revoke all on function public.get_memory_quota(uuid)                               from public, anon;
revoke all on function public.trip_photos_enforce_quota()                          from public, anon, authenticated;
revoke all on function public.trip_memories_guard()                                from public, anon, authenticated;
revoke all on function public.trip_place_reviews_place_snapshot()                  from public, anon, authenticated;
revoke all on function public.trip_places_snapshot_reviews()                       from public, anon, authenticated;

grant execute on function public.memory_quota_limits()                             to authenticated, service_role;
grant execute on function public.trip_memories_storage_total_bytes()               to service_role;
grant execute on function public.trip_memories_author_bytes(uuid)                  to service_role;
grant execute on function public.trip_memories_author_usage(uuid, uuid)            to service_role;
grant execute on function public.trip_memories_trip_photo_count(uuid, uuid)        to service_role;
grant execute on function public.trip_memories_upload_allowed(text, jsonb)         to authenticated, service_role;
grant execute on function public.trip_memories_sweep_candidates(interval, integer) to service_role;
grant execute on function public.get_memory_quota(uuid)                            to authenticated, service_role;
