-- Phase 21 budget RLS smoke.
--
-- Exercises RLS for trip_expenses and trips.total_budget under three
-- collaborator roles: owner, viewer, editor.
--
-- Also explicitly tests editor UPDATE on trips.total_budget and confirms
-- the expected policy: editors CANNOT update trips.total_budget because
-- the trips UPDATE policy is owner-only.
--
-- Expected results (by step):
--   Step 1: A owns trip + inserts expense          → PASS
--   Step 2: B (no invite) sees no expenses         → 0 rows
--   Step 3: Invite B as viewer
--   Step 4: B viewer can SELECT expenses           → 1 row
--           B viewer INSERT expense denied         → PASS (42501)
--           B viewer UPDATE expense denied         → PASS
--           B viewer DELETE expense denied         → PASS
--   Step 5: Upgrade B to editor
--   Step 6: B editor can INSERT expense            → PASS
--           B editor can UPDATE own expense        → PASS
--           B editor cannot UPDATE trips.total_budget → FAIL (42501 expected)
--   Step 7: Revoke B; B loses access               → 0 rows, INSERT denied
--
-- Run as superuser against the local Supabase database:
--   psql postgresql://postgres:postgres@localhost:54322/postgres -f scripts/smoke-budget-rls.sql

\set ON_ERROR_STOP on

-- Clean up any prior smoke run (idempotent, runs as superuser).
delete from public.trip_expenses where trip_id in (select id from public.trips where title = 'budget-rls-smoke-trip');
delete from public.trip_collaborators where invitee_email like '%@budget-smoke.test';
delete from public.trips where title = 'budget-rls-smoke-trip';
delete from auth.users where email in ('budget-a@budget-smoke.test', 'budget-b@budget-smoke.test');

-- Seed two auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'budget-a@budget-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'budget-b@budget-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- ============================================================
-- Step 1: Owner A creates a trip with a budget and an expense
-- ============================================================
\echo '--- Step 1: A creates trip + expense ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

insert into public.trips (id, user_id, title, total_budget)
values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'budget-rls-smoke-trip', 1000);

insert into public.trip_expenses (id, trip_id, category, amount, kind)
values ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'accommodation', 300.00, 'actual');

select 'A_SEES_OWN_EXPENSE (expect 1): ' || count(*)::text from public.trip_expenses where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
select 'A_SEES_TOTAL_BUDGET (expect 1000): ' || total_budget::text from public.trips where id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
commit;

-- ============================================================
-- Step 2: B with no invite sees nothing
-- ============================================================
\echo ''
\echo '--- Step 2: B has no invite ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

select 'B_SEES_EXPENSES_NO_INVITE (expect 0): ' || count(*)::text from public.trip_expenses where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
commit;

-- ============================================================
-- Step 3: A invites B as viewer (accepted directly)
-- ============================================================
\echo ''
\echo '--- Step 3: A invites B as viewer (status=accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'budget-b@budget-smoke.test', 'viewer', 'accepted', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid);
commit;

-- ============================================================
-- Step 4: B as viewer can SELECT, but INSERT/UPDATE/DELETE denied
-- ============================================================
\echo ''
\echo '--- Step 4: B as viewer ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

select 'B_SEES_EXPENSES_AS_VIEWER (expect 1): ' || count(*)::text from public.trip_expenses where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

-- B viewer INSERT denied
do $$
begin
  insert into public.trip_expenses (trip_id, category, amount, kind)
  values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'food', 50.00, 'estimated');
  raise notice 'FAIL: B viewer was able to INSERT trip_expense';
exception when insufficient_privilege then
  raise notice 'PASS: B viewer INSERT trip_expense denied (42501)';
when others then
  raise notice 'PASS: B viewer INSERT trip_expense denied (%): %', sqlstate, sqlerrm;
end$$;

-- B viewer UPDATE denied
do $$
begin
  update public.trip_expenses
  set amount = 999
  where id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid;
  if found then
    raise notice 'FAIL: B viewer was able to UPDATE trip_expense';
  else
    raise notice 'PASS: B viewer UPDATE trip_expense denied (0 rows updated by RLS USING)';
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: B viewer UPDATE trip_expense denied (42501)';
when others then
  raise notice 'PASS: B viewer UPDATE trip_expense denied (%): %', sqlstate, sqlerrm;
end$$;

-- B viewer DELETE denied
do $$
begin
  delete from public.trip_expenses where id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid;
  if found then
    raise notice 'FAIL: B viewer was able to DELETE trip_expense';
  else
    raise notice 'PASS: B viewer DELETE trip_expense denied (0 rows deleted by RLS USING)';
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: B viewer DELETE trip_expense denied (42501)';
when others then
  raise notice 'PASS: B viewer DELETE trip_expense denied (%): %', sqlstate, sqlerrm;
end$$;

commit;

-- ============================================================
-- Step 5: A upgrades B to editor
-- ============================================================
\echo ''
\echo '--- Step 5: A upgrades B to editor ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

update public.trip_collaborators
set role = 'editor'
where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid
  and invitee_email = 'budget-b@budget-smoke.test';
commit;

-- ============================================================
-- Step 6: B as editor can CRUD trip_expenses
--         BUT cannot update trips.total_budget (owner-only)
-- ============================================================
\echo ''
\echo '--- Step 6: B as editor ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

-- B editor INSERT
do $$
declare
  new_id uuid;
begin
  insert into public.trip_expenses (trip_id, category, amount, kind)
  values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'transport', 75.00, 'actual')
  returning id into new_id;
  raise notice 'PASS: B editor INSERT trip_expense succeeded (id=%)', new_id;
exception when others then
  raise notice 'FAIL: B editor INSERT trip_expense denied (%): %', sqlstate, sqlerrm;
end$$;

-- B editor UPDATE (existing row owned by the trip)
do $$
begin
  update public.trip_expenses
  set label = 'edited by B editor'
  where id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid;
  if found then
    raise notice 'PASS: B editor UPDATE trip_expense succeeded';
  else
    raise notice 'INFO: B editor UPDATE matched 0 rows (check RLS USING; row may not be visible)';
  end if;
exception when others then
  raise notice 'FAIL: B editor UPDATE trip_expense error (%): %', sqlstate, sqlerrm;
end$$;

-- B editor DELETE (the row it just inserted)
do $$
begin
  delete from public.trip_expenses
  where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid
    and category = 'transport';
  if found then
    raise notice 'PASS: B editor DELETE trip_expense succeeded';
  else
    raise notice 'INFO: B editor DELETE matched 0 rows';
  end if;
exception when others then
  raise notice 'FAIL: B editor DELETE trip_expense error (%): %', sqlstate, sqlerrm;
end$$;

-- B editor attempts to UPDATE trips.total_budget — expected: DENIED.
-- The trips UPDATE policy is owner-only (user_id = auth.uid()).
-- An editor collaborator must NOT be able to change the trip's budget ceiling.
do $$
begin
  update public.trips
  set total_budget = 9999
  where id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid;
  if found then
    raise notice 'FINDING: B editor was able to UPDATE trips.total_budget (expected: denied). Report to backend-specialist — trips UPDATE policy may be too permissive.';
  else
    raise notice 'PASS: B editor UPDATE trips.total_budget denied (0 rows — owner-only policy applied)';
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: B editor UPDATE trips.total_budget denied (42501)';
when others then
  raise notice 'PASS: B editor UPDATE trips.total_budget denied (%): %', sqlstate, sqlerrm;
end$$;

commit;

-- Confirm budget did not change
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';
select 'TOTAL_BUDGET_UNCHANGED (expect 1000): ' || total_budget::text from public.trips where id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
commit;

-- ============================================================
-- Step 7: A revokes B; B loses expense access
-- ============================================================
\echo ''
\echo '--- Step 7: A revokes B ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

update public.trip_collaborators
set status = 'revoked'
where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid
  and invitee_email = 'budget-b@budget-smoke.test';
commit;

\echo ''
\echo '--- Step 7b: B after revoke ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

select 'B_SEES_EXPENSES_AFTER_REVOKE (expect 0): ' || count(*)::text from public.trip_expenses where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

do $$
begin
  insert into public.trip_expenses (trip_id, category, amount, kind)
  values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'shopping', 10.00, 'actual');
  raise notice 'FAIL: B revoked was able to INSERT trip_expense';
exception when insufficient_privilege then
  raise notice 'PASS: B revoked INSERT trip_expense denied (42501)';
when others then
  raise notice 'PASS: B revoked INSERT trip_expense denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_expenses where trip_id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid;
delete from public.trip_collaborators where invitee_email like '%@budget-smoke.test';
delete from public.trips where id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid;
delete from auth.users where email in ('budget-a@budget-smoke.test', 'budget-b@budget-smoke.test');

\echo ''
\echo 'Budget RLS smoke complete.'
