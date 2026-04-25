-- Phase 21 Step 21.5/21.6 RLS smoke test.
-- Two-user scenario:
--   user A (owner) creates a trip and a place.
--   user B (collaborator) is initially blocked from seeing it.
--   Owner invites B as 'viewer'; B accepts -> B can SELECT but not INSERT.
--   Owner upgrades B to 'editor' -> B can INSERT.
--   Owner revokes B -> B loses access.
--
-- Each user-scoped step runs inside an explicit BEGIN/COMMIT block. SET
-- LOCAL only applies inside a transaction; without an explicit BEGIN,
-- "SET LOCAL ROLE authenticated" is a no-op and auth.uid() returns null,
-- which would defeat RLS and produce false positives.

\set ON_ERROR_STOP on

-- Clean up any prior smoke run (idempotent, runs as superuser).
delete from public.trip_collaborators where invitee_email like '%@smoke.test';
delete from public.trip_places where trip_id in (select id from public.trips where title = 'collab-smoke-trip');
delete from public.trips where title = 'collab-smoke-trip';
delete from auth.users where email in ('user-a@smoke.test', 'user-b@smoke.test');

-- Seed two auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-a@smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('22222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-b@smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- ============================================================
-- Step 1: User A creates a trip + place (as owner).
-- ============================================================
\echo '--- Step 1: User A creates trip + place ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'collab-smoke-trip');

insert into public.trip_places (id, trip_id, google_place_id, lat, lng)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'GPID-A-1', 1.0, 2.0);

select 'A_SEES_OWN_TRIP: ' || count(*)::text from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select 'A_SEES_OWN_PLACE: ' || count(*)::text from public.trip_places where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
commit;

-- ============================================================
-- Step 2: User B is blocked from seeing A's trip
-- ============================================================
\echo ''
\echo '--- Step 2: B has no access ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_TRIP_BEFORE_INVITE (expect 0): ' || count(*)::text from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select 'B_SEES_PLACES_BEFORE_INVITE (expect 0): ' || count(*)::text from public.trip_places where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
commit;

-- ============================================================
-- Step 3: A invites B as viewer (accepted directly to skip the
-- Edge Function in this DB-level smoke; the Edge Function flow is
-- exercised by manual e2e in dispatch step 21.14).
-- ============================================================
\echo ''
\echo '--- Step 3: A invites B as viewer (status=accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'user-b@smoke.test', 'viewer', 'accepted', '22222222-2222-2222-2222-222222222222'::uuid);
commit;

-- ============================================================
-- Step 4: B can SELECT but not INSERT (viewer)
-- ============================================================
\echo ''
\echo '--- Step 4: B as viewer ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_TRIP_AS_VIEWER (expect 1): ' || count(*)::text from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select 'B_SEES_PLACES_AS_VIEWER (expect 1): ' || count(*)::text from public.trip_places where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- B viewer attempts to insert -> should fail with 42501
do $$
begin
  insert into public.trip_places (trip_id, google_place_id, lat, lng)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'GPID-B-VIEWER', 3.0, 4.0);
  raise notice 'FAIL: B as viewer was able to INSERT (should have been denied)';
exception when insufficient_privilege then
  raise notice 'PASS: B as viewer INSERT denied (insufficient_privilege)';
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
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.trip_collaborators
set role = 'editor'
where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  and invitee_email = 'user-b@smoke.test';
commit;

-- ============================================================
-- Step 6: B as editor can INSERT
-- ============================================================
\echo ''
\echo '--- Step 6: B as editor ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  insert into public.trip_places (trip_id, google_place_id, lat, lng)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'GPID-B-EDITOR', 5.0, 6.0);
  raise notice 'PASS: B as editor INSERT succeeded';
exception when others then
  raise notice 'FAIL: B as editor INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Step 7: A revokes B; B loses access
-- ============================================================
\echo ''
\echo '--- Step 7: A revokes B ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

update public.trip_collaborators
set status = 'revoked'
where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
  and invitee_email = 'user-b@smoke.test';
commit;

\echo ''
\echo '--- Step 7b: B after revoke ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'B_SEES_TRIP_AFTER_REVOKE (expect 0): ' || count(*)::text from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select 'B_SEES_PLACES_AFTER_REVOKE (expect 0): ' || count(*)::text from public.trip_places where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

do $$
begin
  insert into public.trip_places (trip_id, google_place_id, lat, lng)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'GPID-B-AFTER-REVOKE', 7.0, 8.0);
  raise notice 'FAIL: B revoked was able to INSERT (should have been denied)';
exception when insufficient_privilege then
  raise notice 'PASS: B revoked INSERT denied (insufficient_privilege)';
when others then
  raise notice 'PASS: B revoked INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_collaborators where invitee_email like '%@smoke.test';
delete from public.trip_places where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
delete from auth.users where email in ('user-a@smoke.test', 'user-b@smoke.test');

\echo ''
\echo 'Smoke complete.'
