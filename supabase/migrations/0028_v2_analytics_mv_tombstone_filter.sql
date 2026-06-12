-- Tripvisor v2 Phase S2.8 — analytics MV tombstone hygiene (Wave-A residual,
-- flagged by the S2.8.1 sweep; BUILD-LOG S2.8.11 companion).
--
-- WHY: 0027 added soft-delete tombstones (`deleted boolean not null default
-- false`) to the Tier-1 synced roots, and S2.8 makes `deleted = true` the
-- NORMAL delete path for trip_places once the flag flips. The 0019
-- `analytics_user_trip_stats` materialized view predates that: its
-- place_counts CTE would keep counting tombstoned places, and its
-- reaction_counts CTE would keep counting (a) reactions whose parent place
-- is tombstoned and (b) tombstoned reactions themselves — "deleted" places
-- silently inflating every user's analytics within ~24h of the flip.
--
-- WHAT: drop + recreate the MV with `deleted = false` filters on the
-- place_counts and reaction_counts CTEs, mirroring the client's S2.8.1 join
-- filter (src/api/trip-place-reactions.ts: `.eq('trip_places.deleted',
-- false)` on the !inner join). COLUMN SHAPE IS UNCHANGED — get_my_trip_stats()
-- returns `setof public.analytics_user_trip_stats` and the client's
-- TripStatsRow (src/api/trip-stats.ts) matches it field-for-field; do not
-- add/remove/reorder columns here without versioning that contract.
--
-- expense_totals is DELIBERATELY left unfiltered: trip_expenses.deleted
-- exists (0027) but nothing writes `true` yet — expenses are outside the
-- S2.4 write slice, their delete path still hard-DELETEs, and the analytics
-- screen's live fallback aggregates them unfiltered. Flip BOTH (this CTE +
-- the client fallback) together in the wave that tombstones expense deletes.
--
-- MECHANICS: `drop materialized view` loses the unique index, the comments,
-- the privilege REVOKE, and (via the rowtype dependency) get_my_trip_stats()
-- — every one of them is recreated below exactly per 0019 §3. The function
-- is dropped FIRST (its return type depends on the MV; a bare DROP of the MV
-- would otherwise fail). The 0019 §4a pg_cron refresh job is NOT touched: it
-- references the MV by name in SQL text, which re-resolves at run time.
--
-- Rollback
-- --------
--   Re-run 0019 §3 verbatim after:
--     drop function if exists public.get_my_trip_stats();
--     drop materialized view if exists public.analytics_user_trip_stats;
--   (The cron job needs no change in either direction.)

-- ============================================================
-- 1. Drop dependent function, then the MV
-- ============================================================

drop function if exists public.get_my_trip_stats();
drop materialized view if exists public.analytics_user_trip_stats;

-- ============================================================
-- 2. Recreate the MV — identical columns, tombstone-filtered CTEs
-- ============================================================
--
-- Filter form: bare `deleted = false` is exact — every `deleted` column
-- involved is `boolean NOT NULL DEFAULT false` (trip_places: 0027 §3;
-- trip_place_reactions: 0027 §3), so no NULL handling is needed.

create materialized view public.analytics_user_trip_stats as
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
  -- DELIBERATELY no `deleted` filter — see header (expense deletes still
  -- hard-DELETE; flip together with the client's live fallback).
  select
    te.trip_id,
    coalesce(sum(te.amount) filter (where te.kind = 'actual'),    0) as total_actual_spend,
    coalesce(sum(te.amount) filter (where te.kind = 'estimated'), 0) as total_estimated_spend
  from public.trip_expenses te
  group by te.trip_id
),
place_counts as (
  -- S2.8: tombstoned places are deleted-for-users — never count them.
  select tp.trip_id, count(*) as place_count
  from public.trip_places tp
  where tp.deleted = false
  group by tp.trip_id
),
reaction_counts as (
  -- Per (trip, reacting user): join through trip_places to find the trip.
  -- S2.8 tombstone hygiene, BOTH sides of the join (mirrors the client's
  -- S2.8.1 `.eq('trip_places.deleted', false)` !inner-join filter):
  --   - r.deleted  — a cleared reaction must stop counting the moment the
  --     clear path becomes a tombstone (0027 comment on the column),
  --   - tp.deleted — tombstoning a place does NOT cascade to its reactions,
  --     so without this a deleted place would keep resurfacing through its
  --     companions' likes.
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
  coalesce(pc.place_count,    0)::int as place_count
from user_trips ut
left join expense_totals  et on et.trip_id = ut.trip_id
left join place_counts    pc on pc.trip_id = ut.trip_id
left join reaction_counts rc on rc.trip_id = ut.trip_id
                            and rc.user_id = ut.user_id;

comment on materialized view public.analytics_user_trip_stats is
  'v2 N2.3 (tombstone-filtered in 0028): per-(user, trip) analytics rollup — trip-level spend totals + place count, personal liked/disliked counts. place_counts/reaction_counts exclude deleted = true tombstones (0027 soft deletes); expense_totals deliberately unfiltered until expense deletes tombstone. User dimension = owner UNION accepted collaborators (mirrors useTrips()). NO RLS possible on MVs: SELECT is revoked from anon/authenticated; clients read ONLY via get_my_trip_stats(). Refreshed nightly by pg_cron (concurrently — see the unique index).';

-- ============================================================
-- 3. Restore everything the DROP lost (0019 §3 verbatim)
-- ============================================================

-- Unique index: REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (which
-- the nightly job uses so refreshes never block readers). (user_id, trip_id)
-- is unique by construction (user_trips dedupes; the other CTEs are grouped)
-- and its user_id prefix also serves get_my_trip_stats()'s filter.
create unique index if not exists analytics_user_trip_stats_user_trip_idx
  on public.analytics_user_trip_stats (user_id, trip_id);

-- Lock the MV down (0019 SECURITY note: MVs cannot carry RLS, and Supabase's
-- default privileges re-granted SELECT to anon + authenticated on the
-- freshly-created relation — the explicit REVOKE is load-bearing, not
-- belt-and-braces). service_role keeps access via its default grant — it is
-- trusted and server-side only.
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
