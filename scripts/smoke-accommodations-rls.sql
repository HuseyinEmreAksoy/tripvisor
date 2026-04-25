-- Phase 21 Step 21.7 follow-up: trip_accommodations RLS smoke test.
-- Verifies that 0013_trip_accommodations_rls_collab.sql wires the four
-- *_collab_* policies correctly: viewers can SELECT but not INSERT, editors
-- can INSERT, revoked invitees lose all access.
--
-- Mirrors scripts/smoke-collab-rls.sql in shape and seed users so the two
-- scripts can be run sequentially against the same local DB.

\set ON_ERROR_STOP on

-- Clean up any prior smoke run (idempotent, runs as superuser).
delete from public.trip_accommodations where trip_id in (select id from public.trips where title = 'accom-smoke-trip');
delete from public.trip_collaborators where invitee_email like '%@accom-smoke.test';
delete from public.trips where title = 'accom-smoke-trip';
delete from auth.users where email in ('user-a@accom-smoke.test', 'user-b@accom-smoke.test');

-- Seed two auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('aaaa1111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-a@accom-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('bbbb2222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-b@accom-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- ============================================================
-- Step 1: A creates a trip + accommodation
-- ============================================================
\echo '--- Step 1: A creates trip + accommodation ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('cccc3333-3333-3333-3333-333333333333'::uuid, 'aaaa1111-1111-1111-1111-111111111111'::uuid, 'accom-smoke-trip');

insert into public.trip_accommodations (id, trip_id, name, address, check_in_date, check_out_date)
values ('dddd4444-4444-4444-4444-444444444444'::uuid, 'cccc3333-3333-3333-3333-333333333333'::uuid, 'Hilton Smoke', '1 Smoke St', date '2026-05-01', date '2026-05-04');

select 'A_SEES_OWN_ACCOMMODATION (expect 1): ' || count(*)::text from public.trip_accommodations where id = 'dddd4444-4444-4444-4444-444444444444';
commit;

-- ============================================================
-- Step 2: B with no invite -> 0 accommodations
-- ============================================================
\echo ''
\echo '--- Step 2: B has no invite ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACCOMMODATIONS_NO_INVITE (expect 0): ' || count(*)::text from public.trip_accommodations where trip_id = 'cccc3333-3333-3333-3333-333333333333';
commit;

-- ============================================================
-- Step 3: A invites B as accepted viewer
-- ============================================================
\echo ''
\echo '--- Step 3: A invites B as viewer (status=accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values ('cccc3333-3333-3333-3333-333333333333'::uuid, 'user-b@accom-smoke.test', 'viewer', 'accepted', 'bbbb2222-2222-2222-2222-222222222222'::uuid);
commit;

-- ============================================================
-- Step 4: B as viewer can SELECT, INSERT denied (42501)
-- ============================================================
\echo ''
\echo '--- Step 4: B as viewer ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACCOMMODATIONS_AS_VIEWER (expect 1): ' || count(*)::text from public.trip_accommodations where trip_id = 'cccc3333-3333-3333-3333-333333333333';

do $$
begin
  insert into public.trip_accommodations (trip_id, name, check_in_date, check_out_date)
  values ('cccc3333-3333-3333-3333-333333333333'::uuid, 'B-VIEWER-INSERT', date '2026-05-05', date '2026-05-06');
  raise notice 'FAIL: B as viewer was able to INSERT (should have been denied)';
exception when insufficient_privilege then
  raise notice 'PASS: B as viewer INSERT denied (42501 insufficient_privilege)';
when others then
  raise notice 'PASS: B as viewer INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Step 5: A upgrades B to editor
-- ============================================================
\echo ''
\echo '--- Step 5: A upgrades B to editor ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.trip_collaborators
set role = 'editor'
where trip_id = 'cccc3333-3333-3333-3333-333333333333'::uuid
  and invitee_email = 'user-b@accom-smoke.test';
commit;

-- ============================================================
-- Step 6: B as editor can INSERT
-- ============================================================
\echo ''
\echo '--- Step 6: B as editor ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  insert into public.trip_accommodations (trip_id, name, check_in_date, check_out_date)
  values ('cccc3333-3333-3333-3333-333333333333'::uuid, 'B-EDITOR-INSERT', date '2026-05-05', date '2026-05-06');
  raise notice 'PASS: B as editor INSERT succeeded';
exception when others then
  raise notice 'FAIL: B as editor INSERT denied (%): %', sqlstate, sqlerrm;
end$$;

-- editor should also be able to UPDATE
do $$
begin
  update public.trip_accommodations
  set notes = 'edited by B'
  where trip_id = 'cccc3333-3333-3333-3333-333333333333'::uuid
    and name = 'Hilton Smoke';
  if found then
    raise notice 'PASS: B as editor UPDATE succeeded';
  else
    raise notice 'FAIL: B as editor UPDATE matched 0 rows (RLS USING denied)';
  end if;
exception when others then
  raise notice 'FAIL: B as editor UPDATE error (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Step 7: A revokes B
-- ============================================================
\echo ''
\echo '--- Step 7: A revokes B ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaa1111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.trip_collaborators
set status = 'revoked'
where trip_id = 'cccc3333-3333-3333-3333-333333333333'::uuid
  and invitee_email = 'user-b@accom-smoke.test';
commit;

\echo ''
\echo '--- Step 7b: B after revoke ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bbbb2222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_ACCOMMODATIONS_AFTER_REVOKE (expect 0): ' || count(*)::text from public.trip_accommodations where trip_id = 'cccc3333-3333-3333-3333-333333333333';

do $$
begin
  insert into public.trip_accommodations (trip_id, name, check_in_date, check_out_date)
  values ('cccc3333-3333-3333-3333-333333333333'::uuid, 'B-REVOKED-INSERT', date '2026-05-07', date '2026-05-08');
  raise notice 'FAIL: B revoked was able to INSERT (should have been denied)';
exception when insufficient_privilege then
  raise notice 'PASS: B revoked INSERT denied (42501 insufficient_privilege)';
when others then
  raise notice 'PASS: B revoked INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_accommodations where trip_id = 'cccc3333-3333-3333-3333-333333333333'::uuid;
delete from public.trip_collaborators where invitee_email like '%@accom-smoke.test';
delete from public.trips where id = 'cccc3333-3333-3333-3333-333333333333'::uuid;
delete from auth.users where email in ('user-a@accom-smoke.test', 'user-b@accom-smoke.test');

\echo ''
\echo 'Accommodations RLS smoke complete.'
