-- memories_0036_0037.sql: RLS / Storage / quota assertions for migrations
-- 0036_v2_m5_memories.sql and 0037_v2_m5_sharing_prefs_poi.sql (M5 Y1.2).
--
-- Plain SQL (not pgTAP), same style as security_0031.sql. Every check runs
-- as the real role (authenticated / anon / service_role + request.jwt.claims)
-- and RAISEs on failure, so psql with ON_ERROR_STOP exits non-zero. Everything
-- runs in ONE transaction that is rolled back: no residue (Storage rows are
-- metadata only; no bytes are written).
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/memories_0036_0037.sql
--
-- Cast (fixed ids, all rolled back):
--   O  owner of trip T (places P1, P2)
--   E  accepted EDITOR on T
--   V  accepted VIEWER on T
--   R  REVOKED viewer on T
--   N  non-member, owner of trip TN (place PN)

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

-- Runs p_sql, which MUST fail with p_state (and message LIKE p_msg if given).
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
  ('036a0000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@mem0036.test',    'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('036a0000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@mem0036.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('036a0000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@mem0036.test',   'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('036a0000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revoked@mem0036.test',  'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('036a0000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@mem0036.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', '');

insert into public.trips (id, user_id, title) values
  ('036b0000-0000-4000-8000-0000000000a1', '036a0000-0000-4000-8000-00000000000a', 'mem0036 trip T'),
  ('036b0000-0000-4000-8000-0000000000b1', '036a0000-0000-4000-8000-00000000000b', 'mem0036 outsider trip TN');

insert into public.trip_places (id, trip_id, google_place_id, lat, lng) values
  ('036c0000-0000-4000-8000-0000000000a1', '036b0000-0000-4000-8000-0000000000a1', 'GPID-MEM0036-P1', 41.0, 29.0),
  ('036c0000-0000-4000-8000-0000000000a2', '036b0000-0000-4000-8000-0000000000a1', 'GPID-MEM0036-P2', 41.1, 29.1),
  ('036c0000-0000-4000-8000-0000000000b1', '036b0000-0000-4000-8000-0000000000b1', 'GPID-MEM0036-PN', 48.8, 2.3);

insert into public.trip_collaborators (id, trip_id, invitee_email, user_id, role, status) values
  ('036d0000-0000-4000-8000-0000000000e1', '036b0000-0000-4000-8000-0000000000a1', 'editor@mem0036.test',  '036a0000-0000-4000-8000-00000000000e', 'editor', 'accepted'),
  ('036d0000-0000-4000-8000-0000000000f1', '036b0000-0000-4000-8000-0000000000a1', 'viewer@mem0036.test',  '036a0000-0000-4000-8000-00000000000f', 'viewer', 'accepted'),
  ('036d0000-0000-4000-8000-0000000000c1', '036b0000-0000-4000-8000-0000000000a1', 'revoked@mem0036.test', '036a0000-0000-4000-8000-00000000000c', 'viewer', 'revoked');

-- R wrote a shared journal entry while still a member (seeded directly).
insert into public.trip_journal_entries (id, trip_id, author_id, day_index, body, visibility) values
  ('036e0000-0000-4000-8000-0000000000c1', '036b0000-0000-4000-8000-0000000000a1', '036a0000-0000-4000-8000-00000000000c', 0, 'written before the revoke', 'trip');

set local role authenticated;

\echo '=== A. Journal: private by default, shared on demand ==='

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('A1 owner creates a journal entry (no author_id / visibility in payload)',
  $$insert into public.trip_journal_entries (id, trip_id, day_index, body)
    values ('036e0000-0000-4000-8000-0000000000a1', '036b0000-0000-4000-8000-0000000000a1', 0, 'owner day 1 notes')$$, 1) \g /dev/null
do $$
declare r record;
begin
  select * into r from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1';
  if r.visibility <> 'only_me' then raise exception 'FAIL A2: default visibility is %, expected only_me', r.visibility; end if;
  if r.author_id <> '036a0000-0000-4000-8000-00000000000a' then raise exception 'FAIL A2: author_id not defaulted to auth.uid()'; end if;
  if r.updated_at is null or r.deleted then raise exception 'FAIL A2: handle_times / deleted default broken'; end if;
  raise notice 'PASS A2: default visibility only_me, author_id = auth.uid(), updated_at stamped';
end $$;
select tv_test.expect_count('A3 author sees own only_me entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
-- Offline-autosave friendliness: an empty body is legal.
select tv_test.expect_rows('A4 author may save an empty body (autosave never wedges on a CHECK)',
  $$update public.trip_journal_entries set body = '' where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
update public.trip_journal_entries set body = 'owner day 1 notes' where id = '036e0000-0000-4000-8000-0000000000a1';

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('A5 editor does NOT see the owner''s only_me entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('A6 viewer does NOT see the owner''s only_me entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_count('A7 non-member sees nothing on trip T',
  $$select 1 from public.trip_journal_entries where trip_id = '036b0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('A8 author shares the entry with the trip',
  $$update public.trip_journal_entries set visibility = 'trip' where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('A9 editor sees the shared entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('A10 viewer sees the shared entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_count('A11 non-member still sees nothing (shared means trip members only)',
  $$select 1 from public.trip_journal_entries where trip_id = '036b0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000c') \g /dev/null
select tv_test.expect_count('A12 revoked member sees only their OWN old entry (author always), not the owner''s shared one',
  $$select 1 from public.trip_journal_entries where trip_id = '036b0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
select tv_test.expect_rows('A13 revoked member can no longer modify their old entry (0031 posture)',
  $$update public.trip_journal_entries set body = 'edited after revoke' where id = '036e0000-0000-4000-8000-0000000000c1'$$, 0) \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('A14 author tombstones the shared entry',
  $$update public.trip_journal_entries set deleted = true where id = '036e0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
select tv_test.expect_count('A15 author still sees own tombstone (replica + undo)',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1' and deleted$$, 1) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('A16 editor no longer sees the tombstoned entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null

-- Un-share: the row vanishes for members (why Tier-1 memory roots must be own-items only).
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
update public.trip_journal_entries set deleted = false where id = '036e0000-0000-4000-8000-0000000000a1';
update public.trip_journal_entries set visibility = 'only_me' where id = '036e0000-0000-4000-8000-0000000000a1';
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('A17 un-shared entry is hidden from the viewer again',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null

\echo '=== B. Journal writes: who may write what ==='

select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_rows('B1 VIEWER may create their own (private) memory',
  $$insert into public.trip_journal_entries (id, trip_id, day_index, body)
    values ('036e0000-0000-4000-8000-0000000000f1', '036b0000-0000-4000-8000-0000000000a1', 1, 'viewer diary')$$, 1) \g /dev/null
insert into public.trip_journal_entries (id, trip_id, day_index, body)
values ('036e0000-0000-4000-8000-0000000000f2', '036b0000-0000-4000-8000-0000000000a1', 1, 'viewer secret');
select tv_test.expect_error('B2 viewer cannot author for someone else',
  $$insert into public.trip_journal_entries (trip_id, author_id, day_index, body)
    values ('036b0000-0000-4000-8000-0000000000a1', '036a0000-0000-4000-8000-00000000000a', 1, 'impersonation')$$,
  '42501', 'author_mismatch') \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('B3 OWNER cannot see the viewer''s only_me entry',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null
select tv_test.expect_rows('B4 owner cannot tombstone an only_me item it cannot see',
  $$update public.trip_journal_entries set deleted = true where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_error('B5 non-member cannot write into trip T',
  $$insert into public.trip_journal_entries (trip_id, day_index, body)
    values ('036b0000-0000-4000-8000-0000000000a1', 0, 'intruder')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
update public.trip_journal_entries set visibility = 'trip' where id = '036e0000-0000-4000-8000-0000000000f1';

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('B6 editor cannot edit someone else''s shared entry (not the author, not the owner)',
  $$update public.trip_journal_entries set body = 'vandal' where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null
select tv_test.expect_rows('B7 editor cannot hard-delete someone else''s entry',
  $$delete from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null

select tv_test.expect_error('B8a editor cannot use the moderation RPC on someone else''s item',
  $$select public.remove_trip_memory('journal', '036e0000-0000-4000-8000-0000000000f1')$$,
  '42501', 'not_found') \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('B8 owner cannot EDIT a member''s shared entry (UPDATE is author-only)',
  $$update public.trip_journal_entries set body = 'owner rewrite' where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null
select tv_test.expect_rows('B9 owner cannot flip a member''s visibility or tombstone via UPDATE',
  $$update public.trip_journal_entries set visibility = 'only_me', deleted = true where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null
select tv_test.expect_error('B10a owner moderation RPC cannot reach a PRIVATE item (no existence leak)',
  $$select public.remove_trip_memory('journal', '036e0000-0000-4000-8000-0000000000f2')$$,
  '42501', 'not_found') \g /dev/null
do $$
begin
  if not public.remove_trip_memory('journal', '036e0000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL B10: owner moderation did not tombstone the shared entry';
  end if;
  if public.remove_trip_memory('journal', '036e0000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL B10: second removal should report false (already tombstoned)';
  end if;
  raise notice 'PASS B10: owner CAN tombstone a member''s shared entry via remove_trip_memory (idempotent)';
end $$;
select tv_test.expect_error('B10b moderation RPC rejects an unknown kind',
  $$select public.remove_trip_memory('trips', '036e0000-0000-4000-8000-0000000000f1')$$, '22023', 'invalid_kind') \g /dev/null
select tv_test.expect_rows('B11 owner cannot hard-delete a member''s entry',
  $$delete from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null

-- Defense in depth: even a path that bypasses RLS (here: postgres with the
-- owner's JWT) cannot make a non-author content change; the guard refuses.
reset role;
select tv_test.expect_error('B11b guard blocks a non-author content edit even without RLS',
  $$update public.trip_journal_entries set body = 'rewritten', deleted = false where id = '036e0000-0000-4000-8000-0000000000f1'$$,
  '42501', 'not_author') \g /dev/null
set local role authenticated;

select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('B12 the author sees the owner''s tombstone on their own row',
  $$select 1 from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000f1' and deleted$$, 1) \g /dev/null
select tv_test.expect_error('B13 author cannot move an entry to another trip (immutable trip_id)',
  $$update public.trip_journal_entries set trip_id = '036b0000-0000-4000-8000-0000000000b1' where id = '036e0000-0000-4000-8000-0000000000f1'$$,
  '42501', 'immutable_column') \g /dev/null
select tv_test.expect_error('B14 author cannot re-assign authorship',
  $$update public.trip_journal_entries set author_id = '036a0000-0000-4000-8000-00000000000e' where id = '036e0000-0000-4000-8000-0000000000f1'$$,
  '42501', 'immutable_column') \g /dev/null
select tv_test.expect_error('B15 day_index out of range is rejected',
  $$insert into public.trip_journal_entries (trip_id, day_index, body) values ('036b0000-0000-4000-8000-0000000000a1', -1, 'x')$$,
  '23514') \g /dev/null
select tv_test.expect_rows('B16 author may hard-delete own entry (escape hatch)',
  $$delete from public.trip_journal_entries where id = '036e0000-0000-4000-8000-0000000000f1'$$, 1) \g /dev/null

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
select tv_test.expect_error('B17 anon has no table access at all',
  $$select 1 from public.trip_journal_entries$$, '42501') \g /dev/null
select tv_test.expect_error('B18 anon cannot read reviews', $$select 1 from public.trip_place_reviews$$, '42501') \g /dev/null
select tv_test.expect_error('B19 anon cannot read photos',  $$select 1 from public.trip_photos$$, '42501') \g /dev/null
select tv_test.expect_count('B20 anon sees no trip-memories objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories'$$, 0) \g /dev/null
reset role;
set local role authenticated;

\echo '=== C. Reviews: place consistency, one live review, rating range ==='

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('C1 editor rates place P1',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, body)
    values ('036e0000-0000-4000-8000-0000000000e1', '036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000a1', 4, 'nice')$$, 1) \g /dev/null
select tv_test.expect_error('C2 a review cannot point at another trip''s place',
  $$insert into public.trip_place_reviews (trip_id, trip_place_id, rating)
    values ('036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000b1', 5)$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_error('C3 rating outside 1..5 is rejected',
  $$insert into public.trip_place_reviews (trip_id, trip_place_id, rating)
    values ('036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000a2', 6)$$,
  '23514') \g /dev/null
-- A second live review of the same place (e.g. from another offline device)
-- supersedes the first instead of failing with 23505.
select tv_test.expect_rows('C4 second review of the same place is accepted',
  $$insert into public.trip_place_reviews (id, trip_id, trip_place_id, rating, body)
    values ('036e0000-0000-4000-8000-0000000000e2', '036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000a1', 5, 'even better')$$, 1) \g /dev/null
select tv_test.expect_count('C5 exactly one live review per (place, author); the older one is tombstoned',
  $$select 1 from public.trip_place_reviews
     where trip_place_id = '036c0000-0000-4000-8000-0000000000a1' and not deleted$$, 1) \g /dev/null
select tv_test.expect_count('C6 the tombstoned one is the OLDER review',
  $$select 1 from public.trip_place_reviews where id = '036e0000-0000-4000-8000-0000000000e1' and deleted$$, 1) \g /dev/null
select tv_test.expect_rows('C7 un-deleting the older review supersedes the newer (last write wins)',
  $$update public.trip_place_reviews set deleted = false where id = '036e0000-0000-4000-8000-0000000000e1'$$, 1) \g /dev/null
select tv_test.expect_count('C8 still exactly one live review',
  $$select 1 from public.trip_place_reviews where trip_place_id = '036c0000-0000-4000-8000-0000000000a1'
      and not deleted and id = '036e0000-0000-4000-8000-0000000000e1'$$, 1) \g /dev/null
select tv_test.expect_error('C9 a review cannot move to another place',
  $$update public.trip_place_reviews set trip_place_id = '036c0000-0000-4000-8000-0000000000a2' where id = '036e0000-0000-4000-8000-0000000000e1'$$,
  '42501', 'immutable_column') \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('C10 owner does not see the editor''s private review',
  $$select 1 from public.trip_place_reviews where trip_place_id = '036c0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.expect_rows('C11 the owner can review the same place independently (uniqueness is per author)',
  $$insert into public.trip_place_reviews (trip_id, trip_place_id, rating, visibility)
    values ('036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000a1', 3, 'trip')$$, 1) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('C12 viewer sees only the owner''s SHARED review',
  $$select 1 from public.trip_place_reviews where trip_place_id = '036c0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null

\echo '=== D. Photos + trip-memories Storage policies ==='

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
-- Client tries to smuggle status/bytes/paths: all server-owned.
select tv_test.expect_rows('D1 owner creates photo row PH1 (attached to P2)',
  $$insert into public.trip_photos (id, trip_id, trip_place_id, day_index, status, bytes, storage_path, thumb_path)
    values ('036f0000-0000-4000-8000-0000000000a1', '036b0000-0000-4000-8000-0000000000a1', '036c0000-0000-4000-8000-0000000000a2', 0,
            'ready', 1, 'evil/../path.jpg', 'x')$$, 1) \g /dev/null
do $$
declare r record;
begin
  select * into r from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1';
  if r.status <> 'pending' or r.bytes is not null then
    raise exception 'FAIL D2: client status/bytes not overridden (status=%, bytes=%)', r.status, r.bytes;
  end if;
  if r.storage_path <> '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1.jpg'
     or r.thumb_path <> '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1_t.jpg' then
    raise exception 'FAIL D2: paths not server-stamped: % / %', r.storage_path, r.thumb_path;
  end if;
  raise notice 'PASS D2: status forced pending, bytes NULL, paths stamped <trip>/<author>/<id>(.jpg|_t.jpg)';
end $$;
insert into public.trip_photos (id, trip_id) values ('036f0000-0000-4000-8000-0000000000a2', '036b0000-0000-4000-8000-0000000000a1');

-- Uploads (storage-api inserts the storage.objects row under the caller's RLS).
select tv_test.expect_rows('D3 author uploads the full image into their own folder',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 300000, "mimetype": "image/jpeg"}')$$, 1) \g /dev/null
select tv_test.expect_error('D4 marking ready with only one object uploaded fails',
  $$update public.trip_photos set status = 'ready' where id = '036f0000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'upload_incomplete') \g /dev/null
select tv_test.expect_rows('D5 author uploads the thumbnail (permission check runs before metadata exists)',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1_t.jpg',
            '036a0000-0000-4000-8000-00000000000a', null)$$, 1) \g /dev/null
reset role;
update storage.objects set metadata = '{"size": 40000, "mimetype": "image/jpeg"}'
 where name = '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1_t.jpg';
set local role authenticated;
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null

select tv_test.expect_error('D6 upload into ANOTHER user''s folder is denied',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000e/036f0000-0000-4000-8000-0000000000a2.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_error('D7 upload of a key with no matching photo row is denied',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000ff.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_error('D8 upload with a non-canonical key (.png) is denied',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a2.png',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "image/png"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_error('D9 an object over 1 MiB is denied',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a2.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 2000000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_error('D10 a non-image mime type is denied',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a2.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "text/html"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_error('D11 editor cannot upload into the owner''s pending photo slot',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a2.jpg',
            '036a0000-0000-4000-8000-00000000000e', '{"size": 1000, "mimetype": "image/jpeg"}')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null
select tv_test.expect_count('D12 editor cannot see a pending/private photo row',
  $$select 1 from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1'$$, 0) \g /dev/null
select tv_test.expect_count('D13 editor cannot read the private photo''s objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/%'$$, 0) \g /dev/null
select tv_test.expect_error('D14 the object-size helper is not an oracle for other users'' folders',
  $$select * from public.trip_photo_object_sizes(
      '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1.jpg',
      '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1_t.jpg')$$,
  '42501', 'not_author') \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_count('D15 author reads own objects while pending',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 2) \g /dev/null
select tv_test.expect_rows('D16 both objects present: pending -> ready',
  $$update public.trip_photos set status = 'ready', bytes = 1 where id = '036f0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
do $$
declare r record;
begin
  select * into r from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1';
  if r.bytes <> 300000 or r.thumb_bytes <> 40000 then
    raise exception 'FAIL D17: bytes not stamped from Storage metadata (bytes=%, thumb=%)', r.bytes, r.thumb_bytes;
  end if;
  raise notice 'PASS D17: bytes/thumb_bytes stamped from Storage metadata (client value ignored)';
end $$;
select tv_test.expect_error('D18 ready -> pending is refused',
  $$update public.trip_photos set status = 'pending' where id = '036f0000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'invalid_status_transition') \g /dev/null
select tv_test.expect_error('D19 no further uploads once the photo is ready (no overwrite path)',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a1_t.jpg',
            '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "image/jpeg"}')$$,
  '42501') \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('D20 ready but only_me: still invisible to the editor',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 0) \g /dev/null

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
update public.trip_photos set visibility = 'trip' where id = '036f0000-0000-4000-8000-0000000000a1';
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('D21 shared + ready: editor sees the row',
  $$select 1 from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1'$$, 1) \g /dev/null
select tv_test.expect_count('D22 shared + ready: editor can read both objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 2) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_count('D23 shared + ready: viewer can read both objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 2) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000b') \g /dev/null
select tv_test.expect_count('D24 non-member can never read the objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000c') \g /dev/null
select tv_test.expect_count('D25 revoked member can no longer read the shared objects',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 0) \g /dev/null

-- Storage deletes (storage-api sets storage.allow_delete_query for its own deletes).
select set_config('storage.allow_delete_query', 'true', true) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_rows('D26 editor cannot delete the owner''s objects',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a1%'$$, 0) \g /dev/null

-- FK action: an editor hard-deletes place P2, which PH1 references. The
-- ON DELETE SET NULL runs with the editor's JWT and must not trip the guard.
select tv_test.expect_rows('D27 editor deletes place P2 referenced by the owner''s photo',
  $$delete from public.trip_places where id = '036c0000-0000-4000-8000-0000000000a2'$$, 1) \g /dev/null
reset role;
do $$
begin
  if (select trip_place_id from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1') is not null then
    raise exception 'FAIL D28: trip_place_id not nulled by ON DELETE SET NULL';
  end if;
  raise notice 'PASS D28: place delete nulled the photo''s trip_place_id (guard lets the FK action through)';
end $$;
set local role authenticated;

-- A viewer's shared photo, used for the owner-moderation checks.
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
insert into public.trip_photos (id, trip_id, visibility) values ('036f0000-0000-4000-8000-0000000000f1', '036b0000-0000-4000-8000-0000000000a1', 'trip');
select tv_test.expect_rows('D29 VIEWER uploads into their own folder',
  $$insert into storage.objects (bucket_id, name, owner, metadata)
    values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000f/036f0000-0000-4000-8000-0000000000f1.jpg',
            '036a0000-0000-4000-8000-00000000000f', '{"size": 250000, "mimetype": "image/webp"}'),
           ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000f/036f0000-0000-4000-8000-0000000000f1_t.jpg',
            '036a0000-0000-4000-8000-00000000000f', '{"size": 30000, "mimetype": "image/webp"}')$$, 2) \g /dev/null
update public.trip_photos set status = 'ready' where id = '036f0000-0000-4000-8000-0000000000f1';

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('D30 owner cannot re-caption a member''s photo',
  $$update public.trip_photos set caption = 'owner caption' where id = '036f0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null
-- Moderation order: objects first (visible while shared + live), then the tombstone.
select tv_test.expect_rows('D31 owner CAN delete a member''s objects of a SHARED photo on their trip',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name = '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000f/036f0000-0000-4000-8000-0000000000f1.jpg'$$, 1) \g /dev/null
select tv_test.expect_count('D32 owner CAN tombstone a member''s shared photo (moderation RPC)',
  $$select 1 from public.remove_trip_memory('photo', '036f0000-0000-4000-8000-0000000000f1') ok where ok$$, 1) \g /dev/null
select tv_test.expect_rows('D32b after the tombstone the owner can no longer see (so not delete) the rest',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name like '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000f/%'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
select tv_test.expect_rows('D33 the author removes the objects of their own tombstoned photo',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name like '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000f/%'$$, 1) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('D34 tombstoned photo row disappears for other members',
  $$select 1 from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000f1'$$, 0) \g /dev/null

-- Orphans: a half-finished upload whose row is gone (hard delete / purge).
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
insert into public.trip_photos (id, trip_id) values ('036f0000-0000-4000-8000-0000000000a9', '036b0000-0000-4000-8000-0000000000a1');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('trip-memories', '036b0000-0000-4000-8000-0000000000a1/036a0000-0000-4000-8000-00000000000a/036f0000-0000-4000-8000-0000000000a9.jpg',
        '036a0000-0000-4000-8000-00000000000a', '{"size": 1000, "mimetype": "image/jpeg"}');
delete from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a9';
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('D35 an orphan object is invisible to other members',
  $$select 1 from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a9%'$$, 0) \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('D36 the author can still find and remove their orphan object (own folder)',
  $$delete from storage.objects where bucket_id = 'trip-memories' and name like '%/036f0000-0000-4000-8000-0000000000a9%'$$, 1) \g /dev/null
select set_config('storage.allow_delete_query', 'false', true) \g /dev/null

\echo '=== E. Quotas + global storage guard ==='

-- Live photos now: O = PH1 + PH2 (pending), V = 0 live (PH-F1 tombstoned). Trip T = 2.
reset role;
insert into public.app_config (key, value) values ('memories_user_cap', '3'), ('memories_trip_cap', '4')
on conflict (key) do update set value = excluded.value;
set local role authenticated;

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
insert into public.trip_photos (id, trip_id) values ('036f0000-0000-4000-8000-0000000000a3', '036b0000-0000-4000-8000-0000000000a1');
select tv_test.expect_error('E1 per-user cap (3) -> quota_exceeded',
  $$insert into public.trip_photos (trip_id) values ('036b0000-0000-4000-8000-0000000000a1')$$,
  'P0001', 'quota_exceeded') \g /dev/null
do $$
declare v_detail text;
begin
  begin
    insert into public.trip_photos (trip_id) values ('036b0000-0000-4000-8000-0000000000a1');
  exception when raise_exception then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  if (v_detail::jsonb)->>'scope' <> 'user' or ((v_detail::jsonb)->>'limit')::int <> 3 then
    raise exception 'FAIL E2: unexpected quota detail %', v_detail;
  end if;
  raise notice 'PASS E2: quota detail = %', v_detail;
end $$;
select tv_test.expect_count('E3 the quota RPC reports the caller''s usage',
  $$select 1 from public.get_memory_quota('036b0000-0000-4000-8000-0000000000a1') q
     where (q->>'user_used')::int = 3 and (q->>'user_cap')::int = 3
       and (q->>'trip_used')::int = 3 and (q->>'trip_cap')::int = 4
       and (q->>'storage_full')::boolean = false$$, 1) \g /dev/null

-- Trip cap: V adds the 4th live photo of trip T, then the 5th is refused.
select tv_test.act_as('036a0000-0000-4000-8000-00000000000f') \g /dev/null
insert into public.trip_photos (id, trip_id) values ('036f0000-0000-4000-8000-0000000000f2', '036b0000-0000-4000-8000-0000000000a1');
select tv_test.expect_error('E4 per-trip cap (4) -> quota_exceeded (counts other members'' private photos too)',
  $$insert into public.trip_photos (trip_id) values ('036b0000-0000-4000-8000-0000000000a1')$$,
  'P0001', 'quota_exceeded') \g /dev/null
select tv_test.expect_error('E5 un-deleting a photo re-checks the caps',
  $$update public.trip_photos set deleted = false where id = '036f0000-0000-4000-8000-0000000000f1'$$,
  'P0001', 'quota_exceeded') \g /dev/null
select tv_test.expect_rows('E6 tombstoning frees a slot ...',
  $$update public.trip_photos set deleted = true where id = '036f0000-0000-4000-8000-0000000000f2'$$, 1) \g /dev/null
select tv_test.expect_rows('E7 ... so the restore now fits',
  $$update public.trip_photos set deleted = false where id = '036f0000-0000-4000-8000-0000000000f1'$$, 1) \g /dev/null
select tv_test.expect_error('E8 quota RPC refuses a trip the caller cannot read',
  $$select public.get_memory_quota('036b0000-0000-4000-8000-0000000000b1')$$, '42501', 'not_found') \g /dev/null

-- Global guard over ALL buckets: lower it below what is already stored.
reset role;
update public.app_config set value = '100000' where key in ('memories_user_cap', 'memories_trip_cap');
insert into public.app_config (key, value) values ('memories_storage_guard_bytes', '1000')
on conflict (key) do update set value = excluded.value;
set local role authenticated;
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_error('E9 storage above the guard -> storage_full',
  $$insert into public.trip_photos (trip_id) values ('036b0000-0000-4000-8000-0000000000a1')$$,
  'P0001', 'storage_full') \g /dev/null
select tv_test.expect_count('E10 the quota RPC reports storage_full',
  $$select 1 from public.get_memory_quota() q where (q->>'storage_full')::boolean$$, 1) \g /dev/null
-- Journal/reviews are not photo-quota'd.
select tv_test.expect_rows('E11 storage_full does not block text memories',
  $$insert into public.trip_journal_entries (trip_id, day_index, body) values ('036b0000-0000-4000-8000-0000000000a1', 2, 'still works')$$, 1) \g /dev/null
reset role;
delete from public.app_config where key in ('memories_user_cap', 'memories_trip_cap', 'memories_storage_guard_bytes');
set local role authenticated;

\echo '=== F. Pending purge ==='
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare n int;
begin
  n := public.purge_stale_pending_photos();
  if n <> 0 then raise exception 'FAIL F1: fresh pending rows purged (%)', n; end if;
  raise notice 'PASS F1: pending rows younger than 24 h are kept';
  -- A negative age makes every pending row "stale" inside this transaction.
  n := public.purge_stale_pending_photos(interval '-1 second');
  if n < 2 then raise exception 'FAIL F2: expected the stale pending rows to be purged, got %', n; end if;
  if exists (select 1 from public.trip_photos where status = 'pending') then
    raise exception 'FAIL F2: pending rows left behind';
  end if;
  if not exists (select 1 from public.trip_photos where id = '036f0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL F2: a READY photo was purged';
  end if;
  raise notice 'PASS F2: % stale pending row(s) purged, ready rows kept', n;
end $$;
reset role;
set local role authenticated;
select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_error('F3 authenticated cannot run the purge',
  $$select public.purge_stale_pending_photos()$$, '42501') \g /dev/null

\echo '=== G. 0037: share toggles, preferences, POI cache, counters ==='
reset role;
do $$
declare r record;
begin
  insert into public.trip_shares (id, trip_id, token)
  values ('036f0000-0000-4000-8000-00000000005a', '036b0000-0000-4000-8000-0000000000a1', 'mem0036-token');
  select * into r from public.trip_shares where id = '036f0000-0000-4000-8000-00000000005a';
  if not r.show_itinerary or r.show_expenses or r.show_memories then
    raise exception 'FAIL G1: share toggle defaults wrong (itinerary=%, expenses=%, memories=%)',
      r.show_itinerary, r.show_expenses, r.show_memories;
  end if;
  raise notice 'PASS G1: share toggles default itinerary=on, expenses=off, memories=off';
end $$;
set local role authenticated;

select tv_test.act_as('036a0000-0000-4000-8000-00000000000a') \g /dev/null
select tv_test.expect_rows('G2 user upserts own preferences (user_id defaults to auth.uid())',
  $$insert into public.user_preferences (locale, home_currency, interests)
    values ('tr', 'TRY', array['history', 'food'])
    on conflict (user_id) do update set locale = excluded.locale$$, 1) \g /dev/null
select tv_test.expect_error('G3 invalid currency code rejected',
  $$update public.user_preferences set home_currency = 'try' where user_id = auth.uid()$$, '23514') \g /dev/null
select tv_test.expect_error('G4 malformed interest key rejected',
  $$update public.user_preferences set interests = array['Food!'] where user_id = auth.uid()$$, '23514') \g /dev/null
select tv_test.expect_error('G5 NULL interest element rejected',
  $$update public.user_preferences set interests = array['food', null] where user_id = auth.uid()$$, '23514') \g /dev/null
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('G6 another user cannot read the preferences',
  $$select 1 from public.user_preferences where user_id = '036a0000-0000-4000-8000-00000000000a'$$, 0) \g /dev/null
select tv_test.expect_error('G7 another user cannot write preferences for someone else',
  $$insert into public.user_preferences (user_id, locale) values ('036a0000-0000-4000-8000-00000000000a', 'en')$$,
  '42501', 'new row violates row-level security policy%') \g /dev/null

-- 0038 (Wave-1 #9): poi_cache / service_usage are service-role only. Asserted
-- as a privilege error, so the check does not depend on what the cache holds
-- (Wave-1 #3: the old `count = 0` failed on any stack with cached POIs).
select tv_test.expect_error('G8 authenticated cannot read poi_cache (0038)',
  $$select 1 from public.poi_cache limit 1$$, '42501') \g /dev/null
select tv_test.expect_error('G8b authenticated cannot read service_usage (0038)',
  $$select 1 from public.service_usage limit 1$$, '42501') \g /dev/null
select tv_test.expect_error('G9 authenticated cannot write poi_cache',
  $$insert into public.poi_cache (key, payload) values ('ovp:v1:sxk9j:food', '[]')$$, '42501') \g /dev/null
select tv_test.expect_error('G10 authenticated cannot write service_usage',
  $$insert into public.service_usage (service, count) values ('overpass', 0)$$, '42501') \g /dev/null
select tv_test.expect_error('G11 authenticated cannot call consume_service_usage',
  $$select public.consume_service_usage('overpass', 1, 2000)$$, '42501') \g /dev/null
select tv_test.expect_error('G12 authenticated cannot call consume_poi_quota (even for itself)',
  $$select public.consume_poi_quota('036a0000-0000-4000-8000-00000000000e', 1, 40)$$, '42501') \g /dev/null

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
select tv_test.expect_error('G13 anon cannot read poi_cache',        $$select 1 from public.poi_cache$$, '42501') \g /dev/null
select tv_test.expect_error('G14 anon cannot read user_preferences', $$select 1 from public.user_preferences$$, '42501') \g /dev/null
select tv_test.expect_error('G15 anon cannot read service_usage',    $$select 1 from public.service_usage$$, '42501') \g /dev/null
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
declare ok boolean; n int;
begin
  insert into public.poi_cache (key, payload) values ('ovp:v1:sxk9j:food', '[{"osmId":"node/1"}]')
  on conflict (key) do update set payload = excluded.payload, fetched_at = now();
  begin
    insert into public.poi_cache (key, payload) values ('ovp:v1:too-big', to_jsonb(repeat('x', 300000)));
    raise exception 'FAIL G16: oversized payload accepted';
  exception when check_violation then
    raise notice 'PASS G16: poi_cache payload capped at 256 KiB';
  end;

  -- service_usage: cap 3, request 2 + 1 fit, the 4th unit is refused and consumes nothing.
  delete from public.service_usage where service = 'mem0036test';
  ok := public.consume_service_usage('mem0036test', 2, 3);
  if not ok then raise exception 'FAIL G17: first reservation refused'; end if;
  ok := public.consume_service_usage('mem0036test', 1, 3);
  if not ok then raise exception 'FAIL G17: reservation up to the cap refused'; end if;
  ok := public.consume_service_usage('mem0036test', 1, 3);
  if ok then raise exception 'FAIL G17: reservation above the cap accepted'; end if;
  select count into n from public.service_usage where service = 'mem0036test' and day = current_date;
  if n <> 3 then raise exception 'FAIL G17: counter = % (expected 3; a refusal must consume nothing)', n; end if;
  if public.consume_service_usage('mem0036test', 5, 3) then raise exception 'FAIL G17: oversize request accepted'; end if;
  raise notice 'PASS G17: consume_service_usage is capped and refusals consume nothing';

  begin
    perform public.consume_service_usage('Bad Name', 1, 3);
    raise exception 'FAIL G18: invalid service name accepted';
  exception when invalid_parameter_value then
    raise notice 'PASS G18: invalid service name rejected';
  end;

  -- consume_poi_quota: cap 2.
  ok := public.consume_poi_quota('036a0000-0000-4000-8000-00000000000e', 1, 2);
  ok := ok and public.consume_poi_quota('036a0000-0000-4000-8000-00000000000e', 1, 2);
  if not ok then raise exception 'FAIL G19: poi quota refused below the cap'; end if;
  if public.consume_poi_quota('036a0000-0000-4000-8000-00000000000e', 1, 2) then
    raise exception 'FAIL G19: poi quota accepted above the cap';
  end if;
  select poi_requests into n from public.ai_usage
   where user_id = '036a0000-0000-4000-8000-00000000000e' and day = current_date;
  if n <> 2 then raise exception 'FAIL G19: poi_requests = % (expected 2)', n; end if;
  raise notice 'PASS G19: consume_poi_quota is capped per user per day';
end $$;
reset role;

set local role authenticated;
select tv_test.act_as('036a0000-0000-4000-8000-00000000000e') \g /dev/null
select tv_test.expect_count('G20 the user can read their own poi_requests counter (quota meter)',
  $$select 1 from public.ai_usage where user_id = auth.uid() and poi_requests = 2$$, 1) \g /dev/null
reset role;

\echo '=== H. EXECUTE matrix: no anon / PUBLIC execute on the new functions ==='
do $$
declare
  r record;
  bad int := 0;
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('trip_memory_photo_id', 'trip_photo_object_sizes', 'memory_quota_limits',
                        'get_memory_quota', 'remove_trip_memory', 'purge_stale_pending_photos', 'trip_memories_guard',
                        'trip_place_reviews_supersede', 'trip_photos_enforce_quota',
                        'consume_service_usage', 'consume_poi_quota')
  loop
    if has_function_privilege('anon', r.fn, 'execute') then
      raise notice 'FAIL H1: anon has EXECUTE on %', r.fn;
      bad := bad + 1;
    end if;
  end loop;
  if bad > 0 then raise exception 'FAIL H1: % function(s) executable by anon', bad; end if;

  if has_function_privilege('authenticated', 'public.consume_service_usage(text,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_poi_quota(uuid,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_stale_pending_photos(interval)', 'execute') then
    raise exception 'FAIL H2: a service-role-only function is executable by authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.consume_service_usage(text,integer,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.consume_poi_quota(uuid,integer,integer)', 'execute') then
    raise exception 'FAIL H2: service_role lost EXECUTE on a consume function';
  end if;
  if has_table_privilege('anon', 'public.trip_photos', 'select')
     or has_table_privilege('anon', 'public.user_preferences', 'select')
     or has_table_privilege('authenticated', 'public.trip_photos', 'truncate') then
    raise exception 'FAIL H3: table grants too wide';
  end if;
  raise notice 'PASS H1-H3: EXECUTE matrix and table grants as documented';

  if (select public from storage.buckets where id = 'trip-memories') is distinct from false then
    raise exception 'FAIL H4: trip-memories bucket missing or public';
  end if;
  raise notice 'PASS H4: trip-memories bucket exists and is private';
end $$;

\echo '=== ALL memories_0036_0037 CHECKS PASSED (rolling back) ==='
rollback;
