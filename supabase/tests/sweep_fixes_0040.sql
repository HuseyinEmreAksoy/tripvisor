-- sweep_fixes_0040.sql: assertions for 0040_v2_sweep_fixes.sql.
--   S  §1 consume_share_read (anonymous share-read rate limits)
--   W  §2 memories sweep: tombstoned > 7 days + the un-delete safety net
--   C  §3 account deletion removes trip_collaborators rows
--   R  §4 revoked members retract their own memories (and nothing else)
--   D  §5 duplicate_trip copies every user-authored column
--
-- Plain SQL, same style as m5_wave1_fixes_0038.sql: RAISE on failure, ONE
-- transaction, rolled back (Storage rows are metadata only).
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/sweep_fixes_0040.sql
--
-- Cast (fixed ids, all rolled back):
--   A  owner of trip T (places P1, P2, tombstoned P3)
--   V  accepted VIEWER on T
--   R  REVOKED viewer on T (authored memories while a member)
--   N  non-member
--   X  accepted viewer on T whose account gets deleted (§3)

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;

create schema tv_test;
grant usage on schema tv_test to authenticated, anon, service_role;

create function tv_test.act_as(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

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
  ('040a0000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@fix0040.test',    'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('040a0000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@fix0040.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('040a0000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revoked@fix0040.test',  'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('040a0000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@fix0040.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('040a0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leaver@fix0040.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', '');

insert into public.trips (id, user_id, title, currency, start_date, end_date, daily_hours_budget, transport_mode,
                          timezone, total_budget, cost_per_km, route_render_mode, cover_photo_google_place_id)
values ('040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000a', 'fix0040 trip T', 'TRY',
        '2026-10-01', '2026-10-04', 7.5, 'walking', 'Europe/Istanbul', 12345.67, 0.42, 'manual', 'GPID-FIX0040-COVER');

insert into public.trip_places (id, trip_id, google_place_id, user_title, category, lat, lng, visit_duration_minutes,
                                notes, day_index, order_in_day, arrive_after, leave_before, pinned_start,
                                manual_rank, arrival_mode, arrival_minutes, deleted)
values
  ('040c0000-0000-4000-8000-0000000000a1', '040b0000-0000-4000-8000-0000000000a1', 'GPID-FIX0040-P1', 'Galata Tower', 'attraction',
   41.0256, 28.9742, 75, 'buy tickets online', 0, 0, '09:00', '12:00', '09:30', 'a0', null, null, false),
  ('040c0000-0000-4000-8000-0000000000a2', '040b0000-0000-4000-8000-0000000000a1', 'GPID-FIX0040-P2', null, 'food',
   41.0086, 28.9802, 45, null, 1, 0, null, null, null, 'a1', 'ferry', 35, false),
  ('040c0000-0000-4000-8000-0000000000a3', '040b0000-0000-4000-8000-0000000000a1', 'GPID-FIX0040-P3', 'Deleted place', 'other',
   41.0, 28.9, 30, null, 1, 1, null, null, null, 'a2', null, null, true);

update public.trips set anchor_place_id = '040c0000-0000-4000-8000-0000000000a1'
 where id = '040b0000-0000-4000-8000-0000000000a1';

insert into public.trip_days (trip_id, day_index, day_start_place_id, day_end_place_id, notes, start_time, transport_mode, deleted)
values
  ('040b0000-0000-4000-8000-0000000000a1', 0, '040c0000-0000-4000-8000-0000000000a1', null, 'Old town day', '08:30', 'walking', false),
  ('040b0000-0000-4000-8000-0000000000a1', 1, null, '040c0000-0000-4000-8000-0000000000a2', 'Ferry day', '10:15', 'transit', false),
  ('040b0000-0000-4000-8000-0000000000a1', 2, null, null, 'deleted day', '07:00', null, true);

insert into public.trip_collaborators (id, trip_id, invitee_email, user_id, role, status) values
  ('040d0000-0000-4000-8000-0000000000f1', '040b0000-0000-4000-8000-0000000000a1', 'viewer@fix0040.test',  '040a0000-0000-4000-8000-00000000000f', 'viewer', 'accepted'),
  ('040d0000-0000-4000-8000-0000000000c1', '040b0000-0000-4000-8000-0000000000a1', 'revoked@fix0040.test', '040a0000-0000-4000-8000-00000000000c', 'viewer', 'revoked'),
  ('040d0000-0000-4000-8000-000000000001', '040b0000-0000-4000-8000-0000000000a1', 'leaver@fix0040.test',  '040a0000-0000-4000-8000-000000000001', 'viewer', 'accepted');

insert into public.trip_expenses (trip_id, category, amount, kind, currency)
values ('040b0000-0000-4000-8000-0000000000a1', 'food', 100, 'actual', 'TRY');

-- Memories written while R was still a member (server path: no JWT).
insert into public.trip_journal_entries (id, trip_id, author_id, day_index, body, visibility) values
  ('040e0000-0000-4000-8000-0000000000c1', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000c', 0, 'R shared note', 'trip'),
  ('040e0000-0000-4000-8000-0000000000f1', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000f', 0, 'V shared note', 'trip'),
  ('040e0000-0000-4000-8000-0000000000a1', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000a', 0, 'A shared note', 'trip');
insert into public.trip_place_reviews (id, trip_id, trip_place_id, author_id, rating, body, visibility) values
  ('040e1000-0000-4000-8000-0000000000c1', '040b0000-0000-4000-8000-0000000000a1', '040c0000-0000-4000-8000-0000000000a1',
   '040a0000-0000-4000-8000-00000000000c', 4, 'R review', 'trip');

\echo '=== S. §1 consume_share_read ==='
do $$
begin
  if has_function_privilege('anon', 'public.consume_share_read(text, text, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_share_read(text, text, integer, integer)', 'execute') then
    raise exception 'FAIL S1: consume_share_read must be service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.consume_share_read(text, text, integer, integer)', 'execute') then
    raise exception 'FAIL S2: service_role cannot execute consume_share_read';
  end if;
  if has_table_privilege('anon', 'public.share_read_counters', 'select')
     or has_table_privilege('authenticated', 'public.share_read_counters', 'select') then
    raise exception 'FAIL S3: share_read_counters must not be readable by clients';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'tripvisor-share-read-counters-purge') then
    raise exception 'FAIL S4: purge job not scheduled';
  end if;
  raise notice 'PASS S1-S4: ACL + purge job';
end $$;

set local role service_role;
do $$
declare
  r jsonb;
  n integer;
begin
  -- Token cap 2/day, IP cap 5/hour.
  r := public.consume_share_read('rt:040-share-one', 'ri:ip-one', 2, 5);
  if (r->>'allowed')::boolean is not true then raise exception 'FAIL S5: first read refused %', r; end if;
  r := public.consume_share_read('rt:040-share-one', 'ri:ip-one', 2, 5);
  if (r->>'allowed')::boolean is not true then raise exception 'FAIL S6: second read refused %', r; end if;
  r := public.consume_share_read('rt:040-share-one', 'ri:ip-one', 2, 5);
  if (r->>'allowed')::boolean or r->>'scope' <> 'token'
     or (r->>'retry_after')::int not between 1 and 86400 then
    raise exception 'FAIL S7: third read on a 2/day link must be refused (scope token, retry_after <= 1 day): %', r;
  end if;
  select count into n from public.share_read_counters where key = 'rt:040-share-one';
  if n <> 2 then raise exception 'FAIL S8: a refused call must consume nothing (token count %)', n; end if;
  select count into n from public.share_read_counters where key = 'ri:ip-one';
  if n <> 2 then raise exception 'FAIL S9: refused call must not count against the IP either (ip count %)', n; end if;

  -- IP cap 1/hour across two different links.
  r := public.consume_share_read('rt:040-share-two', 'ri:ip-two', 10, 1);
  if (r->>'allowed')::boolean is not true then raise exception 'FAIL S10: %', r; end if;
  r := public.consume_share_read('rt:040-share-three', 'ri:ip-two', 10, 1);
  if (r->>'allowed')::boolean or r->>'scope' <> 'ip' or (r->>'retry_after')::int not between 1 and 3600 then
    raise exception 'FAIL S11: the IP cap must refuse across links (scope ip, retry_after <= 1 h): %', r;
  end if;
  select count into n from public.share_read_counters where key = 'rt:040-share-three';
  if n <> 0 then raise exception 'FAIL S12: an IP-refused call consumed the link counter (%)', n; end if;

  -- No IP key (meta): only the link counter.
  r := public.consume_share_read('mt:040-share-two', null, 1, null);
  if (r->>'allowed')::boolean is not true then raise exception 'FAIL S13: %', r; end if;
  r := public.consume_share_read('mt:040-share-two', null, 1, null);
  if (r->>'allowed')::boolean then raise exception 'FAIL S14: meta cap ignored %', r; end if;
  raise notice 'PASS S5-S14: caps, scopes, retry_after, refusals consume nothing';
end $$;
select tv_test.expect_error('S15 a malformed key is rejected',
  $$select public.consume_share_read('bad key with spaces', null, 1, null)$$, '22023') \g /dev/null
reset role;

\echo '=== W. §2 sweep candidates: orphans + tombstones older than 7 days ==='
-- Three ready photos by A: live, tombstoned 8 days ago, tombstoned 1 day ago.
insert into storage.objects (bucket_id, name, owner, metadata, created_at)
select 'trip-memories',
       '040b0000-0000-4000-8000-0000000000a1/040a0000-0000-4000-8000-00000000000a/' || id || suffix,
       '040a0000-0000-4000-8000-00000000000a',
       '{"size": 1000, "mimetype": "image/jpeg"}', now() - interval '10 days'
  from (values ('040f0000-0000-4000-8000-000000000001'), ('040f0000-0000-4000-8000-000000000002'),
               ('040f0000-0000-4000-8000-000000000003'), ('040f0000-0000-4000-8000-000000000004')) v(id)
 cross join (values ('.jpg'), ('_t.jpg')) s(suffix);
insert into public.trip_photos (id, trip_id, author_id) values
  ('040f0000-0000-4000-8000-000000000001', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000a'),
  ('040f0000-0000-4000-8000-000000000002', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000a'),
  ('040f0000-0000-4000-8000-000000000003', '040b0000-0000-4000-8000-0000000000a1', '040a0000-0000-4000-8000-00000000000a');
-- ...000004 has objects but no row: an orphan.
update public.trip_photos set status = 'ready'
 where id in ('040f0000-0000-4000-8000-000000000001', '040f0000-0000-4000-8000-000000000002', '040f0000-0000-4000-8000-000000000003');
update public.trip_photos set deleted = true
 where id in ('040f0000-0000-4000-8000-000000000002', '040f0000-0000-4000-8000-000000000003');
-- Backdate the tombstones (updated_at is server-stamped; rolled back).
alter table public.trip_photos disable trigger trip_photos_handle_times;
update public.trip_photos set updated_at = now() - interval '8 days' where id = '040f0000-0000-4000-8000-000000000002';
update public.trip_photos set updated_at = now() - interval '1 day'  where id = '040f0000-0000-4000-8000-000000000003';
alter table public.trip_photos enable trigger trip_photos_handle_times;

set local role service_role;
select tv_test.expect_count('W1 the old tombstone and the orphan are candidates (2 objects each)',
  $$select 1 from public.trip_memories_sweep_candidates() c
     where c.name like '%040f0000-0000-4000-8000-000000000002%' or c.name like '%040f0000-0000-4000-8000-000000000004%'$$, 4) \g /dev/null
select tv_test.expect_count('W2 a live photo and a tombstone inside the 7-day undo window are never candidates',
  $$select 1 from public.trip_memories_sweep_candidates() c
     where c.name like '%040f0000-0000-4000-8000-000000000001%' or c.name like '%040f0000-0000-4000-8000-000000000003%'$$, 0) \g /dev/null
reset role;
do $$
begin
  if has_function_privilege('authenticated', 'public.trip_memories_sweep_candidates(interval, integer)', 'execute') then
    raise exception 'FAIL W3: authenticated can list sweep candidates';
  end if;
  raise notice 'PASS W3: candidates stay service_role only';
end $$;

-- Safety net: once the files are gone, an un-delete keeps the row deleted.
-- (Simulate the sweep: storage.protect_delete blocks SQL deletes unless
-- storage.allow_delete_query is set; metadata rows only, rolled back.)
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'trip-memories' and name like '%040f0000-0000-4000-8000-000000000002%';
set local storage.allow_delete_query = 'false';
set local role authenticated;
select tv_test.act_as('040a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('W4 undo of a swept photo does not raise (never wedges a sync queue)',
  $$update public.trip_photos set deleted = false where id = '040f0000-0000-4000-8000-000000000002'$$, 1) \g /dev/null
select tv_test.expect_count('W5 ...and the swept photo stays deleted',
  $$select 1 from public.trip_photos where id = '040f0000-0000-4000-8000-000000000002' and deleted$$, 1) \g /dev/null
select tv_test.expect_rows('W6 undo inside the window (files present) still works',
  $$update public.trip_photos set deleted = false where id = '040f0000-0000-4000-8000-000000000003'$$, 1) \g /dev/null
select tv_test.expect_count('W7 ...and restores the photo',
  $$select 1 from public.trip_photos where id = '040f0000-0000-4000-8000-000000000003' and not deleted$$, 1) \g /dev/null
reset role;

\echo '=== R. §4 revoked member retracts own memories only ==='
set local role authenticated;
select tv_test.act_as('040a0000-0000-4000-8000-00000000000c') \g /dev/null
select tv_test.expect_count('R1 the revoked author still reads own rows',
  $$select 1 from public.trip_journal_entries where author_id = '040a0000-0000-4000-8000-00000000000c'$$, 1) \g /dev/null
select tv_test.expect_count('R2 ...but never other members'' shared rows',
  $$select 1 from public.trip_journal_entries where author_id <> '040a0000-0000-4000-8000-00000000000c'$$, 0) \g /dev/null
select tv_test.expect_error('R3 editing the body is refused',
  $$update public.trip_journal_entries set body = 'edited', visibility = 'only_me' where id = '040e0000-0000-4000-8000-0000000000c1'$$,
  '42501', 'not_member') \g /dev/null
select tv_test.expect_rows('R4 un-sharing (visibility -> only_me) is allowed',
  $$update public.trip_journal_entries set visibility = 'only_me' where id = '040e0000-0000-4000-8000-0000000000c1'$$, 1) \g /dev/null
select tv_test.expect_error('R5 re-sharing (only_me -> trip) is refused',
  $$update public.trip_journal_entries set visibility = 'trip' where id = '040e0000-0000-4000-8000-0000000000c1'$$,
  '42501') \g /dev/null
select tv_test.expect_rows('R6 tombstoning own entry is allowed',
  $$update public.trip_journal_entries set deleted = true where id = '040e0000-0000-4000-8000-0000000000c1'$$, 1) \g /dev/null
select tv_test.expect_error('R7 un-deleting is refused',
  $$update public.trip_journal_entries set deleted = false where id = '040e0000-0000-4000-8000-0000000000c1'$$,
  '42501', 'not_member') \g /dev/null
select tv_test.expect_rows('R8 un-sharing own review is allowed',
  $$update public.trip_place_reviews set visibility = 'only_me' where id = '040e1000-0000-4000-8000-0000000000c1'$$, 1) \g /dev/null
select tv_test.expect_error('R9 changing the rating is refused',
  $$update public.trip_place_reviews set rating = 1 where id = '040e1000-0000-4000-8000-0000000000c1'$$,
  '42501') \g /dev/null
select tv_test.expect_rows('R10 other members'' rows are untouchable (0 rows)',
  $$update public.trip_journal_entries set deleted = true where id in ('040e0000-0000-4000-8000-0000000000f1', '040e0000-0000-4000-8000-0000000000a1')$$, 0) \g /dev/null
select tv_test.expect_error('R11 a revoked member still cannot create memories on the trip',
  $$insert into public.trip_journal_entries (trip_id, day_index, body) values ('040b0000-0000-4000-8000-0000000000a1', 1, 'x')$$,
  '42501') \g /dev/null

select tv_test.act_as('040a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_rows('R12 a non-member cannot tombstone anyone''s rows (0 rows)',
  $$update public.trip_journal_entries set deleted = true where trip_id = '040b0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null

select tv_test.act_as('040a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_rows('R13 a current member still edits own entries freely',
  $$update public.trip_journal_entries set body = 'V edited' where id = '040e0000-0000-4000-8000-0000000000f1'$$, 1) \g /dev/null
reset role;
select tv_test.expect_count('R14 the retract left the text untouched',
  $$select 1 from public.trip_journal_entries where id = '040e0000-0000-4000-8000-0000000000c1'
       and body = 'R shared note' and deleted and visibility = 'only_me'$$, 1) \g /dev/null

\echo '=== D. §5 duplicate_trip copies every user-authored column ==='
set local role authenticated;
select tv_test.act_as('040a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_error('D1 a viewer cannot duplicate the trip',
  $$select public.duplicate_trip('040b0000-0000-4000-8000-0000000000a1')$$, '42501') \g /dev/null
select tv_test.act_as('040a0000-0000-4000-8000-00000000000a') \g /dev/null
select set_config('tv_test.copy', public.duplicate_trip('040b0000-0000-4000-8000-0000000000a1')::text, true) \g /dev/null
reset role;
do $$
declare
  v_copy uuid := current_setting('tv_test.copy')::uuid;
  t record;
  n integer;
  v_p1 uuid;
  v_p2 uuid;
begin
  select * into t from public.trips where id = v_copy;
  if t.title <> 'fix0040 trip T (copy)' or t.currency <> 'TRY' or t.total_budget <> 12345.67
     or t.cost_per_km <> 0.42 or t.route_render_mode <> 'manual' or t.cover_photo_google_place_id <> 'GPID-FIX0040-COVER'
     or t.daily_hours_budget <> 7.5 or t.transport_mode <> 'walking' or t.timezone <> 'Europe/Istanbul'
     or t.start_date <> '2026-10-01' or t.end_date <> '2026-10-04' or t.archived_at is not null
     or t.user_id <> '040a0000-0000-4000-8000-00000000000a' then
    raise exception 'FAIL D2: trip columns not copied: %', to_jsonb(t);
  end if;

  select id into v_p1 from public.trip_places where trip_id = v_copy and google_place_id = 'GPID-FIX0040-P1';
  select id into v_p2 from public.trip_places where trip_id = v_copy and google_place_id = 'GPID-FIX0040-P2';
  if v_p1 is null or v_p2 is null or v_p1 = '040c0000-0000-4000-8000-0000000000a1' then
    raise exception 'FAIL D3: live places were not copied with fresh ids';
  end if;
  if t.anchor_place_id is distinct from v_p1 then
    raise exception 'FAIL D4: anchor must point at the copy''s place (%), got %', v_p1, t.anchor_place_id;
  end if;
  select count(*) into n from public.trip_places where trip_id = v_copy;
  if n <> 2 then raise exception 'FAIL D5: tombstoned places must not be copied (% places)', n; end if;
  if not exists (select 1 from public.trip_places where id = v_p1
                   and user_title = 'Galata Tower' and category = 'attraction' and visit_duration_minutes = 75
                   and notes = 'buy tickets online' and day_index = 0 and order_in_day = 0
                   and arrive_after = '09:00' and leave_before = '12:00' and pinned_start = '09:30'
                   and manual_rank = 'a0' and details_refreshed_at is null and not deleted) then
    raise exception 'FAIL D6: P1 user columns not copied';
  end if;
  if not exists (select 1 from public.trip_places where id = v_p2
                   and day_index = 1 and manual_rank = 'a1' and arrival_mode = 'ferry' and arrival_minutes = 35) then
    raise exception 'FAIL D7: P2 day layout / arrival mode not copied';
  end if;

  select count(*) into n from public.trip_days where trip_id = v_copy;
  if n <> 2 then raise exception 'FAIL D8: live trip_days must be copied (got %)', n; end if;
  if not exists (select 1 from public.trip_days where trip_id = v_copy and day_index = 0
                   and notes = 'Old town day' and start_time = '08:30' and transport_mode = 'walking'
                   and day_start_place_id = v_p1 and day_end_place_id is null) then
    raise exception 'FAIL D9: day 0 not copied / start place not remapped';
  end if;
  if not exists (select 1 from public.trip_days where trip_id = v_copy and day_index = 1
                   and start_time = '10:15' and transport_mode = 'transit' and day_end_place_id = v_p2) then
    raise exception 'FAIL D10: day 1 not copied / end place not remapped';
  end if;

  if exists (select 1 from public.trip_expenses where trip_id = v_copy)
     or exists (select 1 from public.trip_journal_entries where trip_id = v_copy)
     or exists (select 1 from public.trip_place_reviews where trip_id = v_copy)
     or exists (select 1 from public.trip_photos where trip_id = v_copy)
     or exists (select 1 from public.trip_legs where trip_id = v_copy)
     or exists (select 1 from public.trip_collaborators where trip_id = v_copy)
     or exists (select 1 from public.trip_shares where trip_id = v_copy) then
    raise exception 'FAIL D11: expenses / memories / legs / collaborators / shares must never be copied';
  end if;
  raise notice 'PASS D2-D11: trip, places, days copied; references remapped; nothing else';
end $$;

\echo '=== C. §3 account deletion removes collaborator rows ==='
do $$
begin
  if not exists (select 1 from public.trip_collaborators where id = '040d0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL C0: seed row missing';
  end if;
  delete from auth.users where id = '040a0000-0000-4000-8000-000000000001';
  if exists (select 1 from public.trip_collaborators where id = '040d0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL C1: the deleted member''s collaborator row survived';
  end if;
  if exists (select 1 from public.trip_collaborators where user_id is null and accepted_at is not null) then
    raise exception 'FAIL C2: accepted rows without a user remain';
  end if;
  if not exists (select 1 from public.trip_collaborators where id = '040d0000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL C3: other members'' rows must stay';
  end if;
  raise notice 'PASS C1-C3: membership rows go with the account';
end $$;

\echo 'sweep_fixes_0040: all assertions passed'
rollback;
