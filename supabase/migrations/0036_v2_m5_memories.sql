-- Tripvisor v2 M5 (Y1.2): memories schema. Journal, personal place reviews,
-- photos, the private `trip-memories` Storage bucket, quotas.
-- ADR-0014 (memories storage) + BUILD-LOG §M5 blocker 3 (user decision
-- 2026-09-29: memories are PRIVATE BY DEFAULT).
--
-- Sections (each idempotent; re-runs no-op):
--   1. Tables: trip_journal_entries, trip_place_reviews, trip_photos
--   2. Indexes (FKs, sync pulls, quota counts, one-live-review-per-place)
--   3. Helpers: path parsing, object sizes, quota limits, quota status RPC
--   4. Triggers: guard (immutables, actor rules, photo status machine),
--      handle_times (server-stamped updated_at), review supersede, photo quota
--   5. RLS policies + table grants
--   6. Storage bucket `trip-memories` + storage.objects policies
--   7. Realtime publication
--   8. pg_cron: purge photo rows stuck in `pending`
--   9. EXECUTE matrix (0031 posture: nothing for anon/PUBLIC)
--
-- ===========================================================================
-- VISIBILITY MODEL (the contract Y2.1 / Y2.5 / Y3.1 build on)
-- ===========================================================================
--   visibility text not null default 'only_me'  check in ('only_me','trip')
--
--   SELECT  author: ALWAYS (every own row, any visibility, tombstones and
--                   pending photos included; this is what the author's
--                   offline replica and undo need).
--           other trip members (owner / editor / viewer): only when
--                   visibility = 'trip' AND deleted = false
--                   (+ status = 'ready' for photos).
--           non-members and anon: never (anon has no table grant at all).
--   INSERT  any ACCEPTED member, viewers included, for THEMSELVES only
--           (author_id = auth.uid(); column default auth.uid()). Decision
--           per ADR-0014 §4: memories are personal content, so read-only
--           collaborators may keep their own journal/reviews/photos on a
--           trip they can read, but can never touch anyone else's.
--   UPDATE  author only (any user column), while still a member (0031
--           posture: a revoked member keeps read access to their own rows
--           but can no longer change them).
--           Trip owner moderation: rpc('remove_trip_memory', {p_kind, p_id})
--           tombstones someone else's SHARED item (photos: ready). It is an
--           RPC because Postgres checks an UPDATE's new row against the
--           SELECT policy and a tombstone is invisible to non-authors. The
--           guard trigger still limits any non-author change to
--           deleted false -> true (`not_author` otherwise).
--   DELETE  (hard) author only, while still a member. The normal delete is
--           the tombstone (`deleted = true`), which replicates.
--   Public share link: NEVER reads these tables under RLS. share-trip (Y2.5)
--           uses the service role with the explicit filter
--           visibility = 'trip' AND deleted = false (AND status = 'ready'
--           for photos) AND trip_shares.show_memories = true.
--
-- SYNC CONTRACT FOR Y2.1 (read before wiring Tier-1 roots)
--   - Client-minted UUID PKs (`id` has a default but clients may supply it).
--   - `updated_at` is SERVER-stamped by handle_times() (the LWW clock);
--     `created_at` is client-suppliable on INSERT, immutable afterwards.
--   - `deleted` is the tombstone. `author_id` defaults to auth.uid(), so a
--     create payload may omit it. id / trip_id / author_id (and
--     trip_place_id on reviews) are immutable: an UPDATE that changes them
--     raises `immutable_column`.
--   - Journal body may be '' (an autosaving editor must never hit a CHECK
--     and wedge the infinite-retry queue). One journal row per day is NOT
--     enforced: two offline devices may both create an entry for the same
--     day, and both survive (no silent text loss).
--   - Reviews: one LIVE review per (trip_place_id, author). A create (or
--     un-delete) of a second live review TOMBSTONES the older one instead
--     of failing (last-write-wins, the engine's model). A duplicate insert
--     therefore never 23505-wedges the offline queue.
--   - IMPORTANT: when an author un-shares (trip -> only_me) or tombstones
--     an item, the row DISAPPEARS from other members' RLS view. Incremental
--     `updated_at > last-sync` pulls and Realtime cannot deliver a row the
--     reader can no longer see, so a Tier-1 replica of OTHER people's
--     memories would keep a stale private copy forever. Therefore Tier-1
--     memory roots MUST be scoped to author_id = auth.uid() (own items).
--     Other members' shared items are read through Tier-2 (TanStack Query,
--     refetched, NOT persisted). The (author_id, updated_at) indexes below
--     serve exactly that scoped pull.
--
-- PHOTO UPLOAD CONTRACT (Y2.1 photo pipeline)
--   1. INSERT a trip_photos row (online). The server forces status =
--      'pending', bytes = NULL and stamps storage_path / thumb_path =
--      '<trip_id>/<author_id>/<id>.jpg' / '..._t.jpg' (lower-case uuids).
--      Upload to EXACTLY those returned paths.
--   2. Upload both objects to bucket `trip-memories` (upsert: false). The
--      storage INSERT policy only accepts a path that matches a PENDING,
--      non-deleted row authored by the caller, in the caller's own
--      `<author_id>/` folder, on a trip they can still read. A 409
--      "already exists" on retry means the object is there: treat as done.
--   3. UPDATE status = 'ready'. The guard verifies BOTH objects exist and
--      stamps bytes / thumb_bytes from Storage metadata (client values are
--      ignored); a missing object raises `upload_incomplete`.
--   A row still `pending` after 24 h (updated_at) is hard-deleted by
--   pg_cron (§8). A native retry queue that wakes up later must re-INSERT
--   the row (same client id) before uploading again.
--   Tombstoning a photo does not delete its objects: the author's client
--   removes them when online (it can always read/delete its own folder).
--   Owner moderation of someone else's shared photo: delete both objects
--   FIRST (visible to the owner only while the row is shared + live), then
--   rpc('remove_trip_memory', { p_kind: 'photo', p_id }).
--
-- QUOTAS (trip_photos only; trigger §4c; error = PostgREST 400 with
--   `message` = the token below, `details` = JSON {scope, limit, used}):
--   quota_exceeded  per-user live photos >= app_config.memories_user_cap
--                   (default 300) or per-trip >= memories_trip_cap (500)
--   storage_full    total Storage bytes (ALL buckets: the 1 GB free tier is
--                   project-wide) >= memories_storage_guard_bytes
--                   (default 943718400 = 900 MiB)
--   Counts are serialized per user and per trip with transaction advisory
--   locks, so concurrent inserts at cap-1 cannot overshoot. Absent
--   app_config rows mean "use the default" (0022 convention, nothing
--   seeded). get_memory_quota(trip_id) exposes usage for the Profile/UI.
--
-- Other error tokens: author_mismatch, immutable_column, not_author,
--   not_found, invalid_status_transition, upload_incomplete (SQLSTATE 42501
--   or P0001, `message` = token); invalid_kind (22023).
--
-- Inverse (local only; run in this order):
--   select cron.unschedule('tripvisor-trip-photos-pending-purge');
--   alter publication supabase_realtime drop table public.trip_journal_entries,
--     public.trip_place_reviews, public.trip_photos;   (guard like §7)
--   drop policy if exists "trip_memories_select" on storage.objects;
--   drop policy if exists "trip_memories_author_insert" on storage.objects;
--   drop policy if exists "trip_memories_delete" on storage.objects;
--   -- empty the bucket through the Storage API (direct SQL deletes are
--   -- blocked by storage.protect_delete), then:
--   delete from storage.buckets where id = 'trip-memories';
--   drop table if exists public.trip_photos, public.trip_place_reviews,
--     public.trip_journal_entries;
--   drop function if exists public.trip_memories_guard(),
--     public.trip_place_reviews_supersede(), public.trip_photos_enforce_quota(),
--     public.trip_photo_object_sizes(text, text), public.trip_memory_photo_id(text),
--     public.memory_quota_limits(), public.get_memory_quota(uuid),
--     public.remove_trip_memory(text, uuid), public.purge_stale_pending_photos(interval);
--
-- Deploy order (cloud): push this migration BEFORE redeploying
-- delete-account / delete-trip / export-account (they list the new bucket
-- and read the new tables). The Storage cleanup treats a missing bucket as
-- empty, so a mis-ordered deploy degrades instead of blocking deletions.

-- ============================================================
-- 1. Tables
-- ============================================================

-- 1a. Day journal. One or more entries per (trip, author, day).
create table if not exists public.trip_journal_entries (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 0-based trip day (same convention as trip_places / trip_expenses).
  day_index   integer not null check (day_index between 0 and 999),
  -- '' is allowed on purpose (autosave; see header). 20k chars is ~8 pages.
  body        text not null default '' check (char_length(body) <= 20000),
  visibility  text not null default 'only_me' check (visibility in ('only_me', 'trip')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

comment on table public.trip_journal_entries is
  'M5 Y1.2 (ADR-0014): per-author day journal. PRIVATE BY DEFAULT (visibility=only_me): the author always sees own rows; other trip members only see visibility=trip AND NOT deleted. Any accepted member (viewers too) may write their OWN entries. Tier-1 root (Y2.1) scoped to author_id = auth.uid(); others'' shared entries are Tier-2. updated_at server-stamped (handle_times); deleted = tombstone. User content only, never Google data.';
comment on column public.trip_journal_entries.visibility is
  'only_me (default) = author only; trip = every accepted member of the trip. The public share link additionally needs trip_shares.show_memories = true.';

-- 1b. Personal 1-5 rating + review of a trip place (user content; shown
-- apart from, never averaged with, Google ratings).
create table if not exists public.trip_place_reviews (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips(id) on delete cascade,
  trip_place_id  uuid not null references public.trip_places(id) on delete cascade,
  author_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- NULL = text written, stars not picked yet.
  rating         smallint null check (rating is null or rating between 1 and 5),
  body           text not null default '' check (char_length(body) <= 4000),
  visibility     text not null default 'only_me' check (visibility in ('only_me', 'trip')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);

comment on table public.trip_place_reviews is
  'M5 Y1.2 (ADR-0014): the user''s OWN 1-5 rating + review of a trip place. `rating` is USER content (not Google data; the C3 allowlist needs a documented exception for this table only). One LIVE review per (trip_place_id, author_id): creating or un-deleting a second one tombstones the older (last write wins, never a 23505). Private by default like the journal.';
comment on column public.trip_place_reviews.rating is
  'The author''s personal stars (1-5), NULL until picked. Never mixed with or averaged into Google ratings.';

-- 1c. Photo index rows. The bytes live in the private `trip-memories`
-- bucket (§6); this row is what RLS, quotas and the storage policies key on.
create table if not exists public.trip_photos (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips(id) on delete cascade,
  author_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day_index      integer null check (day_index is null or day_index between 0 and 999),
  -- A photo outlives the place it was attached to.
  trip_place_id  uuid null references public.trip_places(id) on delete set null,
  -- Server-stamped by the guard on INSERT, immutable afterwards.
  storage_path   text not null,
  thumb_path     text not null,
  width          integer null check (width  is null or width  between 1 and 20000),
  height         integer null check (height is null or height between 1 and 20000),
  -- Server-stamped from Storage metadata when status becomes 'ready'.
  bytes          integer null check (bytes is null or bytes >= 0),
  thumb_bytes    integer null check (thumb_bytes is null or thumb_bytes >= 0),
  caption        text null check (caption is null or char_length(caption) <= 500),
  -- From picker EXIF, read on device before the re-encode strips EXIF.
  taken_at       timestamptz null,
  status         text not null default 'pending' check (status in ('pending', 'ready')),
  visibility     text not null default 'only_me' check (visibility in ('only_me', 'trip')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false,
  constraint trip_photos_storage_path_key unique (storage_path),
  constraint trip_photos_thumb_path_key   unique (thumb_path)
);

comment on table public.trip_photos is
  'M5 Y1.2 (ADR-0014): index row per memory photo; bytes live in the private trip-memories bucket at storage_path / thumb_path (server-stamped <trip_id>/<author_id>/<id>.jpg and _t.jpg). Flow: INSERT (status forced pending) -> upload both objects -> UPDATE status=ready (guard verifies the objects and stamps bytes). Members see only ready + shared + live rows. Quotas: per-user / per-trip caps + global storage guard (errors quota_exceeded / storage_full). Pending rows untouched for 24 h are purged by pg_cron.';
comment on column public.trip_photos.status is
  'pending = row created, upload in progress (author-only, not shown to members); ready = both objects verified in Storage. ready -> pending is not allowed.';
comment on column public.trip_photos.bytes is
  'Full-image size in bytes, stamped by the server from storage.objects metadata on pending -> ready (client values ignored). thumb_bytes likewise.';

-- ============================================================
-- 2. Indexes
-- ============================================================
-- FKs + RLS predicates + the share-trip read (trip_id).
create index if not exists trip_journal_entries_trip_day_idx   on public.trip_journal_entries (trip_id, day_index);
create index if not exists trip_place_reviews_trip_idx          on public.trip_place_reviews (trip_id);
create index if not exists trip_place_reviews_place_idx         on public.trip_place_reviews (trip_place_id);
create index if not exists trip_photos_trip_idx                 on public.trip_photos (trip_id);
create index if not exists trip_photos_place_idx                on public.trip_photos (trip_place_id) where trip_place_id is not null;

-- author_id FK + the Tier-1 own-items incremental pull
-- (WHERE author_id = me AND updated_at > $lastSync).
create index if not exists trip_journal_entries_author_updated_idx on public.trip_journal_entries (author_id, updated_at);
create index if not exists trip_place_reviews_author_updated_idx   on public.trip_place_reviews (author_id, updated_at);
create index if not exists trip_photos_author_updated_idx          on public.trip_photos (author_id, updated_at);

-- Unscoped incremental pulls (RLS-only select), same as 0027's *_updated_at_idx.
create index if not exists trip_journal_entries_updated_at_idx on public.trip_journal_entries (updated_at);
create index if not exists trip_place_reviews_updated_at_idx   on public.trip_place_reviews (updated_at);
create index if not exists trip_photos_updated_at_idx          on public.trip_photos (updated_at);

-- One live review per place per author (backstop for the supersede trigger).
create unique index if not exists trip_place_reviews_one_live_idx
  on public.trip_place_reviews (trip_place_id, author_id)
  where not deleted;

-- Pending purge (§8).
create index if not exists trip_photos_pending_idx
  on public.trip_photos (updated_at)
  where status = 'pending';

-- ============================================================
-- 3. Helpers
-- ============================================================

-- 3a. Object key -> photo id, or NULL unless the key is EXACTLY
-- '<uuid>/<uuid>/<uuid>.jpg' or '<uuid>/<uuid>/<uuid>_t.jpg' (lower-case,
-- the form trip_photos stamps). Fail-closed like storage_path_trip_id
-- (0024): a malformed key never reaches a cast.
create or replace function public.trip_memory_photo_id(object_name text)
returns uuid
language plpgsql
immutable
strict
set search_path = public, pg_catalog
as $$
declare
  m text[];
begin
  m := regexp_match(
    object_name,
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(_t)?\.jpg$'
  );
  if m is null then
    return null;
  end if;
  return m[1]::uuid;
end;
$$;

comment on function public.trip_memory_photo_id(text) is
  'M5 Y1.2: parses a trip-memories object key <trip>/<author>/<photo>(_t).jpg and returns the photo uuid, or NULL for any other shape (fail-closed, no cast errors). Used by the storage.objects policies.';

-- 3b. Sizes of the two objects of a photo, read from storage.objects
-- metadata. SECURITY DEFINER (authenticated cannot read other rows of
-- storage.objects), but it only answers for objects in the CALLER'S OWN
-- `<trip>/<caller>/` folder, so it is no existence/size oracle.
create or replace function public.trip_photo_object_sizes(p_storage_path text, p_thumb_path text)
returns table (full_bytes bigint, thumb_bytes bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is not null
     and (split_part(p_storage_path, '/', 2) is distinct from auth.uid()::text
          or split_part(p_thumb_path, '/', 2) is distinct from auth.uid()::text) then
    raise exception 'not_author' using errcode = '42501',
      hint = 'Only the author can check the upload state of a photo.';
  end if;
  return query
  select
    (select case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint end
       from storage.objects o
      where o.bucket_id = 'trip-memories' and o.name = p_storage_path),
    (select case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint end
       from storage.objects o
      where o.bucket_id = 'trip-memories' and o.name = p_thumb_path);
end;
$$;

comment on function public.trip_photo_object_sizes(text, text) is
  'M5 Y1.2: sizes (bytes) of a photo''s full + thumb objects in trip-memories, NULL when missing. Called by the trip_photos guard on pending -> ready. SECURITY DEFINER; answers only for paths in the caller''s own <trip>/<uid>/ folder (service role: any).';

-- 3c. Quota limits: app_config overrides (text values, validated) with the
-- ADR-0014 defaults. Absent / malformed row = default (0022 convention).
create or replace function public.memory_quota_limits(
  out user_cap            integer,
  out trip_cap            integer,
  out storage_guard_bytes bigint
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
      943718400);
$$;

comment on function public.memory_quota_limits() is
  'M5 Y1.2: photo quota limits. app_config keys memories_user_cap (default 300 live photos per author), memories_trip_cap (default 500 per trip), memories_storage_guard_bytes (default 943718400 = 900 MiB, compared with the TOTAL bytes of every Storage bucket). Absent or non-numeric = default.';

-- 3d. Usage for the Profile screen / pre-upload checks. SECURITY DEFINER
-- because the per-trip count includes other members' private photos (only
-- the COUNT leaves the function). Trip numbers require viewer access.
create or replace function public.get_memory_quota(p_trip_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := auth.uid();
  v_limits     record;
  v_user_used  integer;
  v_user_bytes bigint;
  v_trip_used  integer;
  v_total      bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_trip_id is not null and not public.user_can_access_trip(p_trip_id, v_uid, 'viewer') then
    raise exception 'not_found' using errcode = '42501', hint = 'Trip not found or not shared with you.';
  end if;

  select * into v_limits from public.memory_quota_limits();

  select count(*), coalesce(sum(coalesce(p.bytes, 0) + coalesce(p.thumb_bytes, 0)), 0)
    into v_user_used, v_user_bytes
    from public.trip_photos p
   where p.author_id = v_uid and not p.deleted;

  if p_trip_id is not null then
    select count(*) into v_trip_used
      from public.trip_photos p
     where p.trip_id = p_trip_id and not p.deleted;
  end if;

  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                           then (o.metadata->>'size')::bigint else 0 end), 0)
    into v_total
    from storage.objects o;

  return jsonb_build_object(
    'user_used',    v_user_used,
    'user_cap',     v_limits.user_cap,
    'user_bytes',   v_user_bytes,
    'trip_used',    v_trip_used,
    'trip_cap',     case when p_trip_id is null then null else v_limits.trip_cap end,
    'storage_full', v_total >= v_limits.storage_guard_bytes
  );
end;
$$;

comment on function public.get_memory_quota(uuid) is
  'M5 Y1.2: {user_used, user_cap, user_bytes, trip_used, trip_cap, storage_full} for the caller (and optionally a trip they can read). Counts live (non-deleted) photos, pending included. rpc(''get_memory_quota'', { p_trip_id }). authenticated only.';

-- 3e. Owner moderation: tombstone someone else's SHARED memory.
-- Why an RPC and not an UPDATE policy: Postgres re-checks an UPDATE's new
-- row against the SELECT policies, and a tombstoned item is (by design)
-- invisible to everyone but its author, so an owner UPDATE ... SET
-- deleted = true always fails with "new row violates row-level security".
-- This function is the one narrow path: it runs as the definer, finds the
-- row, and only proceeds when the caller is the author (while still a
-- member) or the trip OWNER looking at an item they can already see
-- (visibility = 'trip', and status = 'ready' for photos). Anything else is
-- `not_found` (existence of a private item is never revealed). The UPDATE
-- still passes the guard trigger (a non-author may only flip deleted).
-- Returns true when it tombstoned the row, false when it already was.
-- Photo objects are removed separately and BEFORE this call (storage
-- DELETE needs SELECT visibility, which the owner loses on the tombstone).
create or replace function public.remove_trip_memory(p_kind text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid     uuid := auth.uid();
  v_table   text;
  v_trip    uuid;
  v_author  uuid;
  v_vis     text;
  v_deleted boolean;
  v_status  text := 'ready';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_kind = 'journal' then
    v_table := 'trip_journal_entries';
    select trip_id, author_id, visibility, deleted into v_trip, v_author, v_vis, v_deleted
      from public.trip_journal_entries where id = p_id for update;
  elsif p_kind = 'review' then
    v_table := 'trip_place_reviews';
    select trip_id, author_id, visibility, deleted into v_trip, v_author, v_vis, v_deleted
      from public.trip_place_reviews where id = p_id for update;
  elsif p_kind = 'photo' then
    v_table := 'trip_photos';
    select trip_id, author_id, visibility, deleted, status into v_trip, v_author, v_vis, v_deleted, v_status
      from public.trip_photos where id = p_id for update;
  else
    raise exception 'invalid_kind' using errcode = '22023', hint = 'p_kind must be journal, review or photo.';
  end if;

  if v_trip is null then
    raise exception 'not_found' using errcode = '42501';
  end if;

  if v_author = v_uid then
    if not public.user_can_access_trip(v_trip, v_uid, 'viewer') then
      raise exception 'not_found' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.trips t where t.id = v_trip and t.user_id = v_uid)
        or v_vis <> 'trip'
        or v_status <> 'ready' then
    raise exception 'not_found' using errcode = '42501';
  end if;

  if v_deleted then
    return false;
  end if;

  execute format('update public.%I set deleted = true where id = $1', v_table) using p_id;
  return true;
end;
$$;

comment on function public.remove_trip_memory(text, uuid) is
  'M5 Y1.2: tombstones a memory (p_kind journal | review | photo). Allowed for the author (while a member) and for the trip OWNER on items shared with the trip (photos: ready). Everything else raises not_found (private items are never revealed). Returns true if tombstoned now, false if it already was. rpc(''remove_trip_memory'', { p_kind, p_id }).';

-- ============================================================
-- 4. Triggers
-- ============================================================

-- 4a. Guard: shared by the three tables (PL/pgSQL caches one plan set per
-- table, so table-specific branches are safe). BEFORE INSERT OR UPDATE;
-- its name sorts before `*_handle_times` so it sees the client's intent.
--
--   INSERT  author_id defaults to / must equal auth.uid() (JWT callers).
--           trip_photos: status forced 'pending', bytes NULL, paths stamped.
--   UPDATE  id / trip_id / author_id (+ reviews.trip_place_id) immutable;
--           trip_photos paths re-pinned to OLD.
--           Actor rules (skipped for trusted server paths: no JWT, i.e.
--           service role / cron, or a nested trigger / FK action such as
--           trip_photos.trip_place_id ON DELETE SET NULL, which runs with
--           the JWT of whoever deleted the place):
--             author      -> any user column;
--             non-author  -> (only remove_trip_memory() gets here; the
--                            UPDATE policies are author-only) deleted
--                            false -> true, nothing else.
--           trip_photos status machine: pending -> ready requires both
--           objects in Storage (bytes stamped from metadata); ready ->
--           pending is refused; bytes otherwise stay OLD.
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
    if new.trip_place_id is distinct from old.trip_place_id then
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
  'M5 Y1.2: BEFORE INSERT/UPDATE guard for trip_journal_entries / trip_place_reviews / trip_photos: author pinning, immutable id/trip_id/author_id (+ review place), owner = tombstone-only moderation, trip_photos path stamping + pending -> ready verification. Errors: author_mismatch, immutable_column, not_author, invalid_status_transition, upload_incomplete.';

-- 4b. Reviews: last write wins among an author's live reviews of a place.
-- Runs as the invoker, so the nested UPDATE is itself RLS-checked (the
-- author updating their own rows).
create or replace function public.trip_place_reviews_supersede()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.deleted then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.deleted then
    return new;  -- only a create or an un-delete can make a second live row
  end if;
  update public.trip_place_reviews r
     set deleted = true
   where r.trip_place_id = new.trip_place_id
     and r.author_id     = new.author_id
     and r.id           <> new.id
     and not r.deleted;
  return new;
end;
$$;

comment on function public.trip_place_reviews_supersede() is
  'M5 Y1.2: when a review is created or un-deleted, tombstones the author''s other live review of the same place (last write wins), so the one-live-review unique index never wedges an offline create with 23505.';

-- 4c. Photo quota + global storage guard. SECURITY DEFINER: the per-trip
-- count spans other members' private rows and the guard reads every
-- storage.objects row. Fires on INSERT and on un-delete (a restore
-- re-occupies a slot). Transaction advisory locks serialize concurrent
-- inserts for the same author / trip (always user first, then trip, so the
-- lock order cannot deadlock).
create or replace function public.trip_photos_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limits record;
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

  select count(*) into v_used
    from public.trip_photos p
   where p.author_id = new.author_id and not p.deleted and p.id <> new.id;
  if v_used >= v_limits.user_cap then
    raise exception 'quota_exceeded' using errcode = 'P0001',
      detail = json_build_object('scope', 'user', 'limit', v_limits.user_cap, 'used', v_used)::text,
      hint = 'You have reached your photo limit. Remove some photos to add new ones.';
  end if;

  select count(*) into v_used
    from public.trip_photos p
   where p.trip_id = new.trip_id and not p.deleted and p.id <> new.id;
  if v_used >= v_limits.trip_cap then
    raise exception 'quota_exceeded' using errcode = 'P0001',
      detail = json_build_object('scope', 'trip', 'limit', v_limits.trip_cap, 'used', v_used)::text,
      hint = 'This trip has reached its photo limit.';
  end if;

  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
                           then (o.metadata->>'size')::bigint else 0 end), 0)
    into v_total
    from storage.objects o;
  if v_total >= v_limits.storage_guard_bytes then
    raise exception 'storage_full' using errcode = 'P0001',
      detail = json_build_object('scope', 'global', 'limit', v_limits.storage_guard_bytes, 'used', v_total)::text,
      hint = 'Photo storage is full right now.';
  end if;

  return new;
end;
$$;

comment on function public.trip_photos_enforce_quota() is
  'M5 Y1.2: BEFORE INSERT / un-delete on trip_photos: per-author and per-trip live-photo caps (quota_exceeded) and the global Storage guard over ALL buckets (storage_full). Limits from memory_quota_limits(). SECURITY DEFINER; advisory-locked per author and per trip.';

-- 4d. Wire the triggers. BEFORE triggers fire in name order:
--   *_guard < *_handle_times < *_quota / *_supersede.
drop trigger if exists trip_journal_entries_guard        on public.trip_journal_entries;
drop trigger if exists trip_journal_entries_handle_times on public.trip_journal_entries;
create trigger trip_journal_entries_guard
  before insert or update on public.trip_journal_entries
  for each row execute function public.trip_memories_guard();
create trigger trip_journal_entries_handle_times
  before insert or update on public.trip_journal_entries
  for each row execute function public.handle_times();

drop trigger if exists trip_place_reviews_guard        on public.trip_place_reviews;
drop trigger if exists trip_place_reviews_handle_times on public.trip_place_reviews;
drop trigger if exists trip_place_reviews_supersede    on public.trip_place_reviews;
create trigger trip_place_reviews_guard
  before insert or update on public.trip_place_reviews
  for each row execute function public.trip_memories_guard();
create trigger trip_place_reviews_handle_times
  before insert or update on public.trip_place_reviews
  for each row execute function public.handle_times();
create trigger trip_place_reviews_supersede
  before insert or update of deleted on public.trip_place_reviews
  for each row execute function public.trip_place_reviews_supersede();

drop trigger if exists trip_photos_guard        on public.trip_photos;
drop trigger if exists trip_photos_handle_times on public.trip_photos;
drop trigger if exists trip_photos_quota        on public.trip_photos;
create trigger trip_photos_guard
  before insert or update on public.trip_photos
  for each row execute function public.trip_memories_guard();
create trigger trip_photos_handle_times
  before insert or update on public.trip_photos
  for each row execute function public.handle_times();
create trigger trip_photos_quota
  before insert or update of deleted on public.trip_photos
  for each row execute function public.trip_photos_enforce_quota();

-- ============================================================
-- 5. RLS + grants
-- ============================================================
-- Per-verb policies (0010/0024 convention). Every write policy re-asserts
-- trip access (0031 posture: no re-parenting, a revoked member cannot
-- mutate). UPDATE and DELETE are author-only; owner moderation goes through
-- remove_trip_memory() (§3e), because an UPDATE's new row must still pass
-- the SELECT policy and a tombstone is invisible to non-authors.

alter table public.trip_journal_entries enable row level security;
alter table public.trip_place_reviews   enable row level security;
alter table public.trip_photos          enable row level security;

-- 5a. trip_journal_entries ---------------------------------------------
drop policy if exists "trip_journal_entries_select" on public.trip_journal_entries;
create policy "trip_journal_entries_select"
  on public.trip_journal_entries for select
  to authenticated
  using (
    author_id = auth.uid()
    or (
      visibility = 'trip'
      and not deleted
      and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    )
  );

drop policy if exists "trip_journal_entries_insert" on public.trip_journal_entries;
create policy "trip_journal_entries_insert"
  on public.trip_journal_entries for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

drop policy if exists "trip_journal_entries_update" on public.trip_journal_entries;
drop policy if exists "trip_journal_entries_author_update" on public.trip_journal_entries;
create policy "trip_journal_entries_author_update"
  on public.trip_journal_entries for update
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  )
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

drop policy if exists "trip_journal_entries_author_delete" on public.trip_journal_entries;
create policy "trip_journal_entries_author_delete"
  on public.trip_journal_entries for delete
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

-- 5b. trip_place_reviews -------------------------------------------------
drop policy if exists "trip_place_reviews_select" on public.trip_place_reviews;
create policy "trip_place_reviews_select"
  on public.trip_place_reviews for select
  to authenticated
  using (
    author_id = auth.uid()
    or (
      visibility = 'trip'
      and not deleted
      and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    )
  );

-- The place must belong to the claimed trip (the EXISTS runs under the
-- caller's viewer-gated trip_places RLS, as in 0019 comments).
drop policy if exists "trip_place_reviews_insert" on public.trip_place_reviews;
create policy "trip_place_reviews_insert"
  on public.trip_place_reviews for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and exists (select 1 from public.trip_places tp
                 where tp.id = trip_place_reviews.trip_place_id
                   and tp.trip_id = trip_place_reviews.trip_id)
  );

drop policy if exists "trip_place_reviews_update" on public.trip_place_reviews;
drop policy if exists "trip_place_reviews_author_update" on public.trip_place_reviews;
create policy "trip_place_reviews_author_update"
  on public.trip_place_reviews for update
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  )
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

drop policy if exists "trip_place_reviews_author_delete" on public.trip_place_reviews;
create policy "trip_place_reviews_author_delete"
  on public.trip_place_reviews for delete
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

-- 5c. trip_photos ---------------------------------------------------------
drop policy if exists "trip_photos_select" on public.trip_photos;
create policy "trip_photos_select"
  on public.trip_photos for select
  to authenticated
  using (
    author_id = auth.uid()
    or (
      visibility = 'trip'
      and not deleted
      and status = 'ready'
      and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    )
  );

drop policy if exists "trip_photos_insert" on public.trip_photos;
create policy "trip_photos_insert"
  on public.trip_photos for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and (
      trip_place_id is null
      or exists (select 1 from public.trip_places tp
                  where tp.id = trip_photos.trip_place_id
                    and tp.trip_id = trip_photos.trip_id)
    )
  );

drop policy if exists "trip_photos_update" on public.trip_photos;
drop policy if exists "trip_photos_author_update" on public.trip_photos;
create policy "trip_photos_author_update"
  on public.trip_photos for update
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  )
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and (
      trip_place_id is null
      or exists (select 1 from public.trip_places tp
                  where tp.id = trip_photos.trip_place_id
                    and tp.trip_id = trip_photos.trip_id)
    )
  );

drop policy if exists "trip_photos_author_delete" on public.trip_photos;
create policy "trip_photos_author_delete"
  on public.trip_photos for delete
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

-- 5d. Table grants: explicit (the schema default grants every privilege,
-- TRUNCATE included, to anon and authenticated). anon gets nothing; the
-- public share page reads through share-trip (service role).
revoke all on table public.trip_journal_entries from anon, authenticated;
revoke all on table public.trip_place_reviews   from anon, authenticated;
revoke all on table public.trip_photos          from anon, authenticated;
grant select, insert, update, delete on table public.trip_journal_entries to authenticated;
grant select, insert, update, delete on table public.trip_place_reviews   to authenticated;
grant select, insert, update, delete on table public.trip_photos          to authenticated;
grant all on table public.trip_journal_entries to service_role;
grant all on table public.trip_place_reviews   to service_role;
grant all on table public.trip_photos          to service_role;

-- ============================================================
-- 6. Storage bucket `trip-memories` + storage.objects policies
-- ============================================================
-- Private; 1 MiB per object (client targets ~300 KB + ~40 KB thumb);
-- JPEG/WebP only. Environment-tolerant like 0024: a missing schema or
-- insufficient privilege degrades to a NOTICE with the SQL to run.
do $bucket$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage.buckets not found: create a PRIVATE bucket "trip-memories" (1 MiB limit; image/jpeg, image/webp) via Dashboard -> Storage.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('trip-memories', 'trip-memories', false)
  on conflict (id) do nothing;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    update storage.buckets set file_size_limit = 1048576 where id = 'trip-memories';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    update storage.buckets
       set allowed_mime_types = array['image/jpeg', 'image/webp']
     where id = 'trip-memories';
  end if;

  -- Belt and braces: never public, whatever an earlier run or the dashboard did.
  update storage.buckets set public = false where id = 'trip-memories';

  raise notice 'storage bucket trip-memories ensured (private, 1 MiB, jpeg/webp).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to write storage.buckets: create a PRIVATE bucket "trip-memories" (1 MiB limit; image/jpeg, image/webp) via Dashboard -> Storage.';
end
$bucket$;

-- Object policies. Key = '<trip_id>/<author_id>/<photo_id>(_t).jpg'.
--   SELECT  the matching trip_photos row is visible to the caller under
--           trip_photos RLS (author: always; members: shared + ready +
--           live), OR the key is in the caller's own `<trip>/<uid>/` folder
--           while they are a member (so an author can list and remove
--           orphans of a hard-deleted / purged row).
--   INSERT  only into the caller's own folder, only for their own PENDING
--           live row whose stamped path equals the key, only while they can
--           read the trip; size <= 1 MiB and jpeg/webp when metadata is
--           present (the bucket limits are the primary enforcement:
--           storage-api checks permission before metadata exists).
--   DELETE  the author's own folder (while a member) or the trip owner.
--           NOTE: Postgres applies the SELECT policy to DELETE too, so the
--           owner can only remove objects it can currently see. Owner
--           moderation order: delete the two objects, THEN call
--           remove_trip_memory('photo', id). The author can always remove
--           their own objects (tombstoned or orphaned).
--   UPDATE  none: objects are immutable (upload with upsert: false).
do $objpolicies$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    raise notice 'storage.objects not found: skipping trip-memories object policies.';
    return;
  end if;

  drop policy if exists "trip_memories_select" on storage.objects;
  create policy "trip_memories_select"
    on storage.objects for select
    to authenticated
    using (
      bucket_id = 'trip-memories'
      and (
        exists (
          select 1 from public.trip_photos p
           where p.id = public.trip_memory_photo_id(objects.name)
             and (p.storage_path = objects.name or p.thumb_path = objects.name)
        )
        or (
          split_part(objects.name, '/', 2) = auth.uid()::text
          and public.user_can_access_trip(public.storage_path_trip_id(objects.name), auth.uid(), 'viewer')
        )
      )
    );

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
            when objects.metadata->>'size' is null then true
            when objects.metadata->>'size' ~ '^[0-9]{1,12}$' then (objects.metadata->>'size')::bigint <= 1048576
            else false
          end
      and (objects.metadata->>'mimetype' is null
           or objects.metadata->>'mimetype' in ('image/jpeg', 'image/webp'))
    );

  drop policy if exists "trip_memories_delete" on storage.objects;
  create policy "trip_memories_delete"
    on storage.objects for delete
    to authenticated
    using (
      bucket_id = 'trip-memories'
      and (
        (
          split_part(objects.name, '/', 2) = auth.uid()::text
          and public.user_can_access_trip(public.storage_path_trip_id(objects.name), auth.uid(), 'viewer')
        )
        or exists (
          select 1 from public.trips t
           where t.id = public.storage_path_trip_id(objects.name)
             and t.user_id = auth.uid()
        )
      )
    );

  raise notice 'storage.objects policies for trip-memories created (select / author insert / author-or-owner delete; no update by design).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to manage storage.objects policies: re-run section 6 of 0036_v2_m5_memories.sql from the Dashboard SQL editor.';
end
$objpolicies$;

-- ============================================================
-- 7. Realtime publication
-- ============================================================
-- Realtime re-checks each subscriber's SELECT policies before delivering a
-- change, so an only_me row is only ever pushed to its author.
do $realtime$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication "supabase_realtime" not found: skipping realtime wiring.';
    return;
  end if;

  foreach tbl in array array['trip_journal_entries', 'trip_place_reviews', 'trip_photos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
      raise notice 'added public.% to supabase_realtime publication', tbl;
    end if;
  end loop;
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to alter publication "supabase_realtime": add the memory tables via Dashboard -> Database -> Replication.';
end
$realtime$;

-- ============================================================
-- 8. Purge photo rows stuck in `pending`
-- ============================================================
-- A row that never reached `ready` (app killed mid-upload, device lost)
-- would hold a quota slot forever. Keyed on updated_at (server-stamped;
-- created_at is client-suppliable). Objects a half-finished upload left
-- behind are unreachable (the storage SELECT policy needs the row) and are
-- swept by delete-trip / delete-account; they still count toward the
-- storage guard (accepted, ADR-0014 debt).
create or replace function public.purge_stale_pending_photos(p_older_than interval default interval '24 hours')
returns integer
language sql
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from public.trip_photos
     where status = 'pending'
       and updated_at < now() - p_older_than
    returning 1
  )
  select count(*)::integer from gone;
$$;

comment on function public.purge_stale_pending_photos(interval) is
  'M5 Y1.2: hard-deletes trip_photos rows still pending after p_older_than (default 24 h, by server-stamped updated_at). Scheduled hourly by pg_cron (tripvisor-trip-photos-pending-purge). service_role / postgres only.';

do $cronjobs$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: tripvisor-trip-photos-pending-purge NOT scheduled. Re-run this block after enabling the extension.';
    return;
  end if;
  perform cron.schedule(
    'tripvisor-trip-photos-pending-purge',
    '35 * * * *',
    $job$ select public.purge_stale_pending_photos() $job$
  );
  raise notice 'pg_cron job scheduled: tripvisor-trip-photos-pending-purge (hourly at :35 UTC).';
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to schedule pg_cron jobs: schedule tripvisor-trip-photos-pending-purge from the Dashboard.';
end
$cronjobs$;

-- ============================================================
-- 9. EXECUTE matrix (0031 posture)
-- ============================================================
--   function                                  anon  authenticated                 service_role
--   trip_memory_photo_id(text)                -     X storage policies            X
--   trip_photo_object_sizes(text,text)        -     X guard (own folder only)     X
--   memory_quota_limits()                     -     X (app_config is public)      X
--   get_memory_quota(uuid)                    -     X Profile / pre-upload        X
--   remove_trip_memory(text,uuid)             -     X author / owner moderation   X
--   purge_stale_pending_photos(interval)      -     -                             X (+ cron as postgres)
--   trigger fns (guard, supersede, quota)     -     - (triggers need no EXECUTE)  -
revoke all on function public.trip_memory_photo_id(text)               from public, anon;
revoke all on function public.trip_photo_object_sizes(text, text)      from public, anon;
revoke all on function public.memory_quota_limits()                    from public, anon;
revoke all on function public.get_memory_quota(uuid)                   from public, anon;
revoke all on function public.remove_trip_memory(text, uuid)           from public, anon;
revoke all on function public.purge_stale_pending_photos(interval)     from public, anon, authenticated;
revoke all on function public.trip_memories_guard()                    from public, anon, authenticated;
revoke all on function public.trip_place_reviews_supersede()           from public, anon, authenticated;
revoke all on function public.trip_photos_enforce_quota()              from public, anon, authenticated;

grant execute on function public.trip_memory_photo_id(text)            to authenticated, service_role;
grant execute on function public.trip_photo_object_sizes(text, text)   to authenticated, service_role;
grant execute on function public.memory_quota_limits()                 to authenticated, service_role;
grant execute on function public.get_memory_quota(uuid)                to authenticated, service_role;
grant execute on function public.remove_trip_memory(text, uuid)        to authenticated, service_role;
grant execute on function public.purge_stale_pending_photos(interval)  to service_role;
