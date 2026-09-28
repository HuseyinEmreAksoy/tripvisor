-- Tripvisor M4 X2.5 — analytics MV: tombstone-filter expense_totals.
--
-- WHY: X2.5 makes trip_expenses Tier-1 WRITABLE, and its delete path becomes
-- a soft-delete tombstone (`deleted = true`, 0027) instead of a hard DELETE.
-- 0028 deliberately left the MV's expense_totals CTE unfiltered and asked
-- that it be flipped TOGETHER with the client's live fallback in the wave
-- that tombstones expense deletes — this is that wave. Without it a deleted
-- expense would keep inflating analytics spend totals after the nightly
-- refresh. The client half ships alongside: src/api/trip-expenses.ts
-- useAllUserExpenses filters deleted = false in both of its branches.
--
-- WHAT: 0028 verbatim, plus `where te.deleted = false` in expense_totals.
-- COLUMN SHAPE IS UNCHANGED (get_my_trip_stats() / TripStatsRow contract in
-- src/api/trip-stats.ts). trip_expenses.deleted is boolean NOT NULL DEFAULT
-- false (0027 §3), so no NULL handling is needed.
--
-- Additive in effect (a filter on a derived view; no table/column change).
-- MECHANICS are 0028's: drop the dependent function first, then the MV, then
-- recreate MV + unique index + REVOKE + function + grants. The 0019 §4a
-- pg_cron refresh job references the MV by name and needs no change.
--
-- Rollback (inverse)
-- ------------------
--   Re-run 0028 §1–§3 verbatim (drops + recreates the MV with the unfiltered
--   expense_totals CTE and restores the function + grants).

-- ============================================================
-- 1. Drop dependent function, then the MV
-- ============================================================

drop function if exists public.get_my_trip_stats();
drop materialized view if exists public.analytics_user_trip_stats;

-- ============================================================
-- 2. Recreate the MV — identical columns, tombstone-filtered CTEs
-- ============================================================

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
  -- 0029 (M4 X2.5): expense deletes now TOMBSTONE — never count them.
  -- Lockstep with the client's live fallback (useAllUserExpenses).
  select
    te.trip_id,
    coalesce(sum(te.amount) filter (where te.kind = 'actual'),    0) as total_actual_spend,
    coalesce(sum(te.amount) filter (where te.kind = 'estimated'), 0) as total_estimated_spend
  from public.trip_expenses te
  where te.deleted = false
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
  -- S2.8 tombstone hygiene on BOTH sides of the join (see 0028).
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
  'v2 N2.3 (tombstone-filtered in 0028 + 0029): per-(user, trip) analytics rollup — trip-level spend totals + place count, personal liked/disliked counts. expense_totals/place_counts/reaction_counts all exclude deleted = true tombstones (0027 soft deletes). User dimension = owner UNION accepted collaborators (mirrors useTrips()). NO RLS possible on MVs: SELECT is revoked from anon/authenticated; clients read ONLY via get_my_trip_stats(). Refreshed nightly by pg_cron (concurrently — see the unique index).';

-- ============================================================
-- 3. Restore everything the DROP lost (0019 §3 / 0028 §3 verbatim)
-- ============================================================

create unique index if not exists analytics_user_trip_stats_user_trip_idx
  on public.analytics_user_trip_stats (user_id, trip_id);

-- MVs cannot carry RLS and Supabase default privileges re-grant SELECT on
-- the freshly-created relation — this REVOKE is load-bearing.
revoke all on public.analytics_user_trip_stats from anon, authenticated;

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

revoke all on function public.get_my_trip_stats() from public, anon;
grant execute on function public.get_my_trip_stats() to authenticated;
