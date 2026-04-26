-- Phase 22 Step 22.1 smoke: editor-budget RLS on trips.
--
-- Six scenarios, each in its own BEGIN/COMMIT block (SET LOCAL only
-- applies inside an explicit transaction):
--
--   1. Owner can UPDATE trips.title                              -> PASS
--   2. Owner can UPDATE trips.total_budget                       -> PASS
--   3. Editor cannot UPDATE trips.title (trigger raises 42501)   -> PASS
--   4. Editor can UPDATE trips.total_budget                      -> PASS
--   5. Viewer cannot UPDATE trips.total_budget (RLS denies)      -> PASS
--   6. Non-collaborator cannot UPDATE anything (RLS denies)      -> PASS
--
-- Run as superuser against the local Supabase database:
--   psql postgresql://postgres:postgres@localhost:54322/postgres -f scripts/smoke-editor-budget-rls.sql

\set ON_ERROR_STOP on

-- Cleanup any prior smoke run (idempotent, runs as superuser).
delete from public.trip_collaborators where invitee_email like '%@editbud-smoke.test';
delete from public.trips where title in ('editbud-smoke-trip', 'editbud-smoke-trip-renamed');
delete from auth.users where email in (
  'editbud-owner@editbud-smoke.test',
  'editbud-editor@editbud-smoke.test',
  'editbud-viewer@editbud-smoke.test',
  'editbud-stranger@editbud-smoke.test'
);

-- Seed four auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('e1111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'editbud-owner@editbud-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('e2222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'editbud-editor@editbud-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('e3333333-3333-3333-3333-333333333333'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'editbud-viewer@editbud-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('e4444444-4444-4444-4444-444444444444'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'editbud-stranger@editbud-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- Seed: owner creates a trip with an initial total_budget.
\echo '--- Seed: owner creates trip ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title, total_budget)
values ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'e1111111-1111-1111-1111-111111111111'::uuid, 'editbud-smoke-trip', 1000);
commit;

-- Seed: editor + viewer collaborator rows (status=accepted).
\echo '--- Seed: invite editor + viewer (accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values
  ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'editbud-editor@editbud-smoke.test', 'editor', 'accepted', 'e2222222-2222-2222-2222-222222222222'::uuid),
  ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'editbud-viewer@editbud-smoke.test', 'viewer', 'accepted', 'e3333333-3333-3333-3333-333333333333'::uuid);
commit;

-- ============================================================
-- Scenario 1: Owner UPDATEs title -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 1: Owner UPDATE title ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  update public.trips
    set title = 'editbud-smoke-trip-renamed'
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'PASS: owner updated trips.title';
exception when others then
  raise notice 'FAIL: owner could not update trips.title (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Restore title for clarity in subsequent scenarios.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.trips set title = 'editbud-smoke-trip' where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Scenario 2: Owner UPDATEs total_budget -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 2: Owner UPDATE total_budget ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  update public.trips
    set total_budget = 2000
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'PASS: owner updated trips.total_budget';
exception when others then
  raise notice 'FAIL: owner could not update trips.total_budget (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 3: Editor UPDATE title -> trigger raises 42501
-- ============================================================
\echo ''
\echo '--- Scenario 3: Editor UPDATE title (expect 42501) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  update public.trips
    set title = 'editor-attempted-rename'
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'FAIL: editor was able to UPDATE trips.title';
exception when insufficient_privilege then
  raise notice 'PASS: editor UPDATE trips.title denied (insufficient_privilege)';
when others then
  raise notice 'PASS: editor UPDATE trips.title denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 4: Editor UPDATE total_budget -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 4: Editor UPDATE total_budget ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  update public.trips
    set total_budget = 3000
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'PASS: editor updated trips.total_budget';
exception when others then
  raise notice 'FAIL: editor could not UPDATE trips.total_budget (%): %', sqlstate, sqlerrm;
end$$;

-- Verify the value actually landed
select 'EDITOR_TOTAL_BUDGET_AFTER_UPDATE (expect 3000): ' || total_budget::text
  from public.trips where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Scenario 5: Viewer UPDATE total_budget -> RLS denies (no row updated)
-- ============================================================
-- A viewer matches NEITHER trips_owner_update NOR trips_editor_budget_update
-- (the latter requires the 'editor' role). Postgres reports this as an
-- effective UPDATE 0 — no rows match. The DO block fires no exception
-- (RLS doesn't raise; it just filters to zero rows). We verify by
-- reading total_budget back: it should still be 3000 from Scenario 4.
\echo ''
\echo '--- Scenario 5: Viewer UPDATE total_budget (expect no change) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set total_budget = 9999
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS: viewer UPDATE matched 0 rows (RLS filtered)';
  else
    raise notice 'FAIL: viewer UPDATE matched % rows', v_count;
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: viewer UPDATE denied (insufficient_privilege)';
when others then
  raise notice 'PASS: viewer UPDATE denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify total_budget unchanged. Re-read as owner so the check itself
-- is not subject to the viewer's RLS view of the row.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select 'VIEWER_TOTAL_BUDGET_AFTER_ATTEMPT (expect 3000): ' || total_budget::text
  from public.trips where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Scenario 6: Non-collaborator (stranger) UPDATE anything -> RLS denies
-- ============================================================
\echo ''
\echo '--- Scenario 6: Stranger UPDATE total_budget (expect no change) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e4444444-4444-4444-4444-444444444444","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set total_budget = 1234
    where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise notice 'PASS: stranger UPDATE matched 0 rows (RLS filtered)';
  else
    raise notice 'FAIL: stranger UPDATE matched % rows', v_count;
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: stranger UPDATE denied (insufficient_privilege)';
when others then
  raise notice 'PASS: stranger UPDATE denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify total_budget unchanged.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select 'STRANGER_TOTAL_BUDGET_AFTER_ATTEMPT (expect 3000): ' || total_budget::text
  from public.trips where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_collaborators where invitee_email like '%@editbud-smoke.test';
delete from public.trips where id = 'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
delete from auth.users where email in (
  'editbud-owner@editbud-smoke.test',
  'editbud-editor@editbud-smoke.test',
  'editbud-viewer@editbud-smoke.test',
  'editbud-stranger@editbud-smoke.test'
);

\echo ''
\echo 'Smoke complete.'
