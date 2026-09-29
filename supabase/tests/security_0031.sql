-- security_0031.sql: exploit-replay test for migration 0031_v2_security_rls_grants.sql.
--
-- Plain SQL (NOT pg_prove/pgTAP). Each exploit from the 2026-09-29 audit is
-- replayed as the attacker's real role (authenticated/anon + request.jwt.claims)
-- and must now fail. Positive controls prove the legitimate app paths still
-- work. Any failed assertion RAISEs, so with ON_ERROR_STOP psql exits non-zero.
-- Everything runs in ONE transaction that is rolled back, so it leaves no residue.
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/security_0031.sql
--
-- Cast (fixed ids, all rolled back):
--   V  victim / owner of trip TV (place PV)
--   A  attacker, owner of trip TA (place PA)
--   C  ex-collaborator on TV (row REVOKED), owner of trip TC (place PC)
--   E  accepted EDITOR on TV (positive control for the user_can_access_trip guard)

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;

-- ------------------------------------------------------------------
-- Seed (as postgres: bypasses RLS)
-- ------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('031a0000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'victim@sec0031.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('031a0000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attacker@sec0031.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('031a0000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revoked@sec0031.test',  'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('031a0000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@sec0031.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', '');

insert into public.trips (id, user_id, title) values
  ('031b0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000a', 'sec0031 victim trip'),
  ('031b0000-0000-4000-8000-0000000000b1', '031a0000-0000-4000-8000-00000000000b', 'sec0031 attacker trip'),
  ('031b0000-0000-4000-8000-0000000000c1', '031a0000-0000-4000-8000-00000000000c', 'sec0031 ex-collab trip');

insert into public.trip_places (id, trip_id, google_place_id, lat, lng) values
  ('031c0000-0000-4000-8000-0000000000a1', '031b0000-0000-4000-8000-0000000000a1', 'GPID-SEC0031-V', 41.0, 29.0),
  ('031c0000-0000-4000-8000-0000000000b1', '031b0000-0000-4000-8000-0000000000b1', 'GPID-SEC0031-A', 48.8, 2.3),
  ('031c0000-0000-4000-8000-0000000000c1', '031b0000-0000-4000-8000-0000000000c1', 'GPID-SEC0031-C', 52.5, 13.4);

-- C was a viewer on TV and got REVOKED; E is an accepted editor on TV.
-- A has a legit accepted VIEWER row on A's own trip TA (seeded directly: the
-- 0011 exploit used an INSERT for this step, which #1a below proves is gone).
insert into public.trip_collaborators (id, trip_id, invitee_email, user_id, role, status) values
  ('031d0000-0000-4000-8000-0000000000c1', '031b0000-0000-4000-8000-0000000000a1', 'revoked@sec0031.test',  '031a0000-0000-4000-8000-00000000000c', 'viewer', 'revoked'),
  ('031d0000-0000-4000-8000-0000000000e1', '031b0000-0000-4000-8000-0000000000a1', 'editor@sec0031.test',   '031a0000-0000-4000-8000-00000000000e', 'editor', 'accepted'),
  ('031d0000-0000-4000-8000-0000000000b1', '031b0000-0000-4000-8000-0000000000b1', 'attacker@sec0031.test', '031a0000-0000-4000-8000-00000000000b', 'viewer', 'accepted');

-- Reactions/comments: A reacts on own place PA. C still has a reaction and a
-- comment on the victim place PV from before the revoke.
insert into public.trip_place_reactions (id, trip_place_id, user_id, reaction) values
  ('031e0000-0000-4000-8000-0000000000b1', '031c0000-0000-4000-8000-0000000000b1', '031a0000-0000-4000-8000-00000000000b', 'liked'),
  ('031e0000-0000-4000-8000-0000000000c1', '031c0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000c', 'liked');

insert into public.trip_place_comments (id, trip_id, trip_place_id, author_id, body) values
  ('031f0000-0000-4000-8000-0000000000b1', '031b0000-0000-4000-8000-0000000000b1', '031c0000-0000-4000-8000-0000000000b1', '031a0000-0000-4000-8000-00000000000b', 'attacker comment on own place'),
  ('031f0000-0000-4000-8000-0000000000c1', '031b0000-0000-4000-8000-0000000000a1', '031c0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000c', 'old comment from before revoke');

\echo '=== #1 trip_collaborators self-escalation ==='

-- ---------------- as ATTACKER A ----------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null

do $$
begin
  -- #1a original exploit step 1: INSERT an editor row (the owner-insert policy allowed it on own trip)
  begin
    insert into public.trip_collaborators (trip_id, invitee_email, user_id, role, status)
    values ('031b0000-0000-4000-8000-0000000000b1', 'attacker2@sec0031.test',
            '031a0000-0000-4000-8000-00000000000b', 'editor', 'accepted');
    raise exception 'FAIL #1a: attacker INSERT into trip_collaborators succeeded';
  exception when insufficient_privilege then
    raise notice 'PASS #1a: attacker INSERT denied (%)', sqlerrm;
  end;

  -- #1b original exploit step 2: move own row onto the victim trip as editor
  begin
    update public.trip_collaborators
       set trip_id = '031b0000-0000-4000-8000-0000000000a1', role = 'editor'
     where id = '031d0000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL #1b: attacker UPDATE trip_id was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS #1b: attacker UPDATE trip_id -> victim trip denied (%)', sqlerrm;
  end;

  -- DELETE is gone too (client never hard-deletes; revoke is a soft flip in the Edge Function)
  begin
    delete from public.trip_collaborators where id = '031d0000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL #1c: attacker DELETE on trip_collaborators was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS #1c: DELETE denied (%)', sqlerrm;
  end;

  -- Net effect: attacker has NO access to the victim trip.
  if public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1', auth.uid(), 'viewer') then
    raise exception 'FAIL #1: attacker can access the victim trip';
  end if;
  if exists (select 1 from public.trip_places where trip_id = '031b0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL #1: attacker can read victim trip_places';
  end if;
  raise notice 'PASS #1: attacker has no access to the victim trip (RLS read = 0 rows)';

  -- Positive control: the attacker can still READ their own collaborator row (useTrips path)
  if not exists (select 1 from public.trip_collaborators where user_id = auth.uid() and status = 'accepted') then
    raise exception 'FAIL #1 control: invitee can no longer SELECT own collaborator rows';
  end if;
  raise notice 'PASS #1 control: invitee SELECT of own rows still works';
end $$;

-- ---------------- as REVOKED ex-collaborator C ----------------
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000c","role":"authenticated"}', true) \g /dev/null

do $$
begin
  -- #1d revoked viewer re-accepts as editor
  begin
    update public.trip_collaborators
       set status = 'accepted', role = 'editor'
     where id = '031d0000-0000-4000-8000-0000000000c1';
    raise exception 'FAIL #1d: revoked collaborator re-accept was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS #1d: revoked viewer re-accept as editor denied (%)', sqlerrm;
  end;
  if public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1', auth.uid(), 'viewer') then
    raise exception 'FAIL #1d: revoked collaborator regained access';
  end if;
end $$;

-- ---------------- as OWNER V (manage-collaborators `list` runs under the user JWT) ----------------
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000a","role":"authenticated"}', true) \g /dev/null

do $$
declare n int;
begin
  select count(*) into n from public.trip_collaborators where trip_id = '031b0000-0000-4000-8000-0000000000a1';
  if n <> 2 then
    raise exception 'FAIL #1 control: owner sees % collaborator rows on own trip (expected 2)', n;
  end if;
  raise notice 'PASS #1 control: owner still lists collaborators (% rows)', n;
  -- Owner can no longer write directly either (the Edge Function does it with service role).
  begin
    update public.trip_collaborators set status = 'revoked' where id = '031d0000-0000-4000-8000-0000000000e1';
    raise exception 'FAIL #1e: owner direct UPDATE was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS #1e: owner direct UPDATE denied (writes are Edge-Function-only)';
  end;
end $$;

reset role;

-- ---------------- service_role (manage-collaborators admin client) still writes ----------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare n int;
begin
  update public.trip_collaborators set role = 'viewer' where id = '031d0000-0000-4000-8000-0000000000e1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL #1 control: service_role UPDATE affected % rows', n; end if;
  update public.trip_collaborators set role = 'editor' where id = '031d0000-0000-4000-8000-0000000000e1';
  insert into public.trip_collaborators (trip_id, invitee_email, role, status)
  values ('031b0000-0000-4000-8000-0000000000a1', 'new-invite@sec0031.test', 'viewer', 'pending');
  raise notice 'PASS #1 control: service_role (manage-collaborators) INSERT/UPDATE still work';
end $$;
reset role;

\echo '=== #7 function EXECUTE grants ==='

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
do $$
declare
  probe text;
  probes text[] := array[
    $p$select public.claim_trip_optimize('031b0000-0000-4000-8000-0000000000a1'::uuid, 300)$p$,
    $p$select public.release_trip_optimize('031b0000-0000-4000-8000-0000000000a1'::uuid)$p$,
    $p$select public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1'::uuid, '031a0000-0000-4000-8000-00000000000a'::uuid, 'viewer')$p$,
    $p$select public.current_user_email()$p$,
    $p$select public.duplicate_trip('031b0000-0000-4000-8000-0000000000a1'::uuid)$p$,
    $p$select public.delete_account_cascade()$p$,
    $p$select public.apply_optimization('031b0000-0000-4000-8000-0000000000a1'::uuid, '[]'::jsonb)$p$,
    $p$select public.apply_manual_day_order('031b0000-0000-4000-8000-0000000000a1'::uuid, 0, array[]::uuid[])$p$,
    $p$select public.storage_path_trip_id('x/y')$p$,
    $p$select public.consume_ai_quota('031a0000-0000-4000-8000-00000000000a'::uuid, 1, 0, 10, null)$p$,
    $p$select public.refund_ai_quota('031a0000-0000-4000-8000-00000000000a'::uuid, 1, 0, null)$p$
  ];
begin
  foreach probe in array probes loop
    begin
      execute probe;
      raise exception 'FAIL #7: anon could run: %', probe;
    exception when insufficient_privilege then
      raise notice 'PASS #7: anon denied: %', split_part(split_part(probe, '(', 1), '.', 2);
    end;
  end loop;
end $$;
reset role;

-- The optimize mutex is service-role-only for signed-in users too (audit: "any signed-in user could grief any trip").
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
declare
  probe text;
  probes text[] := array[
    $p$select public.claim_trip_optimize('031b0000-0000-4000-8000-0000000000a1'::uuid, 300)$p$,
    $p$select public.release_trip_optimize('031b0000-0000-4000-8000-0000000000a1'::uuid)$p$,
    $p$select public.consume_ai_quota('031a0000-0000-4000-8000-00000000000b'::uuid, 0, 0, null, null)$p$,
    $p$select public.refund_ai_quota('031a0000-0000-4000-8000-00000000000b'::uuid, 1, 0, null)$p$
  ];
begin
  foreach probe in array probes loop
    begin
      execute probe;
      raise exception 'FAIL #7: authenticated could run: %', probe;
    exception when insufficient_privilege then
      raise notice 'PASS #7: authenticated denied: %', split_part(split_part(probe, '(', 1), '.', 2);
    end;
  end loop;
end $$;
reset role;

-- Catalog-level: the full ACL matrix, plus default privileges for FUTURE functions.
do $$
declare
  r record;
  bad text := '';
begin
  -- 1. No non-extension public function is executable by anon.
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    bad := bad || r.fn || ' ';
  end loop;
  if bad <> '' then raise exception 'FAIL #7: anon still has EXECUTE on: %', bad; end if;
  raise notice 'PASS #7: no public function is anon-executable';

  -- 2. authenticated keeps what RLS policies / client RPCs need; loses the mutex + quota RPCs.
  if not (has_function_privilege('authenticated', 'public.user_can_access_trip(uuid,uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'public.current_user_email()', 'execute')
      and has_function_privilege('authenticated', 'public.duplicate_trip(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.apply_manual_day_order(uuid,integer,uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.storage_path_trip_id(text)', 'execute')
      and has_function_privilege('authenticated', 'public.get_my_trip_stats()', 'execute')) then
    raise exception 'FAIL #7: authenticated lost EXECUTE on a function the app/RLS needs';
  end if;
  if has_function_privilege('authenticated', 'public.claim_trip_optimize(uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.release_trip_optimize(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_ai_quota(uuid,integer,integer,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.refund_ai_quota(uuid,integer,integer,date)', 'execute') then
    raise exception 'FAIL #7: authenticated can still execute a service-role-only function';
  end if;
  if not (has_function_privilege('service_role', 'public.claim_trip_optimize(uuid,integer)', 'execute')
      and has_function_privilege('service_role', 'public.release_trip_optimize(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.consume_ai_quota(uuid,integer,integer,integer,integer)', 'execute')
      and has_function_privilege('service_role', 'public.refund_ai_quota(uuid,integer,integer,date)', 'execute')
      and has_function_privilege('service_role', 'public.increment_ai_usage(uuid,integer,integer,integer)', 'execute')) then
    raise exception 'FAIL #7: service_role lost EXECUTE on an Edge Function RPC';
  end if;
  raise notice 'PASS #7: authenticated/service_role EXECUTE matrix as designed';
end $$;

-- 3. A function created from now on (by postgres, like every migration) is NOT anon-executable.
create function public.zz_sec0031_probe() returns int language sql as 'select 1';
do $$
begin
  if has_function_privilege('anon', 'public.zz_sec0031_probe()', 'execute') then
    raise exception 'FAIL #7: default privileges still give anon EXECUTE on new functions';
  end if;
  if not has_function_privilege('authenticated', 'public.zz_sec0031_probe()', 'execute') then
    raise exception 'FAIL #7: default privileges no longer give authenticated EXECUTE on new functions';
  end if;
  raise notice 'PASS #7: new public functions default to authenticated+service_role only (no anon/PUBLIC)';
end $$;

-- 4. Triggers still fire for authenticated writers despite the trigger-fn revokes
--    (EXECUTE is not checked at fire time): handle_times stamps updated_at.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000a","role":"authenticated"}', true) \g /dev/null
do $$
declare ts timestamptz;
begin
  update public.trips set title = 'sec0031 victim trip (renamed)' where id = '031b0000-0000-4000-8000-0000000000a1'
  returning updated_at into ts;
  if ts is null then raise exception 'FAIL #7 control: trips trigger did not stamp updated_at'; end if;
  raise notice 'PASS #7 control: owner UPDATE + triggers still work as authenticated';
end $$;
reset role;

\echo '=== #11 user_can_access_trip oracle ==='

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
begin
  -- Attacker probes whether the VICTIM can access the victim's trip: must be false now.
  if public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000a', 'viewer') then
    raise exception 'FAIL #11: user_can_access_trip still answers for another user id';
  end if;
  if public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000e', 'editor') then
    raise exception 'FAIL #11: oracle reveals the editor collaborator';
  end if;
  raise notice 'PASS #11: cross-user probe returns false';
  -- Self-check still truthful.
  if not public.user_can_access_trip('031b0000-0000-4000-8000-0000000000b1', auth.uid(), 'editor') then
    raise exception 'FAIL #11 control: owner self-check returned false';
  end if;
  raise notice 'PASS #11 control: self-check (the RLS form) still true';
end $$;

-- The accepted EDITOR E still has full RLS access (policy path passes auth.uid()).
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000e","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.trip_places where trip_id = '031b0000-0000-4000-8000-0000000000a1';
  if n <> 1 then raise exception 'FAIL #11 control: editor sees % victim-trip places (expected 1)', n; end if;
  insert into public.trip_places (trip_id, google_place_id, lat, lng)
  values ('031b0000-0000-4000-8000-0000000000a1', 'GPID-SEC0031-E', 41.1, 29.1);
  raise notice 'PASS #11 control: accepted editor can still read + write via RLS';
end $$;
reset role;

-- The service role may still ask about any user (for Edge Functions).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
begin
  if not public.user_can_access_trip('031b0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-00000000000e', 'editor') then
    raise exception 'FAIL #11 control: service_role lookup returned false';
  end if;
  raise notice 'PASS #11 control: service_role can check any user';
end $$;
reset role;

\echo '=== #10 self-owned child rows cannot be re-parented ==='

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  -- #10a original exploit: move own reaction onto a place in a trip the attacker cannot see
  begin
    update public.trip_place_reactions
       set trip_place_id = '031c0000-0000-4000-8000-0000000000a1'
     where id = '031e0000-0000-4000-8000-0000000000b1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL #10a: reaction moved onto the victim place (% rows)', n; end if;
    raise notice 'PASS #10a: reaction move blocked (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS #10a: reaction move onto victim place denied (%)', sqlerrm;
  end;

  -- #10b same for comments (move into the victim trip/place)
  begin
    update public.trip_place_comments
       set trip_id = '031b0000-0000-4000-8000-0000000000a1',
           trip_place_id = '031c0000-0000-4000-8000-0000000000a1'
     where id = '031f0000-0000-4000-8000-0000000000b1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL #10b: comment moved into the victim trip (% rows)', n; end if;
    raise notice 'PASS #10b: comment move blocked (0 rows)';
  exception when insufficient_privilege then
    raise notice 'PASS #10b: comment move into victim trip denied (%)', sqlerrm;
  end;

  -- Positive control: own reaction on own trip still toggles (sync LWW path) + soft-delete.
  update public.trip_place_reactions set reaction = 'disliked' where id = '031e0000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL #10 control: own reaction update affected % rows', n; end if;
  update public.trip_place_reactions set deleted = true where id = '031e0000-0000-4000-8000-0000000000b1';
  update public.trip_place_comments set body = 'edited' where id = '031f0000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL #10 control: own comment edit affected % rows', n; end if;
  raise notice 'PASS #10 control: own reaction/comment edits on an accessible trip still work';
end $$;

-- Revoked C: can no longer mutate leftovers on the victim trip, nor re-parent them to own trip TC.
select set_config('request.jwt.claims', '{"sub":"031a0000-0000-4000-8000-00000000000c","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  update public.trip_place_reactions
     set trip_place_id = '031c0000-0000-4000-8000-0000000000c1'
   where id = '031e0000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL #10c: revoked user re-parented a reaction (% rows)', n; end if;

  delete from public.trip_place_reactions where id = '031e0000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL #10c: revoked user deleted a reaction on a lost trip (% rows)', n; end if;

  update public.trip_place_comments
     set trip_id = '031b0000-0000-4000-8000-0000000000c1',
         trip_place_id = '031c0000-0000-4000-8000-0000000000c1'
   where id = '031f0000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL #10d: revoked author re-parented a comment (% rows)', n; end if;

  delete from public.trip_place_comments where id = '031f0000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL #10d: revoked author hard-deleted a comment on a lost trip (% rows)', n; end if;
  raise notice 'PASS #10c/d: revoked collaborator cannot update/move/delete reactions or comments on the lost trip';
end $$;
reset role;

do $$
begin
  if not exists (select 1 from public.trip_place_reactions
                 where id = '031e0000-0000-4000-8000-0000000000c1'
                   and trip_place_id = '031c0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL #10: reaction row was changed';
  end if;
  if not exists (select 1 from public.trip_place_comments
                 where id = '031f0000-0000-4000-8000-0000000000c1'
                   and trip_id = '031b0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL #10: comment row was changed';
  end if;
  raise notice 'PASS #10: rows verified unchanged (superuser view)';
end $$;

\echo '=== #8 atomic AI quota ==='

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare
  uid constant uuid := '031a0000-0000-4000-8000-00000000000b';
  won int := 0;
  i int;
  runs int;
  g int;
begin
  -- 12 back-to-back reservations against the 10/day cap: exactly 10 win, the ledger stops at 10.
  for i in 1..12 loop
    if public.consume_ai_quota(uid, 1, 0, 10, null) then won := won + 1; end if;
  end loop;
  select ai_runs into runs from public.ai_usage where user_id = uid and day = current_date;
  if won <> 10 or runs <> 10 then
    raise exception 'FAIL #8a: % reservations won, ledger ai_runs=% (expected 10/10)', won, runs;
  end if;
  raise notice 'PASS #8a: 12 run reservations -> 10 granted, 2 blocked, ai_runs=10';

  -- Grounding budget (ai-edit ground): 60 ok, +50 blocked (110 > 100), +40 ok (=100).
  if not public.consume_ai_quota(uid, 0, 60, null, 100) then raise exception 'FAIL #8b: 60/100 blocked'; end if;
  if public.consume_ai_quota(uid, 0, 50, null, 100) then raise exception 'FAIL #8b: 110/100 granted'; end if;
  if not public.consume_ai_quota(uid, 0, 40, null, 100) then raise exception 'FAIL #8b: 100/100 blocked'; end if;
  select grounding_calls into g from public.ai_usage where user_id = uid and day = current_date;
  if g <> 100 then raise exception 'FAIL #8b: grounding_calls=% (expected 100)', g; end if;
  raise notice 'PASS #8b: grounding cap enforced at exactly 100';

  -- A single request larger than the cap never fits, and nothing is written (first-row path).
  if public.consume_ai_quota('031a0000-0000-4000-8000-00000000000e', 0, 101, null, 100) then
    raise exception 'FAIL #8c: oversize first-row reservation granted';
  end if;
  if exists (select 1 from public.ai_usage where user_id = '031a0000-0000-4000-8000-00000000000e') then
    raise exception 'FAIL #8c: blocked reservation wrote a ledger row';
  end if;
  raise notice 'PASS #8c: oversize reservation blocked with no write';

  -- Refund: negative-safe and clamped at zero.
  perform public.refund_ai_quota(uid, 0, 30, current_date);
  select grounding_calls into g from public.ai_usage where user_id = uid and day = current_date;
  if g <> 70 then raise exception 'FAIL #8d: refund 30 -> grounding_calls=% (expected 70)', g; end if;
  perform public.refund_ai_quota(uid, 500, 500, null);
  select ai_runs, grounding_calls into runs, g from public.ai_usage where user_id = uid and day = current_date;
  if runs <> 0 or g <> 0 then raise exception 'FAIL #8d: over-refund left runs=% grounding=%', runs, g; end if;
  raise notice 'PASS #8d: refund works and clamps at 0 (never negative)';

  begin
    perform public.consume_ai_quota(uid, -5, 0, 10, null);
    raise exception 'FAIL #8e: negative reservation accepted';
  exception when invalid_parameter_value then
    raise notice 'PASS #8e: negative reservation rejected';
  end;
  begin
    perform public.refund_ai_quota(uid, -1, 0, null);
    raise exception 'FAIL #8e: negative refund accepted';
  exception when invalid_parameter_value then
    raise notice 'PASS #8e: negative refund rejected';
  end;
end $$;
reset role;

do $$
begin
  begin
    update public.ai_usage set ai_runs = -1 where user_id = '031a0000-0000-4000-8000-00000000000b';
    raise exception 'FAIL #8f: negative counter accepted by the table';
  exception when check_violation then
    raise notice 'PASS #8f: ai_usage CHECK rejects negative counters even for superuser writes';
  end;
end $$;

\echo '=== ALL security_0031 CHECKS PASSED (rolling back) ==='
rollback;
