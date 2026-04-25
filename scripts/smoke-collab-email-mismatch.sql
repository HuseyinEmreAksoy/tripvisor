-- Phase 21 Step 21.5/21.6 — email-mismatch smoke for the accept flow.
--
-- This script simulates the email-mismatch guard the Edge Function
-- enforces in its `accept` handler. The Edge Function does the
-- comparison in TS (caller's auth email vs row's invitee_email,
-- case-insensitive) BEFORE binding user_id. To prove the guard at the
-- DB level, we exercise the `trip_collaborators_invitee_update` RLS
-- policy: an authenticated user whose email does NOT match the
-- invitee_email must NOT be able to flip a pending row to accepted.
--
-- Setup:
--   - User A (owner) creates a trip
--   - A invites email "intended@smoke.test" (no auth.users row yet —
--     pending)
--   - User C exists with email "attacker@smoke.test" and tries to
--     accept the invite (steal it). Must fail.

\set ON_ERROR_STOP on

-- Cleanup any prior run.
delete from public.trip_collaborators where invitee_email in ('intended@smoke.test', 'attacker@smoke.test');
delete from public.trips where title = 'email-mismatch-smoke';
delete from auth.users where email in ('owner-em@smoke.test', 'attacker@smoke.test');

-- Seed users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('33333333-3333-3333-3333-333333333333'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'owner-em@smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('44444444-4444-4444-4444-444444444444'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'attacker@smoke.test', '$2a$10$abcdefghijklmnopqrstuvwxyz123456', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- Owner creates trip + pending invite for the intended (not-yet-registered) recipient.
\echo '--- Step 1: Owner creates trip + pending invite for intended@ ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into public.trips (id, user_id, title)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'email-mismatch-smoke');

insert into public.trip_collaborators (id, trip_id, invitee_email, role, status)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'intended@smoke.test', 'editor', 'pending');
commit;
\echo 'Owner inserted pending invite addressed to intended@smoke.test'

-- Attacker tries to flip the pending row to accepted, binding user_id to themselves.
\echo ''
\echo '--- Step 2: Attacker (different email) tries to accept ---'
begin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

-- The attacker must not even SEE the row — `current_user_email()` will
-- return 'attacker@smoke.test' which doesn't match invitee_email.
select 'ATTACKER_SEES_ROW (expect 0): ' || count(*)::text from public.trip_collaborators where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- The attacker tries to flip status anyway. Even with a direct id-targeted
-- UPDATE the RLS policy must deny it (USING fails because neither
-- user_id matches nor email matches).
do $$
declare
  v_count int;
begin
  update public.trip_collaborators
  set status = 'accepted', user_id = '44444444-4444-4444-4444-444444444444'::uuid
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;
  get diagnostics v_count = ROW_COUNT;
  if v_count = 0 then
    raise notice 'PASS: attacker UPDATE affected 0 rows (RLS blocked or row invisible)';
  else
    raise notice 'FAIL: attacker UPDATE affected % rows (should be 0)', v_count;
  end if;
exception when insufficient_privilege then
  raise notice 'PASS: attacker UPDATE denied (insufficient_privilege)';
end$$;
commit;

-- Verify the row is still pending.
\echo ''
\echo '--- Step 3: Verify row still pending (as superuser, no RLS) ---'
select 'ROW_STATUS_AFTER_ATTACK: ' || status || ', user_id=' || coalesce(user_id::text, 'null')
  from public.trip_collaborators where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- Cleanup
delete from public.trip_collaborators where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;
delete from public.trips where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid;
delete from auth.users where email in ('owner-em@smoke.test', 'attacker@smoke.test');

\echo ''
\echo 'Email-mismatch smoke complete.'
