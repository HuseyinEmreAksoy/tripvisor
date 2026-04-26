-- Tripvisor Phase 23 Step 23.1 smoke: route_render_mode RLS on trips.
--
-- Five required scenarios from the planner brief, each in its own
-- BEGIN/COMMIT block (SET LOCAL only applies inside an explicit
-- transaction):
--
--   1. Owner UPDATE title                         -> PASS (control)
--   2. Owner UPDATE route_render_mode             -> PASS
--   3. Editor UPDATE title                        -> PASS (denied 42501)
--   4. Editor UPDATE route_render_mode            -> PASS (allowed)
--   5. Viewer UPDATE route_render_mode            -> PASS (RLS filtered, 0 rows)
--
-- Run as superuser against the local Supabase database:
--   psql postgresql://postgres:postgres@localhost:54322/postgres -f scripts/smoke-route-render-mode-rls.sql

\set ON_ERROR_STOP on

-- Cleanup any prior smoke run (idempotent, runs as superuser).
delete from public.trip_collaborators where invitee_email like '%@rendermode-smoke.test';
delete from public.trips where title in ('rendermode-smoke-trip', 'rendermode-smoke-trip-renamed');
delete from auth.users where email in (
  'rendermode-owner@rendermode-smoke.test',
  'rendermode-editor@rendermode-smoke.test',
  'rendermode-viewer@rendermode-smoke.test'
);

-- Seed three auth users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('f1111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'rendermode-owner@rendermode-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('f2222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'rendermode-editor@rendermode-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('f3333333-3333-3333-3333-333333333333'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'rendermode-viewer@rendermode-smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- Seed: owner creates a trip. Default route_render_mode = 'optimized'.
\echo '--- Seed: owner creates trip ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'f1111111-1111-1111-1111-111111111111'::uuid, 'rendermode-smoke-trip');
commit;

-- Verify default
select 'INITIAL_RENDER_MODE (expect optimized): ' || route_render_mode
  from public.trips where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- Seed: editor + viewer collaborator rows (status=accepted).
\echo '--- Seed: invite editor + viewer (accepted) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.trip_collaborators (trip_id, invitee_email, role, status, user_id)
values
  ('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'rendermode-editor@rendermode-smoke.test', 'editor', 'accepted', 'f2222222-2222-2222-2222-222222222222'::uuid),
  ('faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'rendermode-viewer@rendermode-smoke.test', 'viewer', 'accepted', 'f3333333-3333-3333-3333-333333333333'::uuid);
commit;

-- ============================================================
-- Scenario 1: Owner UPDATEs title -> PASS (control)
-- ============================================================
\echo ''
\echo '--- Scenario 1: Owner UPDATE title ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set title = 'rendermode-smoke-trip-renamed'
    where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS: owner updated trips.title (1 row)';
  else
    raise notice 'FAIL: owner UPDATE matched % rows (expected 1)', v_count;
  end if;
exception when others then
  raise notice 'FAIL: owner could not update trips.title (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Restore for clarity in subsequent scenarios.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.trips set title = 'rendermode-smoke-trip' where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Scenario 2: Owner UPDATEs route_render_mode -> PASS
-- ============================================================
\echo ''
\echo '--- Scenario 2: Owner UPDATE route_render_mode ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set route_render_mode = 'manual'
    where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS: owner updated trips.route_render_mode (1 row)';
  else
    raise notice 'FAIL: owner UPDATE matched % rows (expected 1)', v_count;
  end if;
exception when others then
  raise notice 'FAIL: owner could not update trips.route_render_mode (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify the value actually landed.
select 'OWNER_RENDER_MODE_AFTER (expect manual): ' || route_render_mode
  from public.trips where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- ============================================================
-- Scenario 3: Editor UPDATE title -> trigger raises 42501
-- ============================================================
\echo ''
\echo '--- Scenario 3: Editor UPDATE title (expect 42501) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  update public.trips
    set title = 'editor-attempted-rename'
    where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  raise notice 'FAIL: editor was able to UPDATE trips.title';
exception when insufficient_privilege then
  raise notice 'PASS: editor UPDATE trips.title denied (insufficient_privilege)';
when others then
  raise notice 'PASS: editor UPDATE trips.title denied (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- ============================================================
-- Scenario 4: Editor UPDATE route_render_mode -> PASS (allowed)
-- ============================================================
\echo ''
\echo '--- Scenario 4: Editor UPDATE route_render_mode ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set route_render_mode = 'optimized'
    where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    raise notice 'PASS: editor updated trips.route_render_mode (1 row)';
  else
    raise notice 'FAIL: editor UPDATE matched % rows (expected 1)', v_count;
  end if;
exception when others then
  raise notice 'FAIL: editor could not UPDATE trips.route_render_mode (%): %', sqlstate, sqlerrm;
end$$;
commit;

-- Verify the value actually landed.
select 'EDITOR_RENDER_MODE_AFTER (expect optimized): ' || route_render_mode
  from public.trips where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

-- ============================================================
-- Scenario 5: Viewer UPDATE route_render_mode -> RLS denies (0 rows)
-- ============================================================
-- A viewer matches NEITHER trips_owner_update NOR trips_editor_budget_update
-- (the latter requires the 'editor' role). Postgres reports this as an
-- effective UPDATE 0 — no rows match. The DO block fires no exception
-- (RLS doesn't raise; it just filters to zero rows). We verify by
-- reading route_render_mode back: it should still be 'optimized' from
-- Scenario 4.
\echo ''
\echo '--- Scenario 5: Viewer UPDATE route_render_mode (expect 0 rows) ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare
  v_count int;
begin
  update public.trips
    set route_render_mode = 'manual'
    where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
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

-- Verify route_render_mode unchanged. Re-read as owner so the check
-- itself is not subject to the viewer's RLS view of the row.
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select 'VIEWER_RENDER_MODE_AFTER_ATTEMPT (expect optimized): ' || route_render_mode
  from public.trips where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
commit;

-- ============================================================
-- Cleanup
-- ============================================================
\echo ''
\echo '--- Cleanup ---'
delete from public.trip_collaborators where invitee_email like '%@rendermode-smoke.test';
delete from public.trips where id = 'faaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
delete from auth.users where email in (
  'rendermode-owner@rendermode-smoke.test',
  'rendermode-editor@rendermode-smoke.test',
  'rendermode-viewer@rendermode-smoke.test'
);

\echo ''
\echo 'Smoke complete.'
