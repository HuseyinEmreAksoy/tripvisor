-- m5_wave1_fixes_0038.sql: assertions for 0038_v2_m5_wave1_fixes.sql (the
-- Wave-1 review fixes #1, #4, #5, #8, #9, #11).
--
-- Plain SQL (not pgTAP), same style as memories_0036_0037.sql. Every check
-- runs as the real role (authenticated / anon / service_role with
-- request.jwt.claims) and RAISEs on failure, so psql with ON_ERROR_STOP exits
-- non-zero. Everything runs in ONE transaction that is rolled back (Storage
-- rows are metadata only; no bytes are written). Data-independent: no
-- check assumes an empty table or an empty bucket.
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/m5_wave1_fixes_0038.sql
--
-- Storage uploads are simulated the way storage-api runs its RLS check: an
-- INSERT into storage.objects as the uploader. storage-api's permission test
-- carries metadata {mimetype, contentLength} (no size yet); the tests that
-- must LAND an object also carry `size` so it counts afterwards.
--
-- Cast (fixed ids, all rolled back):
--   A  owner of trip T (places P1, P2) and trip T2 (money)
--   B  accepted EDITOR on T
--   V  accepted VIEWER on T
--   R  REVOKED viewer on T
--   N  non-member

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;

-- ------------------------------------------------------------------
-- Test helpers (schema created inside the transaction, rolled back)
-- ------------------------------------------------------------------
create schema tv_test;
grant usage on schema tv_test to authenticated, anon, service_role;

create function tv_test.act_as(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- p_sql MUST fail with p_state (and message LIKE p_msg if given).
create function tv_test.expect_error(p_label text, p_sql text, p_state text, p_msg text default null)
returns void language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  if v_state is null then
    raise exception 'FAIL %: statement succeeded: %', p_label, p_sql;
  end if;
  if v_state <> p_state or (p_msg is not null and v_msg not like p_msg) then
    raise exception 'FAIL %: expected % "%", got % "%"', p_label, p_state, coalesce(p_msg, '*'), v_state, v_msg;
  end if;
  raise notice 'PASS %: % (%)', p_label, v_msg, v_state;
end;
$$;

-- p_sql MUST raise quota_exceeded / storage_full with details.scope = p_scope.
create function tv_test.expect_quota(p_label text, p_sql text, p_msg text, p_scope text)
returns void language plpgsql as $$
declare
  v_msg    text;
  v_detail text;
begin
  begin
    execute p_sql;
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  end;
  if v_msg is null then
    raise exception 'FAIL %: statement succeeded: %', p_label, p_sql;
  end if;
  if v_msg <> p_msg or (v_detail::jsonb)->>'scope' is distinct from p_scope then
    raise exception 'FAIL %: expected % {scope: %}, got % %', p_label, p_msg, p_scope, v_msg, v_detail;
  end if;
  raise notice 'PASS %: % %', p_label, v_msg, v_detail;
end;
$$;

-- SELECT count(*) of p_sql must equal p_expected.
create function tv_test.expect_count(p_label text, p_sql text, p_expected bigint)
returns void language plpgsql as $$
declare
  n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  if n is distinct from p_expected then
    raise exception 'FAIL %: expected % row(s), got %', p_label, p_expected, n;
  end if;
  raise notice 'PASS %: % row(s)', p_label, n;
end;
$$;

-- DML p_sql must affect exactly p_expected rows (and not raise).
create function tv_test.expect_rows(p_label text, p_sql text, p_expected bigint)
returns void language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n is distinct from p_expected then
    raise exception 'FAIL %: expected % affected row(s), got %', p_label, p_expected, n;
  end if;
  raise notice 'PASS %: % row(s) affected', p_label, n;
end;
$$;

grant execute on all functions in schema tv_test to authenticated, anon, service_role;

-- ------------------------------------------------------------------
-- Seed (as postgres: bypasses RLS)
-- ------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('038a0000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@fix0038.test',    'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('038a0000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@fix0038.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('038a0000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@fix0038.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('038a0000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revoked@fix0038.test',  'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('038a0000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@fix0038.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', '');

insert into public.trips (id, user_id, title, currency) values
  ('038b0000-0000-4000-8000-0000000000a1', '038a0000-0000-4000-8000-00000000000a', 'fix0038 trip T',  'TRY'),
  ('038b0000-0000-4000-8000-0000000000a2', '038a0000-0000-4000-8000-00000000000a', 'fix0038 money T2', 'TRY');

insert into public.trip_places (id, trip_id, google_place_id, user_title, lat, lng) values
  ('038c0000-0000-4000-8000-0000000000a1', '038b0000-0000-4000-8000-0000000000a1', 'GPID-FIX0038-P1', 'Galata Tower', 41.0256, 28.9742),
  ('038c0000-0000-4000-8000-0000000000a2', '038b0000-0000-4000-8000-0000000000a1', 'GPID-FIX0038-P2', null,           41.0086, 28.9802);

insert into public.trip_collaborators (id, trip_id, invitee_email, user_id, role, status) values
  ('038d0000-0000-4000-8000-0000000000e1', '038b0000-0000-4000-8000-0000000000a1', 'editor@fix0038.test',  '038a0000-0000-4000-8000-00000000000e', 'editor', 'accepted'),
  ('038d0000-0000-4000-8000-0000000000f1', '038b0000-0000-4000-8000-0000000000a1', 'viewer@fix0038.test',  '038a0000-0000-4000-8000-00000000000f', 'viewer', 'accepted'),
  ('038d0000-0000-4000-8000-0000000000c1', '038b0000-0000-4000-8000-0000000000a1', 'revoked@fix0038.test', '038a0000-0000-4000-8000-00000000000c', 'viewer', 'revoked');

-- Small, explicit limits for the quota sections (absent key = default).
insert into public.app_config (key, value) values
  ('memories_user_cap',         '100'),
  ('memories_trip_cap',         '100'),
  ('memories_user_bytes_cap',   '400000'),
  ('memories_user_pending_cap', '3')
on conflict (key) do update set value = excluded.value;
delete from public.app_config where key = 'memories_storage_guard_bytes';

\echo '=== Q. #1 per-author BYTE quota (row trigger + Storage policy) ==='

set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null

-- q1: 300000 + 40000 bytes, ready.
insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000001', '038b0000-0000-4000-8000-0000000000a1');
select tv_test.expect_rows('Q1 author stores q1 (300000 B + 40000 B thumb)',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000001.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"size": 300000, "contentLength": 300000, "mimetype": "image/jpeg"}'),
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000001_t.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"size": 40000, "contentLength": 40000, "mimetype": "image/jpeg"}')$$, 2) \g /dev/null
update public.trip_photos set status = 'ready' where id = '038f0000-0000-4000-8000-000000000001';
select tv_test.expect_count('Q2 get_memory_quota reports bytes from Storage + the new keys',
  $$select 1 from public.get_memory_quota() q
     where (q->>'user_bytes')::bigint = 340000 and (q->>'user_bytes_cap')::bigint = 400000
       and (q->>'user_pending')::int = 0 and (q->>'user_pending_cap')::int = 3
       and (q->>'user_used')::int = 1$$, 1) \g /dev/null

select tv_test.expect_rows('Q3 a new photo row is accepted below the byte cap (340000 < 400000)',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000002', '038b0000-0000-4000-8000-0000000000a1')$$, 1) \g /dev/null
select tv_test.expect_error('Q4 Storage policy refuses an object whose declared contentLength crosses the byte cap',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000002.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"contentLength": 100000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_rows('Q5 a smaller object fits (390000 <= 400000)',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000002.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"size": 50000, "contentLength": 50000, "mimetype": "image/jpeg"}')$$, 1) \g /dev/null
select tv_test.expect_error('Q6 thumbnail that would cross the cap is refused',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000002_t.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"contentLength": 20000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_rows('Q7 thumbnail landing exactly on the cap is accepted (400000)',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000002_t.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"size": 10000, "contentLength": 10000, "mimetype": "image/jpeg"}')$$, 1) \g /dev/null
select tv_test.expect_rows('Q8 q2 -> ready',
  $$update public.trip_photos set status = 'ready' where id = '038f0000-0000-4000-8000-000000000002'$$, 1) \g /dev/null
select tv_test.expect_quota('Q9 at the byte cap a new photo row is refused',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a1')$$,
  'quota_exceeded', 'user_bytes') \g /dev/null

-- The finding: a tombstone / hard delete freed the slot while the objects stayed.
select tv_test.expect_rows('Q10 author tombstones q1 (its objects stay in Storage)',
  $$update public.trip_photos set deleted = true where id = '038f0000-0000-4000-8000-000000000001'$$, 1) \g /dev/null
select tv_test.expect_quota('Q11 a TOMBSTONED photo keeps counting until its objects are gone',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a1')$$,
  'quota_exceeded', 'user_bytes') \g /dev/null
select tv_test.expect_count('Q12 quota RPC: bytes unchanged, the tombstoned photo still holds a slot',
  $$select 1 from public.get_memory_quota() q
     where (q->>'user_bytes')::bigint = 400000 and (q->>'user_used')::int = 2$$, 1) \g /dev/null
select tv_test.expect_rows('Q13 author hard-deletes the q1 row (objects stay: orphans)',
  $$delete from public.trip_photos where id = '038f0000-0000-4000-8000-000000000001'$$, 1) \g /dev/null
select tv_test.expect_quota('Q14 ORPHANED objects of a hard-deleted row keep counting',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a1')$$,
  'quota_exceeded', 'user_bytes') \g /dev/null
select tv_test.expect_count('Q15 the orphan still holds its photo slot (user_used = 2)',
  $$select 1 from public.get_memory_quota() q where (q->>'user_used')::int = 2$$, 1) \g /dev/null

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
select tv_test.expect_count('Q16 sweep candidates list the orphaned q1 objects',
  $$select 1 from public.trip_memories_sweep_candidates(interval '-1 hour', 1000)
     where name like '%/038f0000-0000-4000-8000-000000000001%'$$, 2) \g /dev/null
select tv_test.expect_count('Q17 sweep candidates never list objects that still have a row (q2)',
  $$select 1 from public.trip_memories_sweep_candidates(interval '-1 hour', 1000)
     where name like '%/038f0000-0000-4000-8000-000000000002%'$$, 0) \g /dev/null
select tv_test.expect_count('Q18 the default 1 h minimum age protects fresh orphans (retry re-insert window)',
  $$select 1 from public.trip_memories_sweep_candidates()
     where name like '%/038f0000-0000-4000-8000-000000000001%'$$, 0) \g /dev/null
reset role;

set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select set_config('storage.allow_delete_query', 'true', true) \g /dev/null
select tv_test.expect_rows('Q19 author removes the orphaned objects (own folder)',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name like '%/038f0000-0000-4000-8000-000000000001%'$$, 2) \g /dev/null
select set_config('storage.allow_delete_query', 'false', true) \g /dev/null
select tv_test.expect_rows('Q20 ... and only then is the space free again',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a1')$$, 1) \g /dev/null
select tv_test.expect_count('Q21 quota RPC after the cleanup: 60000 B, 2 photos, 1 pending',
  $$select 1 from public.get_memory_quota() q
     where (q->>'user_bytes')::bigint = 60000 and (q->>'user_used')::int = 2 and (q->>'user_pending')::int = 1$$, 1) \g /dev/null

-- Per-object 1 MiB now also reads contentLength (storage-api's permission
-- test has no `size`). Raise the byte cap so only the per-object rule applies.
reset role;
update public.app_config set value = '10485760' where key = 'memories_user_bytes_cap';
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_error('Q22 an object declared over 1 MiB (contentLength) is refused',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000003.jpg',
       '038a0000-0000-4000-8000-00000000000a', '{"contentLength": 2000000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
reset role;
update public.app_config set value = '400000' where key = 'memories_user_bytes_cap';
set local role authenticated;

-- The policy gate answers only for the caller's own folder.
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('Q23 upload gate is false for someone else''s folder (no oracle)',
  $$select 1 where public.trip_memories_upload_allowed(
      '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000a/038f0000-0000-4000-8000-000000000003.jpg', '{}') = false$$, 1) \g /dev/null
select tv_test.expect_error('Q24 authenticated cannot call the byte counters directly',
  $$select public.trip_memories_author_bytes('038a0000-0000-4000-8000-00000000000a')$$, '42501') \g /dev/null
select tv_test.expect_error('Q25 authenticated cannot list sweep candidates',
  $$select * from public.trip_memories_sweep_candidates()$$, '42501') \g /dev/null

\echo '=== G. #1 global Storage guard, now also in the Storage policy ==='

insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000011', '038b0000-0000-4000-8000-0000000000a1');
reset role;
-- Guard = whatever is stored right now + 1000 bytes (data-independent).
insert into public.app_config (key, value)
select 'memories_storage_guard_bytes', (public.trip_memories_storage_total_bytes() + 1000)::text
on conflict (key) do update set value = excluded.value;
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_error('G1 an object that would cross the GLOBAL guard is refused by the Storage policy',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000e/038f0000-0000-4000-8000-000000000011.jpg',
       '038a0000-0000-4000-8000-00000000000e', '{"contentLength": 5000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_rows('G2 an object that still fits under the guard is accepted',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000e/038f0000-0000-4000-8000-000000000011.jpg',
       '038a0000-0000-4000-8000-00000000000e', '{"size": 600, "contentLength": 600, "mimetype": "image/jpeg"}')$$, 1) \g /dev/null
reset role;
update public.app_config set value = public.trip_memories_storage_total_bytes()::text
 where key = 'memories_storage_guard_bytes';
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_error('G3 with Storage at the guard even an object of unknown size is refused',
  $$insert into storage.objects (bucket_id, name, owner, metadata) values
      ('trip-memories', '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000e/038f0000-0000-4000-8000-000000000011_t.jpg',
       '038a0000-0000-4000-8000-00000000000e', null)$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_quota('G4 ... and the photo row insert says storage_full',
  $$insert into public.trip_photos (trip_id) values ('038b0000-0000-4000-8000-0000000000a1')$$,
  'storage_full', 'global') \g /dev/null
select tv_test.expect_count('G5 quota RPC reports storage_full',
  $$select 1 from public.get_memory_quota() q where (q->>'storage_full')::boolean$$, 1) \g /dev/null
reset role;
delete from public.app_config where key = 'memories_storage_guard_bytes';
set local role authenticated;

\echo '=== P. #1 pending cap (bounds the bytes in flight past the checks) ==='

select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
-- B: g1 pending already; cap 3.
insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000012', '038b0000-0000-4000-8000-0000000000a1');
insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000013', '038b0000-0000-4000-8000-0000000000a1');
select tv_test.expect_quota('P1 a 4th concurrent pending photo is refused',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000014', '038b0000-0000-4000-8000-0000000000a1')$$,
  'quota_exceeded', 'pending') \g /dev/null
select tv_test.expect_rows('P2 tombstoning a pending photo frees a pending slot',
  $$update public.trip_photos set deleted = true where id = '038f0000-0000-4000-8000-000000000013'$$, 1) \g /dev/null
select tv_test.expect_rows('P3 ... so the next one is accepted',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000014', '038b0000-0000-4000-8000-0000000000a1')$$, 1) \g /dev/null
select tv_test.expect_quota('P4 un-deleting a pending photo re-checks the pending cap',
  $$update public.trip_photos set deleted = false where id = '038f0000-0000-4000-8000-000000000013'$$,
  'quota_exceeded', 'pending') \g /dev/null
select tv_test.expect_count('P5 quota RPC reports the pending usage',
  $$select 1 from public.get_memory_quota() q where (q->>'user_pending')::int = 3 and (q->>'user_pending_cap')::int = 3$$, 1) \g /dev/null

\echo '=== S. #1 pending purge: rows go, objects become sweep candidates and keep counting ==='

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare n int;
begin
  n := public.purge_stale_pending_photos(interval '-1 second');
  if n < 4 then raise exception 'FAIL S1: expected >= 4 stale pending rows purged, got %', n; end if;
  if exists (select 1 from public.trip_photos
              where trip_id = '038b0000-0000-4000-8000-0000000000a1' and status = 'pending') then
    raise exception 'FAIL S1: pending rows left on trip T';
  end if;
  if not exists (select 1 from public.trip_photos where id = '038f0000-0000-4000-8000-000000000002' and status = 'ready') then
    raise exception 'FAIL S1: a READY photo was purged';
  end if;
  raise notice 'PASS S1: % stale pending row(s) purged, ready rows kept', n;

  if not exists (select 1 from public.trip_memories_sweep_candidates(interval '-1 hour', 1000) c
                  where c.name = '038b0000-0000-4000-8000-0000000000a1/038a0000-0000-4000-8000-00000000000e/038f0000-0000-4000-8000-000000000011.jpg'
                    and c.bytes = 600) then
    raise exception 'FAIL S2: the purged row''s uploaded object is not a sweep candidate';
  end if;
  if public.trip_memories_author_bytes('038a0000-0000-4000-8000-00000000000e') <> 600 then
    raise exception 'FAIL S2: the purged row''s object stopped counting against its author';
  end if;
  raise notice 'PASS S2: purged row''s object is a sweep candidate and still counts (600 B)';
end $$;
reset role;

\echo '=== T. #11 per-trip cap counts current members only ==='

-- R (revoked) left two live photos behind (seeded as a server path).
insert into public.trip_photos (id, trip_id, author_id) values
  ('038f0000-0000-4000-8000-000000000021', '038b0000-0000-4000-8000-0000000000a1', '038a0000-0000-4000-8000-00000000000c'),
  ('038f0000-0000-4000-8000-000000000022', '038b0000-0000-4000-8000-0000000000a1', '038a0000-0000-4000-8000-00000000000c');
update public.app_config set value = '2' where key = 'memories_trip_cap';
set local role authenticated;
-- Live on T now: q2 (A) + R's two rows. Only q2 is by a current member.
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('T1 trip_used excludes the revoked member''s rows',
  $$select 1 from public.get_memory_quota('038b0000-0000-4000-8000-0000000000a1') q
     where (q->>'trip_used')::int = 1 and (q->>'trip_cap')::int = 2$$, 1) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('T2 an editor still fits under the trip cap (revoked rows do not take slots)',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000031', '038b0000-0000-4000-8000-0000000000a1')$$, 1) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_quota('T3 the cap still applies to current members',
  $$insert into public.trip_photos (id, trip_id) values ('038f0000-0000-4000-8000-000000000032', '038b0000-0000-4000-8000-0000000000a1')$$,
  'quota_exceeded', 'trip') \g /dev/null
reset role;
update public.trip_collaborators set status = 'accepted' where id = '038d0000-0000-4000-8000-0000000000c1';
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('T4 a re-accepted member''s rows count again',
  $$select 1 from public.get_memory_quota('038b0000-0000-4000-8000-0000000000a1') q where (q->>'trip_used')::int = 4$$, 1) \g /dev/null
reset role;
update public.trip_collaborators set status = 'revoked' where id = '038d0000-0000-4000-8000-0000000000c1';
delete from public.app_config where key in ('memories_user_cap', 'memories_trip_cap', 'memories_user_bytes_cap', 'memories_user_pending_cap');

\echo '=== M. #4 money: pending rows are excluded, never mis-converted ==='

-- Rates (base EUR) for 2026-07-01: TRY 35.5, USD 1.1. Nothing for GBP/CHF,
-- nothing at all on 2026-06-15.
insert into public.fx_rates (base, quote, rate_date, rate, source) values
  ('EUR', 'TRY', '2026-07-01', 35.5, 'fix0038'),
  ('EUR', 'USD', '2026-07-01', 1.1,  'fix0038')
on conflict (base, quote, rate_date) do update set rate = excluded.rate;
delete from public.fx_rates where rate_date in ('2026-07-01', '2026-06-15') and quote in ('GBP', 'CHF');

-- T2 (home TRY):
--   m1 EUR 10  actual     frozen 35 into TRY                 -> 350        (step 2)
--   m2 TRY 100 actual     home currency                      -> 100        (step 1)
--   m3 USD 20  estimated  rate pending, fx_date 07-01         -> 20*35.5/1.1 (step 3)
--   m4 GBP 7   actual     frozen 0.85 into OLD home EUR, no rates on 06-15 -> PENDING
--   m5 EUR 3   actual     no rate, no fx_date                -> PENDING
--   m6 CHF 50  estimated  frozen 1.05 into OLD home EUR, no CHF rate        -> PENDING
--   m7 EUR 999 actual     tombstoned                         -> ignored (not pending)
insert into public.trip_expenses (id, trip_id, category, amount, kind, currency, fx_rate, fx_date, fx_home_currency, deleted) values
  ('0381e000-0000-4000-8000-000000000001', '038b0000-0000-4000-8000-0000000000a2', 'food',      10,  'actual',    'EUR', 35,   '2026-07-01', 'TRY', false),
  ('0381e000-0000-4000-8000-000000000002', '038b0000-0000-4000-8000-0000000000a2', 'transport', 100, 'actual',    'TRY', 1,    '2026-07-01', 'TRY', false),
  ('0381e000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a2', 'shopping',  20,  'estimated', 'USD', null, '2026-07-01', 'TRY', false),
  ('0381e000-0000-4000-8000-000000000004', '038b0000-0000-4000-8000-0000000000a2', 'food',      7,   'actual',    'GBP', 0.85, '2026-06-15', 'EUR', false),
  ('0381e000-0000-4000-8000-000000000005', '038b0000-0000-4000-8000-0000000000a2', 'other',     3,   'actual',    'EUR', null, null,         null,  false),
  ('0381e000-0000-4000-8000-000000000006', '038b0000-0000-4000-8000-0000000000a2', 'other',     50,  'estimated', 'CHF', 1.05, '2026-07-01', 'EUR', false),
  ('0381e000-0000-4000-8000-000000000007', '038b0000-0000-4000-8000-0000000000a2', 'food',      999, 'actual',    'EUR', 35,   '2026-07-01', 'TRY', true);

refresh materialized view public.analytics_user_trip_stats;

set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
do $$
declare s record;
begin
  select * into s from public.get_my_trip_stats() where trip_id = '038b0000-0000-4000-8000-0000000000a2';
  if s.total_actual_spend <> 450 then
    raise exception 'FAIL M1: actual = % (expected 450 = 350 + 100; pending rows excluded)', s.total_actual_spend;
  end if;
  if round(s.total_estimated_spend, 6) <> round(20 * 35.5 / 1.1, 6) then
    raise exception 'FAIL M1: estimated = % (expected 20*35.5/1.1)', s.total_estimated_spend;
  end if;
  if s.pending_count <> 3
     or s.pending_actual_by_currency <> '{"EUR": 3, "GBP": 7}'::jsonb
     or s.pending_estimated_by_currency <> '{"CHF": 50}'::jsonb then
    raise exception 'FAIL M1: pending = % / % / %', s.pending_count, s.pending_actual_by_currency, s.pending_estimated_by_currency;
  end if;
  raise notice 'PASS M1: frozen / home / re-derived rows convert; 3 pending rows reported per currency, not converted (0034 would have added 7*0.85 + 3 TRY)';
end $$;

-- The owner changes the home currency TRY -> GBP; no GBP rate is cached yet.
select tv_test.expect_rows('M2 owner changes the home currency to GBP',
  $$update public.trips set currency = 'GBP' where id = '038b0000-0000-4000-8000-0000000000a2'$$, 1) \g /dev/null
reset role;
refresh materialized view public.analytics_user_trip_stats;
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
do $$
declare s record;
begin
  select * into s from public.get_my_trip_stats() where trip_id = '038b0000-0000-4000-8000-0000000000a2';
  -- 0034 would report 7 + 10*35 + 100*1 + 3 = 460 "GBP" (TRY rates and 1:1).
  if s.total_actual_spend <> 7 then
    raise exception 'FAIL M3: actual after the home change = % (expected 7: only the GBP row converts; a TRY rate must never be applied to a GBP total)', s.total_actual_spend;
  end if;
  if s.total_estimated_spend <> 0 then
    raise exception 'FAIL M3: estimated after the home change = % (expected 0: both estimated rows are pending)', s.total_estimated_spend;
  end if;
  if s.pending_count <> 5
     or s.pending_actual_by_currency <> '{"EUR": 13, "TRY": 100}'::jsonb
     or s.pending_estimated_by_currency <> '{"USD": 20, "CHF": 50}'::jsonb then
    raise exception 'FAIL M3: pending = % / % / %', s.pending_count, s.pending_actual_by_currency, s.pending_estimated_by_currency;
  end if;
  raise notice 'PASS M3: after TRY -> GBP with no GBP rate, 5 rows are pending (incl. the old-home TRY row, never 1:1) and the total is GBP-only';
end $$;

-- Y3.2 warms fx-rates for the trip's fx_dates; the next refresh re-derives.
reset role;
insert into public.fx_rates (base, quote, rate_date, rate, source) values ('EUR', 'GBP', '2026-07-01', 0.85, 'fix0038')
on conflict (base, quote, rate_date) do update set rate = excluded.rate;
refresh materialized view public.analytics_user_trip_stats;
set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
do $$
declare s record;
begin
  select * into s from public.get_my_trip_stats() where trip_id = '038b0000-0000-4000-8000-0000000000a2';
  if round(s.total_actual_spend, 6) <> round(10 * 0.85 + 100 * 0.85 / 35.5 + 7, 6) then
    raise exception 'FAIL M4: actual after the warm-up = % (expected 10*0.85 + 100*0.85/35.5 + 7)', s.total_actual_spend;
  end if;
  if round(s.total_estimated_spend, 6) <> round(20 * 0.85 / 1.1, 6) then
    raise exception 'FAIL M4: estimated after the warm-up = % (expected 20*0.85/1.1)', s.total_estimated_spend;
  end if;
  if s.pending_count <> 2
     or s.pending_actual_by_currency <> '{"EUR": 3}'::jsonb
     or s.pending_estimated_by_currency <> '{"CHF": 50}'::jsonb then
    raise exception 'FAIL M4: pending = % / % / %', s.pending_count, s.pending_actual_by_currency, s.pending_estimated_by_currency;
  end if;
  raise notice 'PASS M4: once the GBP rate is cached the re-derived rows convert; only undatable / unrated rows stay pending';
end $$;
select tv_test.expect_count('M5 a trip with nothing pending reports 0 and {} (never NULL)',
  $$select 1 from public.get_my_trip_stats()
     where trip_id = '038b0000-0000-4000-8000-0000000000a1'
       and pending_count = 0 and pending_actual_by_currency = '{}'::jsonb and pending_estimated_by_currency = '{}'::jsonb$$, 1) \g /dev/null
select tv_test.expect_error('M6 the MV itself stays unreadable (get_my_trip_stats is the only path)',
  $$select 1 from public.analytics_user_trip_stats$$, '42501') \g /dev/null
reset role;

\echo '=== R. #5 reviews survive place removal ==='

set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('R1 owner reviews P1 (private) and tries to smuggle snapshot values',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, body, place_name_snapshot, place_google_id_snapshot)
    values ('038e0000-0000-4000-8000-000000000001', '038b0000-0000-4000-8000-0000000000a1', '038c0000-0000-4000-8000-0000000000a1',
            5, 'great view', 'evil name', 'evil id')$$, 1) \g /dev/null
select tv_test.expect_count('R2 snapshots are server-filled from the place (client values ignored)',
  $$select 1 from public.trip_place_reviews where id = '038e0000-0000-4000-8000-000000000001'
      and place_name_snapshot = 'Galata Tower' and place_google_id_snapshot = 'GPID-FIX0038-P1'$$, 1) \g /dev/null
select tv_test.expect_rows('R3 owner reviews P2 (shared; the place has no user title)',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, visibility)
    values ('038e0000-0000-4000-8000-000000000004', '038b0000-0000-4000-8000-0000000000a1', '038c0000-0000-4000-8000-0000000000a2', 3, 'trip')$$, 1) \g /dev/null
select tv_test.expect_count('R4 a place without a user title snapshots only the place id',
  $$select 1 from public.trip_place_reviews where id = '038e0000-0000-4000-8000-000000000004'
      and place_name_snapshot is null and place_google_id_snapshot = 'GPID-FIX0038-P2'$$, 1) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_rows('R5 viewer reviews P1 (shared)',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, body, visibility)
    values ('038e0000-0000-4000-8000-000000000002', '038b0000-0000-4000-8000-0000000000a1', '038c0000-0000-4000-8000-0000000000a1', 4, 'viewer notes', 'trip')$$, 1) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('R6 editor reviews P1 (private)',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, body)
    values ('038e0000-0000-4000-8000-000000000003', '038b0000-0000-4000-8000-0000000000a1', '038c0000-0000-4000-8000-0000000000a1', 2, 'editor secret')$$, 1) \g /dev/null

select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_error('R7 a client cannot detach a review (trip_place_id -> NULL)',
  $$update public.trip_place_reviews set trip_place_id = null where id = '038e0000-0000-4000-8000-000000000001'$$,
  '42501', 'immutable_column') \g /dev/null
select tv_test.expect_error('R8 a client cannot re-point a review to another place',
  $$update public.trip_place_reviews set trip_place_id = '038c0000-0000-4000-8000-0000000000a2' where id = '038e0000-0000-4000-8000-000000000001'$$,
  '42501', 'immutable_column') \g /dev/null
select tv_test.expect_error('R9 a new review still needs a place',
  $$insert into public.trip_place_reviews (trip_id, trip_place_id, rating) values ('038b0000-0000-4000-8000-0000000000a1', null, 4)$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
-- Rename the place AFTER the other reviews were written: the removal-time
-- refresh must still give every review the final title.
select tv_test.expect_rows('R10 owner renames P1',
  $$update public.trip_places set user_title = 'Galata Kulesi' where id = '038c0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null

-- The finding: an editor removing the place destroyed everyone's reviews.
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('R11 EDITOR hard-deletes place P1',
  $$delete from public.trip_places where id = '038c0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.trip_place_reviews
   where id in ('038e0000-0000-4000-8000-000000000001', '038e0000-0000-4000-8000-000000000002', '038e0000-0000-4000-8000-000000000003')
     and trip_place_id is null and not deleted
     and place_name_snapshot = 'Galata Kulesi' and place_google_id_snapshot = 'GPID-FIX0038-P1';
  if n <> 3 then
    raise exception 'FAIL R12: % of 3 reviews survived detached with the final snapshot', n;
  end if;
  if (select confdeltype from pg_constraint where conname = 'trip_place_reviews_trip_place_id_fkey') <> 'n' then
    raise exception 'FAIL R12: FK is not ON DELETE SET NULL';
  end if;
  if (select attnotnull from pg_attribute
       where attrelid = 'public.trip_place_reviews'::regclass and attname = 'trip_place_id') then
    raise exception 'FAIL R12: trip_place_id is still NOT NULL';
  end if;
  raise notice 'PASS R12: all 3 members'' reviews (private ones included) survive, detached, titled "Galata Kulesi"';
end $$;
set local role authenticated;

-- RLS still scopes detached reviews through their own trip_id.
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('R13 owner sees own detached review + the viewer''s shared one, not the editor''s private one',
  $$select 1 from public.trip_place_reviews where trip_id = '038b0000-0000-4000-8000-0000000000a1' and trip_place_id is null$$, 2) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('R14 editor sees own private detached review + the shared one',
  $$select 1 from public.trip_place_reviews where trip_id = '038b0000-0000-4000-8000-0000000000a1' and trip_place_id is null$$, 2) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_count('R15 non-member sees nothing',
  $$select 1 from public.trip_place_reviews where trip_id = '038b0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.act_as('038a0000-0000-4000-8000-00000000000c') \g /dev/null
select tv_test.expect_count('R16 revoked member sees nothing (no own reviews)',
  $$select 1 from public.trip_place_reviews where trip_id = '038b0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null

select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('R17 the author can still edit a detached review',
  $$update public.trip_place_reviews set body = 'still remember it', place_name_snapshot = 'hack'
     where id = '038e0000-0000-4000-8000-000000000001'$$, 1) \g /dev/null
select tv_test.expect_count('R18 ... and the frozen snapshot is kept (client value ignored)',
  $$select 1 from public.trip_place_reviews where id = '038e0000-0000-4000-8000-000000000001'
      and place_name_snapshot = 'Galata Kulesi' and body = 'still remember it'$$, 1) \g /dev/null
select tv_test.expect_count('R19 owner moderation still works on a detached shared review',
  $$select 1 from public.remove_trip_memory('review', '038e0000-0000-4000-8000-000000000002') ok where ok$$, 1) \g /dev/null
select tv_test.expect_rows('R20 the author can tombstone a detached review',
  $$update public.trip_place_reviews set deleted = true where id = '038e0000-0000-4000-8000-000000000001'$$, 1) \g /dev/null
reset role;

-- Deleting the whole trip still removes its reviews (trip_id CASCADE and the
-- place SET NULL run in the same statement). Probed in a subtransaction.
do $$
begin
  begin
    delete from public.trips where id = '038b0000-0000-4000-8000-0000000000a1';
    if exists (select 1 from public.trip_place_reviews where trip_id = '038b0000-0000-4000-8000-0000000000a1') then
      raise exception 'FAIL R21: reviews outlived their trip';
    end if;
    raise exception 'probe done' using errcode = 'TV001';
  exception when sqlstate 'TV001' then
    null;
  end;
  if not exists (select 1 from public.trips where id = '038b0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL R21: probe was not rolled back';
  end if;
  raise notice 'PASS R21: deleting the trip cascades its reviews cleanly (probe rolled back)';
end $$;

\echo '=== C9. #9 poi_cache / service_usage are service-role only ==='

set local role authenticated;
select tv_test.act_as('038a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_error('C9a authenticated cannot read poi_cache',     $$select 1 from public.poi_cache limit 1$$,     '42501') \g /dev/null
select tv_test.expect_error('C9b authenticated cannot read service_usage', $$select 1 from public.service_usage limit 1$$, '42501') \g /dev/null
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare n bigint;
begin
  select count(*) into n from public.poi_cache;
  select count(*) into n from public.service_usage;
  raise notice 'PASS C9c: service_role still reads both tables';
end $$;
reset role;
do $$
begin
  if exists (select 1 from pg_policy where polrelid in ('public.poi_cache'::regclass, 'public.service_usage'::regclass)) then
    raise exception 'FAIL C9d: a policy is left on poi_cache / service_usage';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.poi_cache'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.service_usage'::regclass) then
    raise exception 'FAIL C9d: RLS disabled on poi_cache / service_usage';
  end if;
  if has_table_privilege('authenticated', 'public.poi_cache', 'select')
     or has_table_privilege('authenticated', 'public.service_usage', 'select')
     or has_table_privilege('anon', 'public.poi_cache', 'select')
     or has_table_privilege('anon', 'public.service_usage', 'select') then
    raise exception 'FAIL C9d: a client role still has SELECT';
  end if;
  raise notice 'PASS C9d: no client grants, no policies, RLS on (default deny)';
end $$;

\echo '=== C8. #8 service_usage nightly purge ==='

do $$
declare
  v_cmd text;
  n     int;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'SKIP C8: pg_cron not installed on this stack';
    return;
  end if;
  select command into v_cmd from cron.job where jobname = 'tripvisor-service-usage-purge-nightly';
  if v_cmd is null then raise exception 'FAIL C8: cron job tripvisor-service-usage-purge-nightly missing'; end if;

  insert into public.service_usage (service, day, count) values
    ('fix0038test', current_date - 31, 5),
    ('fix0038test', current_date - 30, 5),
    ('fix0038test', current_date,      5)
  on conflict (service, day) do update set count = excluded.count;
  execute v_cmd;   -- exactly what pg_cron runs nightly
  select count(*) into n from public.service_usage where service = 'fix0038test';
  if n <> 2 or exists (select 1 from public.service_usage where service = 'fix0038test' and day = current_date - 31) then
    raise exception 'FAIL C8: purge kept % row(s) (expected 2: only the 31-day-old row goes)', n;
  end if;
  raise notice 'PASS C8: nightly job deletes counters older than 30 days, keeps the rest';
end $$;

\echo '=== X. EXECUTE matrix for the 0038 functions ==='

do $$
declare
  r   record;
  bad text := '';
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('memory_quota_limits', 'trip_memories_storage_total_bytes', 'trip_memories_author_bytes',
                        'trip_memories_author_usage', 'trip_memories_trip_photo_count', 'trip_memories_upload_allowed',
                        'trip_memories_sweep_candidates', 'get_memory_quota', 'trip_place_reviews_place_snapshot',
                        'trip_places_snapshot_reviews', 'trip_photos_enforce_quota', 'trip_memories_guard',
                        'get_my_trip_stats')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    bad := bad || r.fn || ' ';
  end loop;
  if bad <> '' then raise exception 'FAIL X1: anon has EXECUTE on: %', bad; end if;

  if has_function_privilege('authenticated', 'public.trip_memories_storage_total_bytes()', 'execute')
     or has_function_privilege('authenticated', 'public.trip_memories_author_bytes(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.trip_memories_author_usage(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.trip_memories_trip_photo_count(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.trip_memories_sweep_candidates(interval,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.trip_place_reviews_place_snapshot()', 'execute')
     or has_function_privilege('authenticated', 'public.trip_places_snapshot_reviews()', 'execute') then
    raise exception 'FAIL X2: a service-role-only / trigger function is executable by authenticated';
  end if;
  if not (has_function_privilege('authenticated', 'public.trip_memories_upload_allowed(text,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.memory_quota_limits()', 'execute')
      and has_function_privilege('authenticated', 'public.get_memory_quota(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.get_my_trip_stats()', 'execute')) then
    raise exception 'FAIL X3: authenticated lost EXECUTE on a client-facing function';
  end if;
  if not (has_function_privilege('service_role', 'public.trip_memories_sweep_candidates(interval,integer)', 'execute')
      and has_function_privilege('service_role', 'public.trip_memories_author_usage(uuid,uuid)', 'execute')
      and has_function_privilege('service_role', 'public.get_my_trip_stats()', 'execute')) then
    raise exception 'FAIL X4: service_role lost EXECUTE';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('trip_memories_storage_total_bytes', 'trip_memories_author_bytes', 'trip_memories_author_usage',
                                  'trip_memories_trip_photo_count', 'trip_memories_upload_allowed', 'trip_memories_sweep_candidates',
                                  'trip_place_reviews_place_snapshot', 'trip_places_snapshot_reviews')
                and (not p.prosecdef
                     or not coalesce(array_to_string(p.proconfig, ',') like '%search_path=public, pg_catalog%', false))) then
    raise exception 'FAIL X5: a 0038 helper is not SECURITY DEFINER with a pinned search_path';
  end if;
  raise notice 'PASS X1-X5: EXECUTE matrix as documented; definer helpers pin search_path';
end $$;

\echo '=== ALL m5_wave1_fixes_0038 CHECKS PASSED (rolling back) ==='
rollback;
