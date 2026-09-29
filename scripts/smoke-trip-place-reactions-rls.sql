-- Phase 24 Step 24.1 RLS smoke test for trip_place_reactions.
--
-- Eight scenarios exercising the SELECT / INSERT / UPDATE / DELETE
-- policies on `public.trip_place_reactions`:
--
--   1. User A reacts to a place in their own trip            -> INSERT succeeds
--   2. User A toggles the same row from liked to disliked    -> UPDATE succeeds
--   3. User A inserts a SECOND row for the same place        -> unique violation (23505)
--   4. User B with NO access tries to INSERT                 -> insufficient_privilege (42501)
--   5. User B as accepted viewer INSERTs their OWN row       -> succeeds
--   6. User B as accepted viewer SELECTs                     -> sees BOTH rows (theirs + A's)
--   7. User B tries to UPDATE A's row                        -> 0 rows affected (silent RLS skip)
--   8. User A DELETEs their own row                          -> succeeds
--
-- Each user-scoped step runs inside an explicit BEGIN/COMMIT so SET LOCAL
-- ROLE / request.jwt.claims actually take effect (matches the pattern in
-- smoke-collab-rls.sql and smoke-collab-accommodations.sql).

\set ON_ERROR_STOP on

-- ============================================================
-- Idempotent cleanup of any prior smoke run (runs as superuser).
-- ============================================================
delete from public.trip_place_reactions
  where trip_place_id in (
    select id from public.trip_places
    where trip_id in (select id from public.trips where title = 'reactions-smoke-trip')
  );
delete from public.trip_collaborators where invitee_email like '%@reactions-smoke.test';
delete from public.trip_places where trip_id in (select id from public.trips where title = 'reactions-smoke-trip');
delete from public.trips where title = 'reactions-smoke-trip';
delete from auth.users where email in ('user-a@reactions-smoke.test', 'user-b@reactions-smoke.test');

-- Seed two auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-a@reactions-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'user-b@reactions-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- ============================================================
-- Setup: User A creates trip + place (as superuser to avoid muddling
-- the per-step RLS expectations; the place creation itself is RLS-
-- gated and is exercised by smoke-collab-rls.sql).
-- ============================================================
\echo '--- Setup: A creates trip + place ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'reactions-smoke-trip');

insert into public.trip_places (id, trip_id, google_place_id, lat, lng)
values ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'GPID-REACTIONS-1', 41.9, 12.5);
commit;

-- ============================================================
-- Scenario 1: A INSERTs a 'liked' reaction
-- ============================================================
\echo ''
\echo '--- Scenario 1: A inserts liked reaction ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

do $$
begin
  insert into public.trip_place_reactions (id, trip_place_id, user_id, reaction)
  values ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'::uuid, 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'liked');
  raise notice 'PASS scenario 1: A INSERT succeeded';
exception when others then
  raise notice 'FAIL scenario 1: A INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 2: A toggles their reaction from liked -> disliked
-- ============================================================
\echo ''
\echo '--- Scenario 2: A toggles to disliked ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

with upd as (
  update public.trip_place_reactions
  set reaction = 'disliked'
  where id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'
  returning 1
)
select 'A_TOGGLE_ROWS (expect 1): ' || count(*)::text from upd;
commit;

-- Verify the row is now disliked
\echo '--- Scenario 2 verify ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

select 'A_REACTION_VALUE (expect disliked): ' || reaction
from public.trip_place_reactions
where id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
commit;

-- ============================================================
-- Scenario 3: A inserts a SECOND row for the same place -> unique violation
-- ============================================================
\echo ''
\echo '--- Scenario 3: A duplicate INSERT (expect unique_violation 23505) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

do $$
begin
  insert into public.trip_place_reactions (trip_place_id, user_id, reaction)
  values ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'liked');
  raise notice 'FAIL scenario 3: duplicate INSERT was allowed';
exception when unique_violation then
  raise notice 'PASS scenario 3: unique constraint enforced (unique_violation)';
when others then
  raise notice 'FAIL scenario 3: unexpected error (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 4: User B with NO access tries to INSERT -> RLS denies
-- ============================================================
\echo ''
\echo '--- Scenario 4: B with no access attempts INSERT (expect 42501) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

do $$
begin
  insert into public.trip_place_reactions (trip_place_id, user_id, reaction)
  values ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, 'liked');
  raise notice 'FAIL scenario 4: B without access was able to INSERT';
exception when insufficient_privilege then
  raise notice 'PASS scenario 4: B without access INSERT denied (insufficient_privilege)';
when others then
  raise notice 'PASS scenario 4: B without access INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Setup for Scenario 5+: A invites B as accepted viewer
-- ============================================================
\echo ''
\echo '--- Setup: A invites B as accepted viewer ---'
begin;
-- 0031: clients can no longer write trip_collaborators (manage-collaborators
-- does it with the service role), so this step runs as service_role.
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, 'user-b@reactions-smoke.test', 'viewer', 'accepted', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid);
commit;

-- ============================================================
-- Scenario 5: B as accepted VIEWER inserts their OWN reaction -> succeeds
-- (Reactions accept viewer-level access — read-only collaborators can react.)
-- ============================================================
\echo ''
\echo '--- Scenario 5: B as accepted viewer INSERTs own reaction ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

do $$
begin
  insert into public.trip_place_reactions (id, trip_place_id, user_id, reaction)
  values ('f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6'::uuid, 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, 'liked');
  raise notice 'PASS scenario 5: B as viewer INSERT succeeded';
exception when others then
  raise notice 'FAIL scenario 5: B as viewer INSERT denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 6: B as accepted viewer SELECTs reactions -> sees both rows
-- ============================================================
\echo ''
\echo '--- Scenario 6: B as viewer sees both reactions (expect 2) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

select 'B_SEES_REACTIONS (expect 2): ' || count(*)::text
from public.trip_place_reactions
where trip_place_id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
commit;

-- ============================================================
-- Scenario 7: B tries to UPDATE A's reaction -> 0 rows affected (silent RLS)
-- ============================================================
\echo ''
\echo '--- Scenario 7: B attempts to UPDATE A''s reaction (expect 0 rows) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2","role":"authenticated"}';

with upd as (
  update public.trip_place_reactions
  set reaction = 'liked'
  where id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'
  returning 1
)
select 'B_UPDATES_A_ROWS (expect 0): ' || count(*)::text from upd;
commit;

-- Verify A's row is still 'disliked'
\echo '--- Scenario 7 verify A''s row unchanged ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

select 'A_ROW_STILL (expect disliked): ' || reaction
from public.trip_place_reactions
where id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
commit;

-- ============================================================
-- Scenario 8: A DELETEs their own reaction -> succeeds
-- ============================================================
\echo ''
\echo '--- Scenario 8: A deletes own reaction (expect 1 row) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1","role":"authenticated"}';

with del as (
  delete from public.trip_place_reactions
  where id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'
  returning 1
)
select 'A_DELETE_ROWS (expect 1): ' || count(*)::text from del;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_place_reactions
  where trip_place_id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid;
delete from public.trip_collaborators where invitee_email like '%@reactions-smoke.test';
delete from public.trip_places where id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid;
delete from public.trips where id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid;
delete from auth.users where email in ('user-a@reactions-smoke.test', 'user-b@reactions-smoke.test');

\echo ''
\echo 'trip_place_reactions RLS smoke complete.'
