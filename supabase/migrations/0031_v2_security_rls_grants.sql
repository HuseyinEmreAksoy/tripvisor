-- Tripvisor v2: security hardening from the 2026-09-29 audit (RLS + grants + atomic AI quota).
--
-- Fixes (audit ids; each one was reproduced on the local DB before this migration,
-- and supabase/tests/security_0031.sql replays every exploit and asserts it now fails):
--
--   #1  [critical] trip_collaborators self-escalation. The 0011 invitee UPDATE
--       policy's WITH CHECK pinned only user_id/status. So an attacker could
--       (a) INSERT an editor row on their own trip, then UPDATE its trip_id to a
--       victim trip, and (b) re-accept a revoked row as an editor. The client only
--       READS this table (src/api/trips.ts, src/api/trip-collaborators.ts); every
--       write goes through the manage-collaborators Edge Function with the
--       service-role client (invite/accept/decline/revoke/update-role all use
--       `admin`). Fix: drop every client write policy and revoke the write
--       privileges. The SELECT policy is unchanged.
--   #7  [medium] Supabase's default privileges give anon/authenticated EXECUTE on
--       every public function, and `revoke ... from public` does not remove those
--       explicit grants. So anon could call claim_trip_optimize and grief any trip's
--       optimize mutex. Fix: an explicit per-function EXECUTE matrix (§4) and
--       closed default privileges for future functions (§6).
--   #10 [low] trip_place_reactions self UPDATE/DELETE was keyed only on user_id.
--       A user could move their reaction onto a place in a trip they cannot see,
--       and a revoked collaborator could keep mutating rows. Fix: USING and WITH
--       CHECK also require viewer access to the parent place's trip.
--       trip_place_comments had the same gap on its UPDATE USING and DELETE, and
--       is fixed the same way (the only other self-owned child table with
--       UPDATE/DELETE policies).
--   #11 [low] user_can_access_trip(trip, user, role) answered for ANY user id, so
--       an authenticated caller could ask "can user X access trip Y?" (an
--       oracle). Fix: it now answers only for p_user_id = auth.uid(), or for the
--       service role. Every RLS policy passes auth.uid(), so policy behavior is
--       unchanged. No Edge Function calls it over RPC.
--   #8  [medium] AI quota race. ai-itinerary/ai-edit did read, then check, then
--       call the LLM, then increment. N concurrent requests at 9/10 all passed.
--       Fix: consume_ai_quota() is an atomic check-and-reserve done BEFORE any
--       upstream spend, plus a negative-safe refund_ai_quota() for unused
--       grounding reservations. Both are service_role only. increment_ai_usage()
--       stays for post-hoc spend (grounding details calls after an LLM run).
--
-- Inverse (local only; each block restores the pre-0031 state):
--   §1  recreate trip_collaborators_owner_insert / _owner_update / _invitee_update /
--       _owner_delete from 0011 §4b-4d, then
--       grant insert, update, delete, truncate on public.trip_collaborators to anon, authenticated;
--       grant select on public.trip_collaborators to anon;
--   §2  re-run the 0011 §2 `create or replace function public.user_can_access_trip` block.
--   §3  recreate trip_place_reactions_self_update/_self_delete (0017) and
--       trip_place_comments_author_update/_author_delete (0019) with their old USING.
--   §4  grant execute on function <each fn> to public, anon;  (and to authenticated
--       for claim_trip_optimize / release_trip_optimize, matching the pre-0031 ACL)
--   §5  drop function if exists public.consume_ai_quota(uuid, int, int, int, int);
--       drop function if exists public.refund_ai_quota(uuid, int, int, date);
--       alter table public.ai_usage drop constraint if exists ai_usage_counters_nonnegative;
--   §6  alter default privileges for role postgres in schema public grant execute on functions to anon;
--       alter default privileges for role postgres grant execute on functions to public;
--
-- Deploy order (cloud): `npx supabase db push` FIRST, then redeploy ai-itinerary
-- and ai-edit. The new function code calls consume_ai_quota and fails closed
-- (500 db_error) if the RPC is missing.

-- ============================================================
-- §1. trip_collaborators: writes are Edge-Function-only (#1)
-- ============================================================
-- manage-collaborators performs every INSERT/UPDATE with makeAdminClient()
-- (service_role bypasses RLS and keeps its own table grants). It uses the user
-- JWT only to prove ownership (a SELECT on trips) and for `list` (a SELECT on
-- this table, still served by trip_collaborators_select). The client never
-- deletes rows (revoke is a soft status flip done by the function), so the
-- owner DELETE policy goes too. Trip deletion still cascades: FK actions run
-- as the table owner, not the caller.
drop policy if exists "trip_collaborators_invitee_update" on public.trip_collaborators;
drop policy if exists "trip_collaborators_owner_update"   on public.trip_collaborators;
drop policy if exists "trip_collaborators_owner_insert"   on public.trip_collaborators;
drop policy if exists "trip_collaborators_owner_delete"   on public.trip_collaborators;

revoke insert, update, delete, truncate on public.trip_collaborators from anon, authenticated;
-- anon has no SELECT policy either; remove the dead table grant as well.
revoke select on public.trip_collaborators from anon;

comment on table public.trip_collaborators is
  'Phase 21: trip collaboration. Owner invites by email, invitee accepts via tokenized link to bind user_id and flip status to accepted. Viewer = read-only on child tables; editor = read + write. 0031: clients are READ-ONLY here (SELECT policy only, no insert/update/delete grants). Every write goes through the manage-collaborators Edge Function (service role).';

-- ============================================================
-- §2. user_can_access_trip: no cross-user oracle (#11)
-- ============================================================
-- Same signature, default, owner and grants (CREATE OR REPLACE keeps the ACL).
-- New guard: answer only for the caller (p_user_id = auth.uid()) or for the
-- service role. RLS policies always pass auth.uid(), so the guard is true
-- there and behavior is unchanged. auth.uid()/auth.role() read the request.jwt.*
-- GUCs, which a SECURITY DEFINER switch does not reset. A direct DB session
-- with no JWT gets false (fail closed); such roles (postgres, service_role)
-- bypass RLS and never needed this helper.
-- coalesce(…, false): NULL auth.uid() (anon) yields a clean false, not NULL.
create or replace function public.user_can_access_trip(
  p_trip_id   uuid,
  p_user_id   uuid,
  p_min_role  text default 'viewer'
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (
      p_user_id = auth.uid()
      or auth.role() = 'service_role'
    )
    and (
      -- Owner short-circuit
      exists (
        select 1
        from public.trips
        where id = p_trip_id
          and user_id = p_user_id
      )
      or
      -- Accepted collaborator with sufficient role
      exists (
        select 1
        from public.trip_collaborators
        where trip_id = p_trip_id
          and user_id = p_user_id
          and status  = 'accepted'
          and (
            (p_min_role = 'viewer')
            or
            (p_min_role = 'editor' and role = 'editor')
          )
      )
    ),
    false
  );
$$;

comment on function public.user_can_access_trip(uuid, uuid, text) is
  'Phase 21 (+0031 guard): true if p_user_id can access the trip at >= min_role (owner OR accepted collaborator). Answers ONLY for p_user_id = auth.uid() or the service role, so it is not a cross-user oracle. SECURITY DEFINER so child-table RLS policies do not recurse. EXECUTE: authenticated (the RLS policies run as the caller) + service_role; never anon.';

-- ============================================================
-- §3. Self-owned child rows cannot be re-parented (#10)
-- ============================================================
-- RLS cannot compare OLD and NEW, so USING (the pre-image) and WITH CHECK (the
-- post-image) must BOTH re-assert trip access. The trip_places EXISTS runs
-- under the caller's own viewer-gated trip_places RLS, the same predicate as
-- the 0017 INSERT policy. Side effect (intended, same stance as 0019
-- comments): a collaborator whose access was revoked can no longer edit or
-- delete their old reactions/comments. Account deletion still cascades them.

-- 3a. trip_place_reactions
drop policy if exists "trip_place_reactions_self_update" on public.trip_place_reactions;
create policy "trip_place_reactions_self_update"
  on public.trip_place_reactions for update
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_reactions.trip_place_id
        and public.user_can_access_trip(tp.trip_id, auth.uid(), 'viewer')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_reactions.trip_place_id
        and public.user_can_access_trip(tp.trip_id, auth.uid(), 'viewer')
    )
  );

drop policy if exists "trip_place_reactions_self_delete" on public.trip_place_reactions;
create policy "trip_place_reactions_self_delete"
  on public.trip_place_reactions for delete
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_reactions.trip_place_id
        and public.user_can_access_trip(tp.trip_id, auth.uid(), 'viewer')
    )
  );

-- 3b. trip_place_comments. WITH CHECK (0019) already re-asserts access and
-- trip/place consistency. Only USING was author-only, which let a revoked
-- author re-parent their comment out of a trip they lost. The DELETE policy is
-- aligned with it.
drop policy if exists "trip_place_comments_author_update" on public.trip_place_comments;
create policy "trip_place_comments_author_update"
  on public.trip_place_comments for update
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  )
  with check (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_comments.trip_place_id
        and tp.trip_id = trip_place_comments.trip_id
    )
  );

drop policy if exists "trip_place_comments_author_delete" on public.trip_place_comments;
create policy "trip_place_comments_author_delete"
  on public.trip_place_comments for delete
  to authenticated
  using (
    author_id = auth.uid()
    and public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
  );

-- ============================================================
-- §4. Function EXECUTE matrix (#7): audit of every public function
-- ============================================================
-- anon inherits PUBLIC, so every revoke below names both. The anon role has no
-- legitimate caller: the share page reads through the share-trip Edge Function
-- (service role), and every RLS policy that calls a helper is TO authenticated.
-- Trigger functions (set_updated_at, handle_times, trip_collaborators_set_*,
-- enforce_trips_column_restrictions_fn) are not checked for EXECUTE when they
-- fire, and PostgREST cannot invoke them directly. They lose PUBLIC/anon
-- EXECUTE purely as hygiene.
--
--   function                                   anon  authenticated          service_role
--   claim_trip_optimize(uuid,int)              -     - (was granted)        X  optimize-trip admin client
--   release_trip_optimize(uuid)                -     - (was granted)        X  optimize-trip admin client
--   user_can_access_trip(uuid,uuid,text)       -     X  RLS policies         X
--   current_user_email()                       -     X  collaborators RLS    X
--   duplicate_trip(uuid)                       -     X  src/api/trips.ts rpc X
--   delete_account_cascade()                   -     X  self-only, unused    X
--   apply_manual_day_order(uuid,int,uuid[])    -     X  trip-places.ts rpc   X
--   apply_optimization(uuid,jsonb)             -     X  (invoker; RLS-bound) X  optimize-trip
--   storage_path_trip_id(text)                 -     X  trip-docs policies   X
--   get_my_trip_stats()                        -     X  (unchanged)          X
--   increment_ai_usage(uuid,int,int,int)       -     X  (unchanged, self-pinned) X
--   consume_ai_quota / refund_ai_quota (§5)    -     -                      X
--   trigger fns (5)                            -     X (inert)              X

revoke execute on function public.claim_trip_optimize(uuid, int)  from public, anon, authenticated;
revoke execute on function public.release_trip_optimize(uuid)     from public, anon, authenticated;
grant  execute on function public.claim_trip_optimize(uuid, int)  to service_role;
grant  execute on function public.release_trip_optimize(uuid)     to service_role;

revoke execute on function public.user_can_access_trip(uuid, uuid, text)        from public, anon;
revoke execute on function public.current_user_email()                         from public, anon;
revoke execute on function public.duplicate_trip(uuid)                         from public, anon;
revoke execute on function public.delete_account_cascade()                     from public, anon;
revoke execute on function public.apply_manual_day_order(uuid, integer, uuid[]) from public, anon;
revoke execute on function public.apply_optimization(uuid, jsonb)              from public, anon;
revoke execute on function public.storage_path_trip_id(text)                   from public, anon;
revoke execute on function public.get_my_trip_stats()                          from public, anon;
revoke execute on function public.increment_ai_usage(uuid, int, int, int)      from public, anon;

grant execute on function public.user_can_access_trip(uuid, uuid, text)        to authenticated, service_role;
grant execute on function public.current_user_email()                         to authenticated, service_role;
grant execute on function public.duplicate_trip(uuid)                         to authenticated, service_role;
grant execute on function public.delete_account_cascade()                     to authenticated, service_role;
grant execute on function public.apply_manual_day_order(uuid, integer, uuid[]) to authenticated, service_role;
grant execute on function public.apply_optimization(uuid, jsonb)              to authenticated, service_role;
grant execute on function public.storage_path_trip_id(text)                   to authenticated, service_role;

-- Trigger functions: hygiene only (see above).
revoke execute on function public.set_updated_at()                         from public, anon;
revoke execute on function public.handle_times()                           from public, anon;
revoke execute on function public.trip_collaborators_set_timestamps_fn()   from public, anon;
revoke execute on function public.trip_collaborators_set_invite_token_fn() from public, anon;
revoke execute on function public.enforce_trips_column_restrictions_fn()   from public, anon;

-- ============================================================
-- §5. Atomic AI quota reservation (#8)
-- ============================================================
-- Defense in depth: counters can never go negative, whatever the writer.
alter table public.ai_usage drop constraint if exists ai_usage_counters_nonnegative;
alter table public.ai_usage
  add constraint ai_usage_counters_nonnegative
  check (ai_runs >= 0 and grounding_calls >= 0 and routing_calls >= 0);

-- consume_ai_quota: reserve p_runs / p_grounding on today's (UTC) ledger row
-- ONLY if the post-reservation totals stay within the caps (NULL cap =
-- uncapped counter). One INSERT ... ON CONFLICT DO UPDATE ... WHERE statement:
-- the conflicting row is locked and the WHERE is evaluated against its latest
-- committed version. So N concurrent callers at 9/10 serialize on the row and
-- exactly one of them wins the 10th slot. The same holds on the first
-- request of the day: a racing INSERT waits on the unique key, then takes
-- the UPDATE path.
-- Returns true when reserved and false when blocked; nothing is written when
-- blocked. The cap semantics match the pre-0031 read-then-check exactly:
--   runs:      blocked iff used + p_runs      > p_run_cap        (old: used >= 10 for +1)
--   grounding: blocked iff used + p_grounding > p_grounding_cap  (old: used + n > 100)
create or replace function public.consume_ai_quota(
  p_user          uuid,
  p_runs          int,
  p_grounding     int,
  p_run_cap       int,
  p_grounding_cap int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_runs      int := coalesce(p_runs, 0);
  v_grounding int := coalesce(p_grounding, 0);
  v_ok        boolean;
begin
  if p_user is null then
    raise exception 'consume_ai_quota: p_user is required' using errcode = '22004';
  end if;
  if v_runs < 0 or v_grounding < 0 then
    raise exception 'consume_ai_quota: negative reservations are not allowed' using errcode = '22023';
  end if;
  if coalesce(p_run_cap, 0) < 0 or coalesce(p_grounding_cap, 0) < 0 then
    raise exception 'consume_ai_quota: caps must be >= 0' using errcode = '22023';
  end if;
  -- Belt-and-braces (EXECUTE is service_role-only, where auth.uid() is NULL):
  -- a JWT caller could only ever reserve against their own row.
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'consume_ai_quota: callers may only reserve their own quota' using errcode = '42501';
  end if;
  -- A request that alone exceeds a cap can never fit. This also covers the
  -- first-row INSERT path, which the ON CONFLICT WHERE clause does not guard.
  if (p_run_cap is not null and v_runs > p_run_cap)
     or (p_grounding_cap is not null and v_grounding > p_grounding_cap) then
    return false;
  end if;

  insert into public.ai_usage as u (user_id, day, ai_runs, grounding_calls, routing_calls)
  values (p_user, current_date, v_runs, v_grounding, 0)
  on conflict (user_id, day) do update
    set ai_runs         = u.ai_runs         + excluded.ai_runs,
        grounding_calls = u.grounding_calls + excluded.grounding_calls
    where (p_run_cap       is null or u.ai_runs         + excluded.ai_runs         <= p_run_cap)
      and (p_grounding_cap is null or u.grounding_calls + excluded.grounding_calls <= p_grounding_cap)
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.consume_ai_quota(uuid, int, int, int, int) is
  'v2 0031 (audit #8): ATOMIC check-and-reserve on ai_usage (today, UTC). Adds p_runs/p_grounding only if the new totals stay <= p_run_cap/p_grounding_cap (NULL cap = uncapped); returns true when reserved, false when blocked (no write). Called by ai-itinerary/ai-edit BEFORE any LLM/Google spend. service_role only.';

-- refund_ai_quota: give back an UNUSED part of a reservation (ai-edit ground
-- reserves one grounding call per name, and names that never reach a Places
-- details call are refunded, which keeps grounding_calls = actual Google
-- details spend, as before 0031). Negative-safe: greatest(0, ...) plus the
-- CHECK above. p_day pins the refund to the reservation's day. The caller
-- captures it just before reserving, so a midnight straddle can only
-- under-refund, never credit the wrong day. No-op if the row is missing.
create or replace function public.refund_ai_quota(
  p_user      uuid,
  p_runs      int,
  p_grounding int,
  p_day       date default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_runs      int := coalesce(p_runs, 0);
  v_grounding int := coalesce(p_grounding, 0);
begin
  if p_user is null then
    raise exception 'refund_ai_quota: p_user is required' using errcode = '22004';
  end if;
  if v_runs < 0 or v_grounding < 0 then
    raise exception 'refund_ai_quota: negative refunds are not allowed' using errcode = '22023';
  end if;
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'refund_ai_quota: callers may only refund their own quota' using errcode = '42501';
  end if;
  if v_runs = 0 and v_grounding = 0 then
    return;
  end if;

  update public.ai_usage
     set ai_runs         = greatest(0, ai_runs         - v_runs),
         grounding_calls = greatest(0, grounding_calls - v_grounding)
   where user_id = p_user
     and day     = coalesce(p_day, current_date);
end;
$$;

comment on function public.refund_ai_quota(uuid, int, int, date) is
  'v2 0031 (audit #8): negative-safe give-back of an UNUSED consume_ai_quota reservation (e.g. ai-edit ground names that never reached a Places details call). Clamped at 0; pinned to p_day (default today). service_role only.';

revoke all on function public.consume_ai_quota(uuid, int, int, int, int) from public, anon, authenticated;
revoke all on function public.refund_ai_quota(uuid, int, int, date)     from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, int, int, int, int) to service_role;
grant execute on function public.refund_ai_quota(uuid, int, int, date)     to service_role;

-- ============================================================
-- §6. Future functions: no PUBLIC / anon EXECUTE by default (#7)
-- ============================================================
-- Two statements are needed, and this was verified on the local stack.
--  - The per-schema form only removes Supabase's explicit `anon` default grant.
--    A per-schema REVOKE cannot remove the built-in global PUBLIC grant: it only
--    reverses per-schema GRANTs. Alone, it still left anon=X via PUBLIC.
--  - The global form (FOR ROLE postgres, no schema) removes the PUBLIC default
--    for functions postgres creates. Extensions here are created and owned by
--    supabase_admin, so they are unaffected.
-- New public functions therefore get EXECUTE only for postgres, authenticated
-- and service_role (Supabase's remaining per-schema defaults). A future
-- function that anon genuinely needs must be granted explicitly in its
-- migration.
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres revoke execute on functions from public;

-- Post-condition report (NOTICE only, so env drift can never fail a push).
do $check$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    raise notice '0031: anon still has EXECUTE on public.% — review', r.fn;
  end loop;
end
$check$;
