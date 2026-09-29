-- Tripvisor v2 M5: fixes from the Wave-2 review sweep (backend).
--
-- Sections (each idempotent; re-running the file is a no-op):
--   §1  Anonymous share-read rate limits: public.share_read_counters +
--       consume_share_read() (service role only) + an hourly purge job.
--       Used by share-trip for `read` / `photo_url` / `meta`.
--   §2  Memories Storage sweep also returns the objects of photos that have
--       been TOMBSTONED for more than 7 days (the undo window), not just
--       orphans. Plus a safety net: un-deleting a photo whose files were
--       already swept keeps it deleted (no error, so no sync queue wedges).
--   §3  trip_collaborators.user_id: ON DELETE SET NULL -> ON DELETE CASCADE.
--       Deleting an account no longer leaves its membership rows (with the
--       member's email) on other people's trips. Existing leftovers removed.
--   §4  A REVOKED member can still retract their OWN memories: tombstone
--       them, or set visibility = 'only_me'. Nothing else (no edits, no
--       un-delete, no re-share, never anyone else's rows).
--   §5  duplicate_trip copies every user-authored trip / place / day column
--       (supersedes ADR-0006 decisions 1, 3 and 6; see §5).
--
-- Nothing here reads or stores Google content. The share counters store a
-- share row id and a salted hash of the client IP, never a token or an IP.
--
-- Inverse (local only; run in this order):
--   §5  re-run the `create or replace function public.duplicate_trip` block of
--       0035_v2_m5_leg_modes.sql §4.
--   §4  drop trigger if exists trip_journal_entries_guard_revoked on public.trip_journal_entries;
--       drop trigger if exists trip_place_reviews_guard_revoked   on public.trip_place_reviews;
--       drop trigger if exists trip_photos_guard_revoked          on public.trip_photos;
--       drop function if exists public.trip_memories_revoked_author_guard();
--       drop policy if exists "trip_journal_entries_author_retract" on public.trip_journal_entries;
--       drop policy if exists "trip_place_reviews_author_retract"   on public.trip_place_reviews;
--       drop policy if exists "trip_photos_author_retract"          on public.trip_photos;
--   §3  alter table public.trip_collaborators drop constraint trip_collaborators_user_id_fkey,
--         add constraint trip_collaborators_user_id_fkey foreign key (user_id)
--         references auth.users(id) on delete set null;
--       (the leftover rows removed by the backfill are not restored)
--   §2  drop trigger if exists trip_photos_guard_files on public.trip_photos;
--       drop function if exists public.trip_photos_keep_swept_deleted();
--       re-run the `create or replace function public.trip_memories_sweep_candidates`
--       block of 0038_v2_m5_wave1_fixes.sql §2d (orphans only).
--   §1  select cron.unschedule('tripvisor-share-read-counters-purge');
--       drop function if exists public.consume_share_read(text, text, integer, integer);
--       drop table if exists public.share_read_counters;
--
-- Deploy order (cloud): push this migration BEFORE redeploying share-trip,
-- optimize-trip, delete-account and memories-sweep. share-trip fails CLOSED
-- (503) while consume_share_read is missing.

-- ============================================================
-- §1. Anonymous share-read rate limits
-- ============================================================
-- Keys (built by share-trip, never by a client):
--   '<kind>t:<trip_shares.id>'  per link, UTC-day window   (r = read, p = photo_url, m = meta)
--   '<kind>i:<hash>'            per client IP, UTC-hour window; <hash> = first
--                               32 hex of SHA-256(salt || ip), IPv6 cut to /64
-- A link is counted by its share row id (known only after the token lookup),
-- so an unknown token never creates a counter row and no token material is
-- stored. Rows older than 2 days are purged hourly.
create table if not exists public.share_read_counters (
  key          text        not null check (key ~ '^[a-z]{1,8}:[A-Za-z0-9_-]{1,64}$'),
  window_start timestamptz not null,
  count        integer     not null default 0 check (count >= 0),
  primary key (key, window_start)
);

comment on table public.share_read_counters is
  'M5 sweep (0040): anonymous share-trip read counters. Keys are a share row id (per link, UTC day) or a salted IP hash (per IP, UTC hour); never a token or a raw IP. Written ONLY by consume_share_read() (service role). No client access.';

alter table public.share_read_counters enable row level security;
-- No policies: only the service role (which bypasses RLS) touches it.
revoke all on table public.share_read_counters from public, anon, authenticated;
grant all on table public.share_read_counters to service_role;

create index if not exists share_read_counters_window_idx on public.share_read_counters (window_start);

-- Atomic check-and-increment of BOTH counters (per link, and per IP when
-- p_ip_key is given). Both rows are locked in a fixed order (link, then IP),
-- so concurrent calls cannot overshoot a cap or deadlock. A refused call
-- consumes nothing. Returns
--   { allowed: bool, scope: 'token' | 'ip' | null, retry_after: seconds }
-- where retry_after is the time until the refusing window ends.
create or replace function public.consume_share_read(
  p_token_key text,
  p_ip_key    text,
  p_token_cap integer,
  p_ip_cap    integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_day  timestamptz := date_trunc('day', now(), 'UTC');
  v_hour timestamptz := date_trunc('hour', now(), 'UTC');
  v_tok  integer;
  v_ip   integer;
begin
  if p_token_key is null or p_token_key !~ '^[a-z]{1,8}:[A-Za-z0-9_-]{1,64}$' then
    raise exception 'consume_share_read: invalid token key' using errcode = '22023';
  end if;
  if p_ip_key is not null and p_ip_key !~ '^[a-z]{1,8}:[A-Za-z0-9_-]{1,64}$' then
    raise exception 'consume_share_read: invalid ip key' using errcode = '22023';
  end if;
  if p_token_cap is null or p_token_cap < 0 or (p_ip_key is not null and (p_ip_cap is null or p_ip_cap < 0)) then
    raise exception 'consume_share_read: caps must be >= 0' using errcode = '22023';
  end if;

  insert into public.share_read_counters (key, window_start, count)
  values (p_token_key, v_day, 0)
  on conflict (key, window_start) do nothing;
  select c.count into v_tok
    from public.share_read_counters c
   where c.key = p_token_key and c.window_start = v_day
     for update;

  if p_ip_key is not null then
    insert into public.share_read_counters (key, window_start, count)
    values (p_ip_key, v_hour, 0)
    on conflict (key, window_start) do nothing;
    select c.count into v_ip
      from public.share_read_counters c
     where c.key = p_ip_key and c.window_start = v_hour
       for update;
  end if;

  if v_tok + 1 > p_token_cap then
    return jsonb_build_object(
      'allowed', false, 'scope', 'token',
      'retry_after', greatest(1, ceil(extract(epoch from (v_day + interval '1 day' - now()))))::int);
  end if;
  if p_ip_key is not null and v_ip + 1 > p_ip_cap then
    return jsonb_build_object(
      'allowed', false, 'scope', 'ip',
      'retry_after', greatest(1, ceil(extract(epoch from (v_hour + interval '1 hour' - now()))))::int);
  end if;

  update public.share_read_counters c set count = c.count + 1
   where c.key = p_token_key and c.window_start = v_day;
  if p_ip_key is not null then
    update public.share_read_counters c set count = c.count + 1
     where c.key = p_ip_key and c.window_start = v_hour;
  end if;
  return jsonb_build_object('allowed', true, 'scope', null, 'retry_after', 0);
end;
$$;

comment on function public.consume_share_read(text, text, integer, integer) is
  'M5 sweep (0040): atomic per-link (UTC day) + per-IP (UTC hour, optional) counter for anonymous share-trip reads. Returns {allowed, scope token|ip|null, retry_after seconds}; a refused call consumes nothing. Caps passed by share-trip. SECURITY DEFINER, EXECUTE service_role only.';

revoke all on function public.consume_share_read(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_share_read(text, text, integer, integer) to service_role;

do $cronjobs$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: tripvisor-share-read-counters-purge NOT scheduled. Re-run this block after enabling the extension.';
    return;
  end if;
  perform cron.schedule(
    'tripvisor-share-read-counters-purge',
    '5 * * * *',
    $job$ delete from public.share_read_counters where window_start < now() - interval '2 days' $job$
  );
  raise notice 'pg_cron job scheduled: tripvisor-share-read-counters-purge (hourly at :05 UTC).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to schedule pg_cron jobs: schedule tripvisor-share-read-counters-purge from the Dashboard.';
end
$cronjobs$;

-- ============================================================
-- §2. Memories sweep: orphans + photos tombstoned for > 7 days
-- ============================================================
-- 0038 §2d returned only orphans, so a photo tombstoned on a device that
-- never came back online (or by a revoked member, who can no longer delete
-- Storage objects, §4) kept its two files forever, counting against the
-- author's byte quota and the project-wide guard. The tombstone time is the
-- row's server-stamped updated_at. 7 days keeps the client's undo window
-- (seconds) and any offline replay of an undo well inside the limit. Same
-- signature, same output, same ACL (service_role only, re-asserted below).
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
     and (
       -- orphan: no trip_photos row points at the object
       (    not exists (select 1 from public.trip_photos p where p.storage_path = o.name)
        and not exists (select 1 from public.trip_photos p where p.thumb_path   = o.name))
       or
       -- the row is a tombstone older than the undo window
       exists (select 1 from public.trip_photos p
                where p.id = public.trip_memory_photo_id(o.name)
                  and (p.storage_path = o.name or p.thumb_path = o.name)
                  and p.deleted
                  and p.updated_at < now() - interval '7 days')
     )
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 1000), 1000));
$$;

comment on function public.trip_memories_sweep_candidates(interval, integer) is
  'M5 (0038; 0040: + photos tombstoned > 7 days): up to p_limit (max 1000) trip-memories object names that are orphans (no trip_photos row) or belong to a photo tombstoned (deleted, by updated_at) more than 7 days ago; older than p_min_age (default 1 h), oldest first. Input for the memories-sweep Edge Function (Storage API remove). service_role EXECUTE only.';

revoke all on function public.trip_memories_sweep_candidates(interval, integer) from public, anon, authenticated;
grant execute on function public.trip_memories_sweep_candidates(interval, integer) to service_role;

-- Safety net: once the sweep removed a tombstoned photo's files, an un-delete
-- (a late offline replay of "undo") would resurrect a READY row with no
-- image. Keep such a row deleted instead of raising: an error here would
-- wedge the author's retry queue forever. The next pull shows the tombstone.
create or replace function public.trip_photos_keep_swept_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_full  bigint;
  v_thumb bigint;
begin
  if tg_op = 'UPDATE' and old.deleted and not new.deleted and old.status = 'ready' then
    select s.full_bytes, s.thumb_bytes into v_full, v_thumb
      from public.trip_photo_object_sizes(old.storage_path, old.thumb_path) s;
    if v_full is null or v_thumb is null then
      new.deleted := true;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.trip_photos_keep_swept_deleted() is
  'M5 sweep (0040): BEFORE UPDATE OF deleted on trip_photos. An un-delete of a ready photo whose Storage objects are gone (swept after the 7-day undo window) keeps deleted = true instead of raising, so an offline undo replay cannot resurrect an empty photo or wedge a sync queue. Trigger-only.';

revoke all on function public.trip_photos_keep_swept_deleted() from public, anon, authenticated;

-- BEFORE triggers fire in name order: *_guard < *_guard_files < *_guard_revoked
-- < *_handle_times < *_quota (the quota trigger then sees deleted = true and
-- does nothing).
drop trigger if exists trip_photos_guard_files on public.trip_photos;
create trigger trip_photos_guard_files
  before update of deleted on public.trip_photos
  for each row execute function public.trip_photos_keep_swept_deleted();

-- ============================================================
-- §3. Account deletion removes the member's collaborator rows
-- ============================================================
-- 0011 kept an accepted row with user_id NULL as an "audit row" when the
-- member deleted their account. That row still carries the member's email
-- (personal data of a deleted account) and stays visible to anyone who later
-- signs up with the same address (trip_collaborators_select matches
-- invitee_email). Cascade instead; delete-account also deletes them
-- explicitly (for environments where this migration is not pushed yet).
alter table public.trip_collaborators drop constraint if exists trip_collaborators_user_id_fkey;
alter table public.trip_collaborators
  add constraint trip_collaborators_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Leftovers of earlier deletions: accepted once (accepted_at is only set on
-- accept, which binds user_id) and now unbound = the account is gone. They
-- grant nobody access (user_can_access_trip matches user_id).
delete from public.trip_collaborators
 where user_id is null
   and accepted_at is not null;

-- ============================================================
-- §4. Revoked members can retract their own memories
-- ============================================================
-- 0036 §5 made UPDATE author-only AND member-only, so a member who was
-- removed from a trip could still READ their own rows but could not delete
-- or un-share them: their `trip`-visibility items kept showing to the
-- remaining members. The new permissive policies admit the author even
-- without membership, but only for a row that ends up deleted or only_me;
-- the trigger below then limits the change to exactly that (no edits, no
-- un-delete, no re-share). SELECT is unchanged: a revoked member still sees
-- only their own rows.
drop policy if exists "trip_journal_entries_author_retract" on public.trip_journal_entries;
create policy "trip_journal_entries_author_retract"
  on public.trip_journal_entries for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and (deleted or visibility = 'only_me'));

drop policy if exists "trip_place_reviews_author_retract" on public.trip_place_reviews;
create policy "trip_place_reviews_author_retract"
  on public.trip_place_reviews for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and (deleted or visibility = 'only_me'));

drop policy if exists "trip_photos_author_retract" on public.trip_photos;
create policy "trip_photos_author_retract"
  on public.trip_photos for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and (deleted or visibility = 'only_me'));

-- Runs for JWT callers only (service role / cron / nested FK actions skip it,
-- like trip_memories_guard). Members and non-authors fall through to the
-- existing rules unchanged.
create or replace function public.trip_memories_revoked_author_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.author_id is distinct from v_uid then
    return new;
  end if;
  if public.user_can_access_trip(new.trip_id, v_uid, 'viewer') then
    return new;
  end if;

  -- The author is no longer a member: retract only.
  if (to_jsonb(new) - array['deleted', 'visibility', 'updated_at', 'created_at'])
       is distinct from (to_jsonb(old) - array['deleted', 'visibility', 'updated_at', 'created_at'])
     or (old.deleted and not new.deleted)
     or (new.visibility is distinct from old.visibility and new.visibility <> 'only_me') then
    raise exception 'not_member' using errcode = '42501',
      hint = 'You are no longer a member of this trip: you can only remove or unshare your own memories.';
  end if;
  return new;
end;
$$;

comment on function public.trip_memories_revoked_author_guard() is
  'M5 sweep (0040): BEFORE UPDATE on the three memory tables. When the JWT caller is the author but no longer a trip member, only deleted false->true and visibility -> only_me may change (error not_member otherwise). Members, non-authors and server paths are untouched. Trigger-only.';

revoke all on function public.trip_memories_revoked_author_guard() from public, anon, authenticated;

drop trigger if exists trip_journal_entries_guard_revoked on public.trip_journal_entries;
create trigger trip_journal_entries_guard_revoked
  before update on public.trip_journal_entries
  for each row execute function public.trip_memories_revoked_author_guard();

drop trigger if exists trip_place_reviews_guard_revoked on public.trip_place_reviews;
create trigger trip_place_reviews_guard_revoked
  before update on public.trip_place_reviews
  for each row execute function public.trip_memories_revoked_author_guard();

drop trigger if exists trip_photos_guard_revoked on public.trip_photos;
create trigger trip_photos_guard_revoked
  before update on public.trip_photos
  for each row execute function public.trip_memories_revoked_author_guard();

-- ============================================================
-- §5. duplicate_trip copies every user-authored column
-- ============================================================
-- 0035 §4 body, plus (supersedes ADR-0006 decisions 1, 3 and 6):
--   trips        + total_budget, cost_per_km, route_render_mode,
--                  cover_photo_google_place_id (an id, which the ToS allows
--                  us to keep), anchor_place_id remapped to the copy's place.
--   trip_places  + manual_rank, arrive_after, leave_before, pinned_start, and
--                  day_index / order_in_day: the copy keeps the plan the user
--                  sees. In 'manual' mode those days ARE the user's layout
--                  (set through apply_manual_day_order); in 'optimized' mode
--                  the next optimize run re-places them anyway.
--   trip_days    now copied (live rows): notes, start_time, transport_mode,
--                  day start/end place remapped. They are user-authored
--                  since 0020 / 0035, not computed projections.
-- Still NOT copied: trip_legs (Google-derived, rebuilt by optimize-trip),
-- trip_shares, collaborators, expenses (recorded spend), every memory table,
-- comments, reactions, documents, AI runs, details_refreshed_at (Google
-- refresh bookkeeping), archived_at / optimizing_at, and tombstoned rows.
-- Same signature, SECURITY DEFINER, search_path and authorization checks;
-- CREATE OR REPLACE keeps the 0031 ACL (re-asserted below).
create or replace function public.duplicate_trip(p_trip_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_new_id uuid;
  v_map    jsonb;
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

  -- old place id -> new place id, for the live places only.
  select coalesce(jsonb_object_agg(p.id::text, gen_random_uuid()::text), '{}'::jsonb)
    into v_map
    from public.trip_places p
   where p.trip_id = p_trip_id
     and p.deleted = false;

  insert into public.trips (
    user_id, title, daily_hours_budget, transport_mode, timezone,
    start_date, end_date, anchor_place_id, archived_at, currency,
    cost_per_km, total_budget, route_render_mode, cover_photo_google_place_id
  )
  select
    user_id, title || ' (copy)', daily_hours_budget, transport_mode, timezone,
    start_date, end_date, (v_map->>anchor_place_id::text)::uuid, null, currency,
    cost_per_km, total_budget, route_render_mode, cover_photo_google_place_id
  from public.trips
  where id = p_trip_id
  returning id into v_new_id;

  insert into public.trip_places (
    id, trip_id, google_place_id, lat, lng, user_title, category,
    visit_duration_minutes, notes, day_index, order_in_day,
    arrive_after, leave_before, pinned_start, manual_rank,
    arrival_mode, arrival_minutes
  )
  select
    (v_map->>p.id::text)::uuid, v_new_id, p.google_place_id, p.lat, p.lng, p.user_title, p.category,
    p.visit_duration_minutes, p.notes, p.day_index, p.order_in_day,
    p.arrive_after, p.leave_before, p.pinned_start, p.manual_rank,
    p.arrival_mode, p.arrival_minutes
  from public.trip_places p
  where p.trip_id = p_trip_id
    and p.deleted = false;  -- v2: never resurrect tombstoned places in the copy

  insert into public.trip_days (
    trip_id, day_index, day_start_place_id, day_end_place_id, notes, start_time, transport_mode
  )
  select
    v_new_id, d.day_index,
    (v_map->>d.day_start_place_id::text)::uuid,
    (v_map->>d.day_end_place_id::text)::uuid,
    d.notes, d.start_time, d.transport_mode
  from public.trip_days d
  where d.trip_id = p_trip_id
    and d.deleted = false;

  return v_new_id;
end;
$$;

comment on function public.duplicate_trip(uuid) is
  'Owner-only trip copy (0040): every user-authored column of trips, live trip_places (incl. day layout, ranks, time windows, arrival modes) and live trip_days, with place references remapped. Never copies legs, shares, collaborators, expenses, memories, comments, reactions, documents or tombstones. Returns the new trip id.';

revoke all on function public.duplicate_trip(uuid) from public, anon;
grant execute on function public.duplicate_trip(uuid) to authenticated, service_role;
