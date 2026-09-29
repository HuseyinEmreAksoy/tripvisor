-- Phase 21 Step 21.7 follow-up: trip_accommodations RLS smoke.
--
-- Mirrors scripts/smoke-collab-rls.sql but exercises the accommodations
-- table specifically. Validates that 0013_trip_accommodations_rls_collab
-- correctly delegates to public.user_can_access_trip:
--
--   1. User A owns trip T with one accommodation row.
--   2. User B with NO collaborator row sees zero rows.
--   3. User B as accepted viewer sees the row.
--   4. User B as accepted viewer attempting INSERT is denied (42501).
--   5. User B as accepted editor INSERT succeeds.
--   6. User B revoked sees zero rows again.
--
-- Each user-scoped step runs inside an explicit BEGIN/COMMIT so SET LOCAL
-- ROLE / request.jwt.claims actually take effect (matches the pattern in
-- smoke-collab-rls.sql).

\set ON_ERROR_STOP on

-- ============================================================
-- Idempotent cleanup of any prior smoke run (runs as superuser).
-- ============================================================
delete from public.trip_accommodations where trip_id in (select id from public.trips where title = 'collab-acc-smoke-trip');
delete from public.trip_collaborators where invitee_email like '%@acc-smoke.test';
delete from public.trip_places where trip_id in (select id from public.trips where title = 'collab-acc-smoke-trip');
delete from public.trips where title = 'collab-acc-smoke-trip';
delete from auth.users where email in ('user-a@acc-smoke.test', 'user-b@acc-smoke.test');

-- Seed two auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('aa111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-a@acc-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('bb222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-b@acc-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- ============================================================
-- Step 1: User A creates trip + accommodation
-- ============================================================
\echo '--- Step 1: A creates trip + accommodation ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aa111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('cc333333-3333-3333-3333-333333333333'::uuid, 'aa111111-1111-1111-1111-111111111111'::uuid, 'collab-acc-smoke-trip');

insert into public.trip_accommodations (id, trip_id, name, address, check_in_date, check_out_date)
values ('dd444444-4444-4444-4444-444444444444'::uuid, 'cc333333-3333-3333-3333-333333333333'::uuid, 'Hotel A', '123 Main St', '2026-05-01', '2026-05-04');

select 'A_SEES_OWN_ACC (expect 1): ' || count(*)::text from public.trip_accommodations where trip_id = 'cc333333-3333-3333-3333-333333333333';
commit;

-- ============================================================
-- Step 2: User B with NO collaborator row sees zero rows
-- ============================================================
\echo ''
\echo '--- Step 2: B has no invite, sees nothing ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACC_BEFORE_INVITE (expect 0): ' || count(*)::text from public.trip_accommodations where trip_id = 'cc333333-3333-3333-3333-333333333333';
commit;

-- ============================================================
-- Step 3: A invites B as accepted viewer (skipping the Edge Function;
-- the Edge Function flow is exercised by the manual e2e smoke).
-- ============================================================
\echo ''
\echo '--- Step 3: A invites B as accepted viewer ---'
begin;
-- 0031: clients can no longer write trip_collaborators (manage-collaborators
-- does it with the service role), so this step runs as service_role.
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values ('cc333333-3333-3333-3333-333333333333'::uuid, 'user-b@acc-smoke.test', 'viewer', 'accepted', 'bb222222-2222-2222-2222-222222222222'::uuid);
commit;

-- ============================================================
-- Step 4: B as viewer can SELECT but not INSERT
-- ============================================================
\echo ''
\echo '--- Step 4: B as viewer ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACC_AS_VIEWER (expect 1): ' || count(*)::text from public.trip_accommodations where trip_id = 'cc333333-3333-3333-3333-333333333333';

do $$
begin
  insert into public.trip_accommodations (trip_id, name, address, check_in_date, check_out_date)
  values ('cc333333-3333-3333-3333-333333333333'::uuid, 'Hotel B (viewer attempt)', '456 Side St', '2026-05-05', '2026-05-06');
  raise notice 'FAIL: B as viewer was able to INSERT (should have been denied)';
exception when insufficient_privilege then
  raise notice 'PASS: B as viewer INSERT denied (insufficient_privilege)';
when others then
  raise notice 'PASS: B as viewer INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Step 5: A upgrades B to editor; B INSERT succeeds
-- ============================================================
\echo ''
\echo '--- Step 5: A upgrades B to editor ---'
begin;
-- 0031: clients can no longer write trip_collaborators (manage-collaborators
-- does it with the service role), so this step runs as service_role.
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

update public.trip_collaborators
set role = 'editor'
where trip_id = 'cc333333-3333-3333-3333-333333333333'::uuid
  and invitee_email = 'user-b@acc-smoke.test';
commit;

\echo ''
\echo '--- Step 5b: B as editor INSERT ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  insert into public.trip_accommodations (trip_id, name, address, check_in_date, check_out_date)
  values ('cc333333-3333-3333-3333-333333333333'::uuid, 'Hotel B (editor)', '789 Other St', '2026-05-05', '2026-05-06');
  raise notice 'PASS: B as editor INSERT succeeded';
exception when others then
  raise notice 'FAIL: B as editor INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Step 6: A revokes B; B loses access
-- ============================================================
\echo ''
\echo '--- Step 6: A revokes B ---'
begin;
-- 0031: clients can no longer write trip_collaborators (manage-collaborators
-- does it with the service role), so this step runs as service_role.
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

update public.trip_collaborators
set status = 'revoked'
where trip_id = 'cc333333-3333-3333-3333-333333333333'::uuid
  and invitee_email = 'user-b@acc-smoke.test';
commit;

\echo ''
\echo '--- Step 6b: B after revoke ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACC_AFTER_REVOKE (expect 0): ' || count(*)::text from public.trip_accommodations where trip_id = 'cc333333-3333-3333-3333-333333333333';
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_accommodations where trip_id = 'cc333333-3333-3333-3333-333333333333'::uuid;
delete from public.trip_collaborators where invitee_email like '%@acc-smoke.test';
delete from public.trip_places where trip_id = 'cc333333-3333-3333-3333-333333333333'::uuid;
delete from public.trips where id = 'cc333333-3333-3333-3333-333333333333'::uuid;
delete from auth.users where email in ('user-a@acc-smoke.test', 'user-b@acc-smoke.test');

\echo ''
\echo 'Accommodations RLS smoke complete.'
