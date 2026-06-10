-- Tripvisor v2 Phase N2 — backend adoption (BUILD-LOG N2.1 / N2.3 / N2.6).
--
-- One migration, four clearly-separated sections:
--
--   1. `trip_place_comments`        — per-author, per-place comment threads (N2.6)
--   2. Realtime publication wiring  — add synced tables to supabase_realtime (N2.1)
--   3. `analytics_user_trip_stats`  — materialized view + security-definer reader (N2.3)
--   4. pg_cron nightly jobs         — MV refresh + trip_legs 30-day ToS purge (N2.3)
--
-- Defensive-by-design: this migration must apply cleanly on BOTH the hosted
-- project (postgres role, realtime + pg_cron available) and a bare local
-- stack (where the publication or the cron extension may be missing). Every
-- environment-dependent statement is wrapped in a DO block that degrades to
-- a NOTICE instead of failing the migration.
--
-- Rollback
-- --------
--   select cron.unschedule('tripvisor-analytics-mv-refresh-nightly');
--   select cron.unschedule('tripvisor-trip-legs-ttl-purge-nightly');
--   drop function if exists public.get_my_trip_stats();
--   drop materialized view if exists public.analytics_user_trip_stats;
--   -- For each table added in section 2 (guard with the same existence check):
--   --   alter publication supabase_realtime drop table public.<table>;
--   drop trigger if exists trip_place_comments_set_updated_at on public.trip_place_comments;
--   drop table if exists public.trip_place_comments;

-- ============================================================
-- 1. trip_place_comments (BUILD-LOG N2.6)
-- ============================================================
--
-- Why this table exists (v2 panel decision, docs/v2/architecture.md)
-- ------------------------------------------------------------------
-- The core loop's "comments" leg: collaborators discuss each candidate place
-- ("too touristy", "book tickets ahead") before/while routing. v1's single
-- shared `trip_places.notes` field would let collaborators silently
-- overwrite each other under the v2 sync engine's last-write-wins merge.
-- Comments fix that BY CONSTRUCTION:
--
--   - Each comment is a separate per-author row. Two collaborators typing at
--     once produce two INSERTs of two distinct rows — there is no shared
--     cell for LWW to clobber, so the design is append-only/conflict-free.
--   - Edits and deletes touch only the author's own row (author-only RLS),
--     so concurrent writers can never race on the same row either.
--   - Delete is a SOFT delete (`deleted = true`) as the normal path: a
--     tombstone row syncs cleanly through offline replicas (a hard DELETE
--     has no row left to carry the fact of deletion through an LWW merge).
--
-- ToS note: comments are pure USER content (Tier-1 durable per
-- docs/v2/conventions.md). No Google Places data lives here, so the 30-day
-- Google retention ceiling does not apply.
--
-- `trip_id` is intentionally denormalized from trip_places: it lets RLS gate
-- on the parent trip without a join, gives the per-trip badge-count query a
-- direct index, and follows the project rule "always scope via the parent".
-- Consistency between trip_id and trip_place_id is enforced in the
-- INSERT/UPDATE policies (see 1d below) — a CHECK constraint can't reference
-- another table.

create table if not exists public.trip_place_comments (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  trip_place_id   uuid not null references public.trip_places(id) on delete cascade,
  author_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now(),
  -- Nullable, NO default: stays NULL until the first edit. The
  -- set_updated_at trigger (0001) stamps it on UPDATE, which gives the UI a
  -- free "edited" indicator (updated_at IS NOT NULL).
  updated_at      timestamptz,
  deleted         boolean not null default false
);

comment on table public.trip_place_comments is
  'v2 N2.6: per-author comments on a trip place (the core loop''s group-voice feature). Append-only/LWW-safe by construction (panel decision): every comment is its own per-author row, so concurrent collaborators INSERT distinct rows instead of racing on a shared field like v1''s trip_places.notes; edits/deletes are author-only. Normal delete path is the soft tombstone deleted=true (sync-safe through offline LWW merges); hard DELETE exists only as the author''s escape hatch. Pure user content — no Google data, so the 30-day ToS ceiling does not apply.';

comment on column public.trip_place_comments.trip_id is
  'Denormalized parent trip (= trip_places.trip_id). Lets RLS + the per-trip badge query avoid a join. INSERT/UPDATE policies enforce consistency with trip_place_id.';

comment on column public.trip_place_comments.updated_at is
  'NULL until first edit; stamped by the set_updated_at trigger on UPDATE. Doubles as the "edited" badge signal.';

comment on column public.trip_place_comments.deleted is
  'Soft-delete tombstone — the NORMAL delete path (client sets deleted=true). Reads exclude deleted rows; the tombstone survives so offline LWW sync replicas converge on the deletion.';

-- 1a. Indexes ---------------------------------------------------------------

-- Per-place thread read: WHERE trip_place_id = $1 ORDER BY created_at — the
-- composite index serves both the filter and the sort.
create index if not exists trip_place_comments_place_created_idx
  on public.trip_place_comments (trip_place_id, created_at);

-- Per-trip batch read (comment-count badges across the whole itinerary in
-- one query instead of N per-place queries) + RLS predicate support.
create index if not exists trip_place_comments_trip_idx
  on public.trip_place_comments (trip_id);

-- 1b. updated_at trigger (reuses public.set_updated_at from 0001_init.sql) --
drop trigger if exists trip_place_comments_set_updated_at on public.trip_place_comments;
create trigger trip_place_comments_set_updated_at
  before update on public.trip_place_comments
  for each row execute function public.set_updated_at();

-- 1c. RLS — viewer-gated reads + comment writes, author-only edit/delete ----
alter table public.trip_place_comments enable row level security;

-- SELECT: anyone with at least VIEWER access to the parent trip reads the
-- whole thread. Delegates to user_can_access_trip (0011, security definer —
-- no policy recursion). Soft-deleted rows are still SELECTable; clients
-- filter `deleted = false` (the tombstone must replicate to sync engines).
drop policy if exists "trip_place_comments_collab_select" on public.trip_place_comments;
create policy "trip_place_comments_collab_select"
  on public.trip_place_comments for select
  to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

-- INSERT: VIEWER access suffices — commenting is the group-voice feature,
-- and read-only collaborators are exactly the audience whose opinion we
-- want (same rationale as trip_place_reactions in 0017). Three predicates:
--   1. author_id pinned to the caller (no impersonation),
--   2. viewer-or-better access to the trip,
--   3. trip_place actually belongs to the claimed trip — without this, an
--      editor of trip A could attach a comment to a place of trip B, or
--      claim a foreign trip_id and inject rows into another trip's thread
--      list. The EXISTS runs under the caller's own RLS on trip_places,
--      which is viewer-gated, so it can only confirm places the caller can
--      already see.
drop policy if exists "trip_place_comments_author_insert" on public.trip_place_comments;
create policy "trip_place_comments_author_insert"
  on public.trip_place_comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_comments.trip_place_id
        and tp.trip_id = trip_place_comments.trip_id
    )
  );

-- UPDATE: author-only (USING pins the row to its author). The normal update
-- is `set deleted = true` (soft delete) or editing `body`. WITH CHECK
-- re-asserts the same three invariants as INSERT so an author cannot
-- "re-parent" their comment into a trip/place they no longer (or never)
-- had access to — RLS cannot compare OLD vs NEW, so re-checking the
-- post-state is the only way to close that hole. Side effect (accepted +
-- intentional): an author whose collaboration was revoked can no longer
-- edit or soft-delete their old comments; account deletion still cascades
-- them away via the author_id FK.
drop policy if exists "trip_place_comments_author_update" on public.trip_place_comments;
create policy "trip_place_comments_author_update"
  on public.trip_place_comments for update
  to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_comments.trip_place_id
        and tp.trip_id = trip_place_comments.trip_id
    )
  );

-- DELETE: author-only hard delete. Kept for completeness (e.g. purging a
-- regretted comment outright); the product path is the soft delete above
-- because hard deletes leave no tombstone for offline sync to converge on.
-- The trip owner deliberately CANNOT delete someone else's comment — same
-- stance as reactions (0017): personal voice, not an owner-curated artefact.
-- Moderation, if ever needed, becomes a service-role Edge Function.
drop policy if exists "trip_place_comments_author_delete" on public.trip_place_comments;
create policy "trip_place_comments_author_delete"
  on public.trip_place_comments for delete
  to authenticated
  using (author_id = auth.uid());

-- ============================================================
-- 2. Realtime publication wiring (BUILD-LOG N2.1)
-- ============================================================
--
-- Adds the v2 synced tables to the `supabase_realtime` publication so the
-- upcoming sync engine (Legend-State + syncedSupabase, src/sync/) and any
-- postgres_changes subscriber receive change events. Authorization is NOT
-- weakened by this: Supabase Realtime checks the subscriber's RLS SELECT
-- policies before delivering postgres_changes rows.
--
-- Deliberately NOT published: `trips` (low-churn; list refetch is fine for
-- now) and `trip_place_reactions` (toggle UX is already optimistic;
-- publish later if live reactions are wanted post-GA).
--
-- Idempotent + environment-tolerant: each table is checked against
-- pg_publication_tables before ALTER (re-runs no-op), and a missing
-- publication (bare local Postgres without the realtime stack) downgrades
-- to a NOTICE instead of an error.
do $realtime$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication "supabase_realtime" not found — skipping realtime wiring (expected on bare local stacks; hosted Supabase always has it).';
    return;
  end if;

  foreach tbl in array array[
    'trip_places',
    'trip_days',
    'trip_legs',
    'trip_expenses',
    'trip_accommodations',
    'trip_place_comments'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname    = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
      raise notice 'added public.% to supabase_realtime publication', tbl;
    end if;
  end loop;
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to alter publication "supabase_realtime" — add the tables via Dashboard -> Database -> Replication instead.';
end
$realtime$;

-- ============================================================
-- 3. Analytics materialized view (BUILD-LOG N2.3, folded from old P13.1)
-- ============================================================
--
-- Server-side aggregation for the analytics screen, replacing the client's
-- interim "useQueries over every trip" fan-out (0.5c). One row per
-- (user, trip) where the user dimension is the trip owner UNION every
-- ACCEPTED collaborator — this mirrors the `useTrips()` owner∪shared UNION
-- the analytics screen iterates today, so collaborators keep seeing shared
-- trips in their stats when P3.2 wires this in.
--
--   - total_actual_spend / total_estimated_spend / place_count are
--     trip-level facts (trip_expenses has no per-user dimension),
--     denormalized onto each user's row.
--   - liked_count / disliked_count are PERSONAL: that user's own reactions
--     on that trip's places (matches useAllUserReactions semantics).
--
-- SECURITY — read this before touching grants
-- --------------------------------------------
-- Materialized views do NOT support RLS, and the MV is refreshed by its
-- owner (postgres), so it materializes EVERY user's rows. Supabase's
-- default privileges grant SELECT on new public relations to anon +
-- authenticated, so we must EXPLICITLY REVOKE here — absence of a GRANT is
-- not enough. The ONLY client read path is the security-definer function
-- `get_my_trip_stats()` below, which filters to auth.uid(). Every value a
-- row exposes is data that user can already read live under RLS (expenses/
-- places via viewer access; reactions are their own), so the function
-- leaks nothing — it only pre-aggregates.
--
-- Staleness contract: refreshed nightly (section 4). Acceptable for an
-- analytics surface; P3.2 pairs it with a live same-day fallback. Note a
-- revoked collaborator may see a stale shared-trip row for up to ~24h —
-- analytics only, never an authorization surface.

create materialized view if not exists public.analytics_user_trip_stats as
with user_trips as (
  -- Owner rows…
  select t.user_id, t.id as trip_id
  from public.trips t
  union
  -- …plus accepted, bound collaborators. UNION (not UNION ALL) dedupes the
  -- degenerate "owner also appears as collaborator" case defensively.
  select c.user_id, c.trip_id
  from public.trip_collaborators c
  where c.status = 'accepted'
    and c.user_id is not null
),
expense_totals as (
  select
    te.trip_id,
    coalesce(sum(te.amount) filter (where te.kind = 'actual'),    0) as total_actual_spend,
    coalesce(sum(te.amount) filter (where te.kind = 'estimated'), 0) as total_estimated_spend
  from public.trip_expenses te
  group by te.trip_id
),
place_counts as (
  select tp.trip_id, count(*) as place_count
  from public.trip_places tp
  group by tp.trip_id
),
reaction_counts as (
  -- Per (trip, reacting user): join through trip_places to find the trip.
  select
    tp.trip_id,
    r.user_id,
    count(*) filter (where r.reaction = 'liked')    as liked_count,
    count(*) filter (where r.reaction = 'disliked') as disliked_count
  from public.trip_place_reactions r
  join public.trip_places tp on tp.id = r.trip_place_id
  group by tp.trip_id, r.user_id
)
select
  ut.user_id,
  ut.trip_id,
  coalesce(et.total_actual_spend,    0)::numeric as total_actual_spend,
  coalesce(et.total_estimated_spend, 0)::numeric as total_estimated_spend,
  coalesce(rc.liked_count,    0)::int as liked_count,
  coalesce(rc.disliked_count, 0)::int as disliked_count,
  coalesce(pc.place_count,    0)::int as place_count
from user_trips ut
left join expense_totals  et on et.trip_id = ut.trip_id
left join place_counts    pc on pc.trip_id = ut.trip_id
left join reaction_counts rc on rc.trip_id = ut.trip_id
                            and rc.user_id = ut.user_id;

comment on materialized view public.analytics_user_trip_stats is
  'v2 N2.3: per-(user, trip) analytics rollup — trip-level spend totals + place count, personal liked/disliked counts. User dimension = owner UNION accepted collaborators (mirrors useTrips()). NO RLS possible on MVs: SELECT is revoked from anon/authenticated; clients read ONLY via get_my_trip_stats(). Refreshed nightly by pg_cron (concurrently — see the unique index).';

-- Unique index: REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (which
-- the nightly job uses so refreshes never block readers). (user_id, trip_id)
-- is unique by construction (user_trips dedupes; the other CTEs are grouped)
-- and its user_id prefix also serves get_my_trip_stats()'s filter.
create unique index if not exists analytics_user_trip_stats_user_trip_idx
  on public.analytics_user_trip_stats (user_id, trip_id);

-- Lock the MV down (see SECURITY note above). service_role keeps access via
-- its default grant — it is trusted and server-side only.
revoke all on public.analytics_user_trip_stats from anon, authenticated;

-- The single sanctioned read path. SECURITY DEFINER so it can read the
-- revoked MV; the WHERE pins the result to the caller. STABLE + pinned
-- search_path per the 0011 helper conventions (auth.uid() is written
-- schema-qualified because the pinned search_path excludes `auth`).
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
  'v2 N2.3: the ONLY client read path for analytics_user_trip_stats (the MV itself is revoked — MVs cannot carry RLS). SECURITY DEFINER + WHERE user_id = auth.uid(). Returns one row per trip the caller owns or collaborates on (nightly-refreshed; pair with a live same-day fallback, P3.2). Call via supabase.rpc(''get_my_trip_stats'').';

-- Functions are EXECUTE-able by PUBLIC by default (plus Supabase default
-- grants) — pin to authenticated only.
revoke all on function public.get_my_trip_stats() from public, anon;
grant execute on function public.get_my_trip_stats() to authenticated;

-- ============================================================
-- 4. pg_cron nightly jobs (BUILD-LOG N2.3)
-- ============================================================
--
-- Two scheduled jobs, ~04:00 UTC (staggered 15 min so the MV refresh and
-- the purge never contend):
--
--   04:00 — refresh materialized view concurrently analytics_user_trip_stats
--   04:15 — delete trip_legs older than 30 days (Google ToS retention TTL)
--
-- NOTE: external keep-alive is deliberately NOT a pg_cron job — a paused
-- project's cron can't unpause itself (panel decision D6). That lives in
-- .github/workflows/keepalive.yml.
--
-- Extension creation is guarded: on local dev (or a role without the
-- privilege / a build without the .so preloaded) we NOTICE and continue —
-- the jobs section below independently checks pg_cron actually exists.

do $ext_cron$
begin
  create extension if not exists pg_cron;
exception
  when insufficient_privilege then
    raise notice 'pg_cron: insufficient privilege to create extension — enable it via Dashboard -> Database -> Extensions, then re-run this migration (or just section 4).';
  when undefined_file then
    raise notice 'pg_cron: extension not available on this server (expected on some local stacks) — skipping.';
  when object_not_in_prerequisite_state then
    raise notice 'pg_cron: not in shared_preload_libraries on this server — skipping.';
end
$ext_cron$;

-- pg_net: not used by these two jobs (both are pure SQL), but enabled now —
-- guarded — because near-term cron work (weather prefetch, P2; webhook-style
-- fan-out) calls HTTP from the database via net.http_get/post.
do $ext_net$
begin
  create extension if not exists pg_net;
exception
  when insufficient_privilege then
    raise notice 'pg_net: insufficient privilege to create extension — enable it via Dashboard -> Database -> Extensions if/when cron jobs need HTTP.';
  when undefined_file then
    raise notice 'pg_net: extension not available on this server (expected on some local stacks) — skipping.';
  when object_not_in_prerequisite_state then
    raise notice 'pg_net: not in shared_preload_libraries on this server — skipping.';
end
$ext_net$;

do $cronjobs$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — nightly jobs NOT scheduled. After enabling the extension, re-run this migration (cron.schedule upserts by job name, so re-runs are safe).';
    return;
  end if;

  -- 4a. Nightly MV refresh. CONCURRENTLY so readers (get_my_trip_stats)
  -- are never blocked; requires the unique index created in section 3.
  -- cron.schedule(name, ...) upserts by name — re-running this migration
  -- updates rather than duplicates the job. pg_cron runs on UTC.
  perform cron.schedule(
    'tripvisor-analytics-mv-refresh-nightly',
    '0 4 * * *',
    $job$ refresh materialized view concurrently public.analytics_user_trip_stats $job$
  );

  -- 4b. Nightly trip_legs TTL purge — the Google ToS 30-day ceiling on
  -- cached Distance Matrix / Routes results (only google_place_id + coords
  -- are durable beyond that; legs carry durations/polylines so they MUST
  -- age out). This job runs as postgres (the scheduling role), which owns
  -- the table and therefore BYPASSES RLS — deliberate: the purge must span
  -- every user's rows. Clients must treat purged legs as gone and re-fetch
  -- via the Edge Functions; NEVER re-add a purged leg from a client-side
  -- cache (risk R4: an offline LWW replica resurrecting ToS-expired
  -- polylines — legs are server-authoritative per C1).
  perform cron.schedule(
    'tripvisor-trip-legs-ttl-purge-nightly',
    '15 4 * * *',
    $job$ delete from public.trip_legs where computed_at < now() - interval '30 days' $job$
  );

  raise notice 'pg_cron jobs scheduled: tripvisor-analytics-mv-refresh-nightly (04:00 UTC), tripvisor-trip-legs-ttl-purge-nightly (04:15 UTC).';
end
$cronjobs$;
