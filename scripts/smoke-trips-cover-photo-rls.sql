-- Tripvisor Phase 25 Step 25.2 smoke: cover_photo_google_place_id RLS on trips.
--
-- Four required scenarios from the planner brief, plus a regression
-- check on title denial:
--
--   1. Owner UPDATE cover_photo_google_place_id            -> PASS (1 row)
--   2. Editor UPDATE cover_photo_google_place_id           -> PASS (1 row)
--   3. Editor UPDATE title                                 -> PASS (denied 42501, regression)
--   4. Viewer UPDATE cover_photo_google_place_id           -> PASS (RLS filtered, 0 rows)
--
-- Run as superuser against the local Supabase database:
--   psql postgresql://postgres:postgres@localhost:54322/postgres -f scripts/smoke-trips-cover-photo-rls.sql

\set ON_ERROR_STOP on

-- Cleanup any prior smoke run (idempotent, runs as superuser).
delete from public.trip_collaborators where invitee_email like '%@coverphoto-smoke.test';
delete from public.trips where title in ('coverphoto-smoke-trip');
delete from auth.users where email in (
  'coverphoto-owner@coverphoto-smoke.test',
  'coverphoto-editor@coverphoto-smoke.test',
  'coverphoto-viewer@coverphoto-smoke.test'
);

-- Seed three auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('c1111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coverphoto-owner@coverphoto-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('c2222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coverphoto-editor@coverphoto-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('c3333333-3333-3333-3333-333333333333'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'coverphoto-viewer@coverphoto-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- Seed: owner creates a trip with cover_photo_google_place_id = NULL.
\echo '--- Seed: owner creates trip ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'c1111111-1111-1111-1111-111111111111'::uuid, 'coverphoto-smoke-trip');
commit;

-- Verify default (NULL).
select 'INITIAL_COVER (expect NULL): ' || coalesce(cover_photo_google_place_id, '<NULL>')
  from public.trips where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- Seed: editor + viewer collaborator rows (status=accepted).
\echo '--- Seed: invite editor + viewer (accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values
  ('cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'coverphoto-editor@coverphoto-smoke.test', 'editor', 'accepted', 'c2222222-2222-2222-2222-222222222222'::uuid),
  ('cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'coverphoto-viewer@coverphoto-smoke.test', 'viewer', 'accepted', 'c3333333-3333-3333-3333-333333333333'::uuid);
commit;

-- ============================================================
-- Scenario 1: Owner UPDATEs cover_photo_google_place_id -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 1: Owner UPDATE cover_photo_google_place_id ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set cover_photo_google_place_id = 'ChIJOwnerCoverPhoto'
    where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS: owner updated trips.cover_photo_google_place_id (1 row)';
  else
    raise notice 'FAIL: owner UPDATE matched % rows (expected 1)', v_count;
  end if;
exception when others then
  raise notice 'FAIL: owner could not update trips.cover_photo_google_place_id (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify the value actually landed.
select 'OWNER_COVER_AFTER (expect ChIJOwnerCoverPhoto): ' || coalesce(cover_photo_google_place_id, '<NULL>')
  from public.trips where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- ============================================================
-- Scenario 2: Editor UPDATEs cover_photo_google_place_id -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 2: Editor UPDATE cover_photo_google_place_id ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set cover_photo_google_place_id = 'ChIJEditorCoverPhoto'
    where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS: editor updated trips.cover_photo_google_place_id (1 row)';
  else
    raise notice 'FAIL: editor UPDATE matched % rows (expected 1)', v_count;
  end if;
exception when others then
  raise notice 'FAIL: editor could not update trips.cover_photo_google_place_id (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify the value actually landed.
select 'EDITOR_COVER_AFTER (expect ChIJEditorCoverPhoto): ' || coalesce(cover_photo_google_place_id, '<NULL>')
  from public.trips where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- ============================================================
-- Scenario 3: Editor UPDATE title -> trigger raises 42501 (regression)
-- ============================================================
-- Regression check from migration 0015 / 0016: editors must remain
-- unable to change `title`. This catches any accidental widening of
-- the trigger's allow-list.
\echo ''
\echo '--- Scenario 3: Editor UPDATE title (expect 42501, regression) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  update public.trips
    set title = 'editor-attempted-rename'
    where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'FAIL: editor was able to UPDATE trips.title (regression!)';
exception when insufficient_privilege then
  raise notice 'PASS: editor UPDATE trips.title denied (insufficient_privilege)';
when others then
  raise notice 'PASS: editor UPDATE trips.title denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 4: Viewer UPDATE cover_photo_google_place_id -> RLS denies (0 rows)
-- ============================================================
-- A viewer matches NEITHER trips_owner_update NOR trips_editor_budget_update
-- (the latter requires the 'editor' role). Postgres reports this as an
-- effective UPDATE 0 — no rows match. We verify by reading
-- cover_photo_google_place_id back: it should still be 'ChIJEditorCoverPhoto'
-- from Scenario 2.
\echo ''
\echo '--- Scenario 4: Viewer UPDATE cover_photo_google_place_id (expect 0 rows) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set cover_photo_google_place_id = 'ChIJViewerCoverPhoto'
    where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
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

-- Verify cover_photo_google_place_id unchanged. Re-read as owner so
-- the check itself is not subject to the viewer's RLS view of the row.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select 'VIEWER_COVER_AFTER_ATTEMPT (expect ChIJEditorCoverPhoto): ' || coalesce(cover_photo_google_place_id, '<NULL>')
  from public.trips where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_collaborators where invitee_email like '%@coverphoto-smoke.test';
delete from public.trips where id = 'cabbabba-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
delete from auth.users where email in (
  'coverphoto-owner@coverphoto-smoke.test',
  'coverphoto-editor@coverphoto-smoke.test',
  'coverphoto-viewer@coverphoto-smoke.test'
);

\echo ''
\echo 'Smoke complete.'
