-- m5_y11_money_modes.sql: assertions for migrations 0034 (multi-currency) and
-- 0035 (per-leg modes), M5 step Y1.1.
--
-- Plain SQL (NOT pgTAP), same shape as security_0031.sql: every check runs as
-- the real role (authenticated/anon/service_role + request.jwt.claims), any
-- failed assertion RAISEs (psql exits non-zero with ON_ERROR_STOP), and the
-- whole file is ONE transaction that is rolled back (no residue).
--
-- Run (local stack, after `npx supabase migration up --local`):
--   docker exec -i supabase_db_Tripvisor psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/m5_y11_money_modes.sql
--
-- Cast (fixed ids, all rolled back):
--   O  owner of trip T1 (home TRY) and trip T2 (home EUR)
--   E  accepted EDITOR on T1
--   V  accepted VIEWER on T1
--   N  non-member (owns nothing on T1)
-- Collaborator rows are seeded as postgres: since 0031 clients cannot write
-- trip_collaborators (manage-collaborators does it with the service role).

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;

-- ------------------------------------------------------------------
-- Seed (as postgres: bypasses RLS)
-- ------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('03410000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@m5y11.test',  'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('03410000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@m5y11.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('03410000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@m5y11.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', ''),
  ('03410000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nobody@m5y11.test', 'x', now(), '{"provider":"email"}', '{}', now(), now(), '', '', '', '');

insert into public.trips (id, user_id, title, currency, transport_mode) values
  ('03420000-0000-4000-8000-0000000000a1', '03410000-0000-4000-8000-00000000000a', 'm5y11 TRY trip', 'TRY', 'driving'),
  ('03420000-0000-4000-8000-0000000000a2', '03410000-0000-4000-8000-00000000000a', 'm5y11 EUR trip', 'EUR', 'walking');

insert into public.trip_collaborators (id, trip_id, invitee_email, user_id, role, status) values
  ('03430000-0000-4000-8000-0000000000e1', '03420000-0000-4000-8000-0000000000a1', 'editor@m5y11.test', '03410000-0000-4000-8000-00000000000e', 'editor', 'accepted'),
  ('03430000-0000-4000-8000-0000000000f1', '03420000-0000-4000-8000-0000000000a1', 'viewer@m5y11.test', '03410000-0000-4000-8000-00000000000f', 'viewer', 'accepted');

insert into public.trip_places (id, trip_id, google_place_id, lat, lng) values
  ('03440000-0000-4000-8000-0000000000a1', '03420000-0000-4000-8000-0000000000a1', 'GPID-M5Y11-1', 41.0, 29.0),
  ('03440000-0000-4000-8000-0000000000a2', '03420000-0000-4000-8000-0000000000a1', 'GPID-M5Y11-2', 41.1, 29.1),
  ('03440000-0000-4000-8000-0000000000a3', '03420000-0000-4000-8000-0000000000a1', 'GPID-M5Y11-3', 41.2, 29.2);

insert into public.trip_days (id, trip_id, day_index) values
  ('03450000-0000-4000-8000-0000000000a1', '03420000-0000-4000-8000-0000000000a1', 0);

-- Rates for 2026-07-01 (base EUR): TRY 35.5, USD 1.1.
insert into public.fx_rates (base, quote, rate_date, rate, source) values
  ('EUR', 'TRY', '2026-07-01', 35.5, 'frankfurter'),
  ('EUR', 'USD', '2026-07-01', 1.1,  'frankfurter');

\echo '=== 0034 §1 trips.currency (widened, owner-only) ==='

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000a","role":"authenticated"}', true) \g /dev/null
do $$
declare c text;
begin
  update public.trips set currency = 'CHF' where id = '03420000-0000-4000-8000-0000000000a2' returning currency into c;
  if c is distinct from 'CHF' then raise exception 'FAIL 1a: owner could not set a non-legacy ISO code (got %)', c; end if;
  update public.trips set currency = 'EUR' where id = '03420000-0000-4000-8000-0000000000a2';
  raise notice 'PASS 1a: owner sets trips.currency to any ISO code (CHF)';

  begin
    update public.trips set currency = 'chf' where id = '03420000-0000-4000-8000-0000000000a2';
    raise exception 'FAIL 1b: lower-case currency accepted';
  exception when check_violation then
    raise notice 'PASS 1b: lower-case code rejected';
  end;
  begin
    update public.trips set currency = 'EURO' where id = '03420000-0000-4000-8000-0000000000a2';
    raise exception 'FAIL 1b: 4-letter currency accepted';
  exception when check_violation then
    raise notice 'PASS 1b: 4-letter code rejected';
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000e","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  begin
    update public.trips set currency = 'EUR' where id = '03420000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 1c: editor changed trips.currency';
  exception when insufficient_privilege then
    raise notice 'PASS 1c: editor cannot change trips.currency (%)', sqlerrm;
  end;
  -- Control: the editor-writable budget column still works (0015 allow-list intact).
  update public.trips set total_budget = 5000 where id = '03420000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 1c control: editor total_budget update affected % rows', n; end if;
  raise notice 'PASS 1c control: editor can still set total_budget';
end $$;
reset role;

\echo '=== 0034 §2 fx_rates (authenticated read, service-role write) ==='

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.fx_rates where rate_date = '2026-07-01';
  if n <> 2 then raise exception 'FAIL 2a: authenticated sees % rate rows (expected 2)', n; end if;
  raise notice 'PASS 2a: any authenticated user can read fx_rates';
  begin
    insert into public.fx_rates (quote, rate_date, rate, source) values ('GBP', '2026-07-01', 0.85, 'forged');
    raise exception 'FAIL 2b: authenticated INSERT into fx_rates succeeded';
  exception when insufficient_privilege then
    raise notice 'PASS 2b: authenticated INSERT denied';
  end;
  begin
    update public.fx_rates set rate = 1 where quote = 'TRY';
    raise exception 'FAIL 2b: authenticated UPDATE on fx_rates was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS 2b: authenticated UPDATE denied';
  end;
  begin
    delete from public.fx_rates where quote = 'TRY';
    raise exception 'FAIL 2b: authenticated DELETE on fx_rates was not denied';
  exception when insufficient_privilege then
    raise notice 'PASS 2b: authenticated DELETE denied';
  end;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
do $$
begin
  begin
    perform 1 from public.fx_rates limit 1;
    raise exception 'FAIL 2c: anon can read fx_rates';
  exception when insufficient_privilege then
    raise notice 'PASS 2c: anon has no access to fx_rates';
  end;
end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
do $$
begin
  insert into public.fx_rates (quote, rate_date, rate, source) values ('GBP', '2026-07-01', 0.85, 'frankfurter')
  on conflict (base, quote, rate_date) do update set rate = excluded.rate, fetched_at = now();
  raise notice 'PASS 2d: service_role upserts fx_rates (base defaults to EUR)';
  begin
    insert into public.fx_rates (quote, rate_date, rate, source) values ('btc', '2026-07-01', 0.00001, 'currency-api');
    raise exception 'FAIL 2e: non-ISO quote accepted';
  exception when check_violation then
    raise notice 'PASS 2e: non-ISO quote rejected (writers must filter ^[A-Z]{3}$)';
  end;
  begin
    insert into public.fx_rates (quote, rate_date, rate, source) values ('JPY', '2026-07-01', 0, 'frankfurter');
    raise exception 'FAIL 2e: zero rate accepted';
  exception when check_violation then
    raise notice 'PASS 2e: non-positive rate rejected';
  end;
end $$;
reset role;

\echo '=== 0034 §3 trip_expenses money columns: roles + checks ==='

-- Editor writes foreign-currency expenses (frozen and pending).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000e","role":"authenticated"}', true) \g /dev/null
do $$
declare r record;
begin
  -- EUR 10, frozen at 35 TRY/EUR for the TRY home.
  insert into public.trip_expenses (id, trip_id, category, amount, kind, currency, fx_rate, fx_date, fx_home_currency)
  values ('03460000-0000-4000-8000-000000000001', '03420000-0000-4000-8000-0000000000a1', 'food', 10, 'actual',
          'EUR', 35, '2026-07-01', 'TRY');
  -- EUR 5, rate PENDING (offline entry): fx_date + home known, fx_rate NULL.
  insert into public.trip_expenses (id, trip_id, category, amount, kind, currency, fx_rate, fx_date, fx_home_currency)
  values ('03460000-0000-4000-8000-000000000002', '03420000-0000-4000-8000-0000000000a1', 'food', 5, 'actual',
          'EUR', null, '2026-07-01', 'TRY');
  select * into r from public.trip_expenses where id = '03460000-0000-4000-8000-000000000002';
  if r.currency <> 'EUR' or r.fx_rate is not null or r.fx_home_currency <> 'TRY' then
    raise exception 'FAIL 3a: pending expense was rewritten (currency=% fx_rate=% home=%)', r.currency, r.fx_rate, r.fx_home_currency;
  end if;
  raise notice 'PASS 3a: editor inserts frozen + pending foreign-currency expenses; explicit values untouched';

  -- A pre-M5 client inserts WITHOUT a currency: the 0034 §3d trigger freezes it at the home currency.
  insert into public.trip_expenses (id, trip_id, category, amount, kind)
  values ('03460000-0000-4000-8000-000000000003', '03420000-0000-4000-8000-0000000000a1', 'transport', 100, 'actual');
  select * into r from public.trip_expenses where id = '03460000-0000-4000-8000-000000000003';
  if r.currency <> 'TRY' or r.fx_rate <> 1 or r.fx_home_currency <> 'TRY' or r.fx_date is null then
    raise exception 'FAIL 3b: legacy insert not filled (currency=% fx_rate=% home=% date=%)', r.currency, r.fx_rate, r.fx_home_currency, r.fx_date;
  end if;
  raise notice 'PASS 3b: currency-less insert (pre-M5 client) filled as TRY @ 1, fx_date today (trigger fires for authenticated)';

  -- Editor edits the currency of an existing expense (editor parity).
  update public.trip_expenses set currency = 'USD', fx_rate = 32.27, fx_date = '2026-07-01'
   where id = '03460000-0000-4000-8000-000000000001';
  update public.trip_expenses set currency = 'EUR', fx_rate = 35
   where id = '03460000-0000-4000-8000-000000000001';
  raise notice 'PASS 3c: editor may change an expense currency/rate';

  -- Checks.
  begin
    insert into public.trip_expenses (trip_id, category, amount, currency) values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'eur');
    raise exception 'FAIL 3d: lower-case expense currency accepted';
  exception when check_violation then raise notice 'PASS 3d: lower-case expense currency rejected';
  end;
  begin
    insert into public.trip_expenses (trip_id, category, amount, currency, fx_rate, fx_date, fx_home_currency)
    values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'EUR', 0, '2026-07-01', 'TRY');
    raise exception 'FAIL 3d: zero fx_rate accepted';
  exception when check_violation then raise notice 'PASS 3d: non-positive fx_rate rejected';
  end;
  begin
    insert into public.trip_expenses (trip_id, category, amount, currency, fx_rate, fx_home_currency)
    values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'EUR', 35, 'TRY');
    raise exception 'FAIL 3d: frozen rate without fx_date accepted';
  exception when check_violation then raise notice 'PASS 3d: frozen rate without fx_date rejected';
  end;
  begin
    insert into public.trip_expenses (trip_id, category, amount, currency, fx_rate, fx_date)
    values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'EUR', 35, '2026-07-01');
    raise exception 'FAIL 3d: frozen rate without fx_home_currency accepted';
  exception when check_violation then raise notice 'PASS 3d: frozen rate without fx_home_currency rejected';
  end;
  begin
    -- (currency set: with a NULL currency the §3d filler would overwrite fx_home_currency)
    insert into public.trip_expenses (trip_id, category, amount, currency, fx_home_currency)
    values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'EUR', 'try');
    raise exception 'FAIL 3d: lower-case fx_home_currency accepted';
  exception when check_violation then raise notice 'PASS 3d: lower-case fx_home_currency rejected';
  end;
end $$;

-- Viewer: reads, never writes.
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000f","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.trip_expenses where trip_id = '03420000-0000-4000-8000-0000000000a1' and currency is not null;
  if n <> 3 then raise exception 'FAIL 3e: viewer sees % expenses with currency (expected 3)', n; end if;
  begin
    insert into public.trip_expenses (trip_id, category, amount, currency) values ('03420000-0000-4000-8000-0000000000a1', 'food', 1, 'EUR');
    raise exception 'FAIL 3e: viewer INSERT succeeded';
  exception when insufficient_privilege then raise notice 'PASS 3e: viewer INSERT denied by RLS';
  end;
  update public.trip_expenses set currency = 'USD' where id = '03460000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3e: viewer changed an expense currency (% rows)', n; end if;
  raise notice 'PASS 3e: viewer reads the money columns but cannot change them';
end $$;

-- Non-member: sees nothing.
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.trip_expenses where trip_id = '03420000-0000-4000-8000-0000000000a1';
  if n <> 0 then raise exception 'FAIL 3f: non-member sees % expenses', n; end if;
  update public.trip_expenses set currency = 'USD' where trip_id = '03420000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3f: non-member updated % expenses', n; end if;
  raise notice 'PASS 3f: non-member cannot read or write the trip expenses';
end $$;
reset role;

-- The §3c backfill statement, replayed on a row forced back to legacy NULL.
do $$
declare r record;
begin
  update public.trip_expenses set currency = null, fx_rate = null, fx_date = null, fx_home_currency = null
   where id = '03460000-0000-4000-8000-000000000003';
  update public.trip_expenses te
     set currency         = t.currency,
         fx_rate          = 1,
         fx_date          = (te.created_at at time zone 'utc')::date,
         fx_home_currency = t.currency
    from public.trips t
   where t.id = te.trip_id
     and te.currency is null
     and te.id = '03460000-0000-4000-8000-000000000003';
  select * into r from public.trip_expenses where id = '03460000-0000-4000-8000-000000000003';
  if r.currency <> 'TRY' or r.fx_rate <> 1 or r.fx_home_currency <> 'TRY' then
    raise exception 'FAIL 3g: backfill statement did not freeze the legacy row';
  end if;
  raise notice 'PASS 3g: backfill freezes a legacy row at the trip home currency, rate 1';
end $$;

\echo '=== 0034 §4 analytics MV converts to the home currency ==='

-- More rows, seeded as postgres (roles already proven above):
--   T1 (home TRY):
--     #1 EUR 10 actual, frozen 35 for TRY              -> 350
--     #2 EUR 5 actual, PENDING, fx_date 2026-07-01     -> 5 * 35.5        = 177.5 (re-derived from fx_rates)
--     #3 TRY 100 actual (filled)                       -> 100
--     #4 USD 20 estimated, frozen 0.9 for an OLD home EUR (home changed)
--                                                      -> 20 * 35.5/1.1   (re-derived)
--     #5 EUR 999 actual, TOMBSTONED                    -> excluded
--     #6 GBP 7 estimated, frozen 41 for OLD home EUR, no GBP/TRY rate cached on its fx_date
--                                                      -> PENDING (0038 / Wave-1 #4): excluded from the
--                                                         total, reported as pending {GBP: 7}. 0034 used
--                                                         7 * 41, a GBP->EUR rate applied to a TRY total.
--   T2 (home EUR):
--     #7 EUR 10 actual, frozen 0.028 for an OLD home TRY (currency = home now) -> 10
insert into public.trip_expenses (id, trip_id, category, amount, kind, currency, fx_rate, fx_date, fx_home_currency, deleted) values
  ('03460000-0000-4000-8000-000000000004', '03420000-0000-4000-8000-0000000000a1', 'shopping', 20,  'estimated', 'USD', 0.9,  '2026-07-01', 'EUR', false),
  ('03460000-0000-4000-8000-000000000005', '03420000-0000-4000-8000-0000000000a1', 'food',     999, 'actual',    'EUR', 35,   '2026-07-01', 'TRY', true),
  ('03460000-0000-4000-8000-000000000006', '03420000-0000-4000-8000-0000000000a1', 'other',    7,   'estimated', 'GBP', 41,   '2026-06-15', 'EUR', false),
  ('03460000-0000-4000-8000-000000000007', '03420000-0000-4000-8000-0000000000a2', 'food',     10,  'actual',    'EUR', 0.028,'2026-07-01', 'TRY', false);

refresh materialized view public.analytics_user_trip_stats;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000a","role":"authenticated"}', true) \g /dev/null
do $$
declare
  s record;
  want_est numeric := round(20 * 35.5 / 1.1, 6);
begin
  select * into s from public.get_my_trip_stats() where trip_id = '03420000-0000-4000-8000-0000000000a1';
  if s is null then raise exception 'FAIL 4a: owner has no stats row for T1'; end if;
  if s.total_actual_spend <> 627.5 then
    raise exception 'FAIL 4a: T1 actual spend = % (expected 627.5 = 350 + 177.5 + 100; tombstone excluded)', s.total_actual_spend;
  end if;
  if round(s.total_estimated_spend, 6) <> want_est then
    raise exception 'FAIL 4b: T1 estimated spend = % (expected % : the uncached GBP row is pending, not 7 * 41)', s.total_estimated_spend, want_est;
  end if;
  if s.pending_count <> 1
     or s.pending_actual_by_currency <> '{}'::jsonb
     or s.pending_estimated_by_currency <> '{"GBP": 7}'::jsonb then
    raise exception 'FAIL 4b: pending columns wrong (count %, actual %, estimated %)',
      s.pending_count, s.pending_actual_by_currency, s.pending_estimated_by_currency;
  end if;
  raise notice 'PASS 4a/4b: frozen, pending (re-derived), legacy and home-changed rows convert; the uncached row is pending {GBP: 7} (actual %, estimated %)',
    s.total_actual_spend, round(s.total_estimated_spend, 4);

  select * into s from public.get_my_trip_stats() where trip_id = '03420000-0000-4000-8000-0000000000a2';
  if s.total_actual_spend <> 10 then
    raise exception 'FAIL 4c: T2 actual spend = % (expected 10: currency equals the current home)', s.total_actual_spend;
  end if;
  raise notice 'PASS 4c: an expense already in the current home currency counts at 1 whatever its old frozen rate';

  begin
    perform 1 from public.analytics_user_trip_stats limit 1;
    raise exception 'FAIL 4d: authenticated can read the MV directly';
  exception when insufficient_privilege then
    raise notice 'PASS 4d: MV itself stays revoked (get_my_trip_stats is the only read path)';
  end;
end $$;

-- An accepted collaborator gets the trip row too (owner UNION collaborators, unchanged).
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000f","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.get_my_trip_stats() where trip_id = '03420000-0000-4000-8000-0000000000a1';
  if n <> 1 then raise exception 'FAIL 4e: viewer has % stats rows for T1 (expected 1)', n; end if;
  select count(*) into n from public.get_my_trip_stats() where trip_id = '03420000-0000-4000-8000-0000000000a2';
  if n <> 0 then raise exception 'FAIL 4e: viewer sees stats of a trip they are not on'; end if;
  raise notice 'PASS 4e: get_my_trip_stats still scopes rows to the caller';
end $$;
reset role;

\echo '=== 0035 §1–§3 per-leg modes: roles + checks ==='

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000e","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  update public.trip_places set arrival_mode = 'flight', arrival_minutes = 120
   where id = '03440000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 5a: editor arrival_mode update affected % rows', n; end if;
  update public.trip_places set arrival_mode = 'ferry', arrival_minutes = null
   where id = '03440000-0000-4000-8000-0000000000a3';
  update public.trip_days set transport_mode = 'transit' where id = '03450000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 5a: editor day transport_mode update affected % rows', n; end if;
  raise notice 'PASS 5a: editor sets arrival_mode/arrival_minutes and the day default mode';

  begin
    update public.trip_places set arrival_mode = 'boat' where id = '03440000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 5b: unknown arrival_mode accepted';
  exception when check_violation then raise notice 'PASS 5b: unknown arrival_mode rejected';
  end;
  begin
    update public.trip_places set arrival_mode = 'transit', arrival_minutes = 0 where id = '03440000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 5b: arrival_minutes 0 accepted';
  exception when check_violation then raise notice 'PASS 5b: arrival_minutes 0 rejected';
  end;
  begin
    update public.trip_places set arrival_mode = 'flight', arrival_minutes = 1441 where id = '03440000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 5b: arrival_minutes 1441 accepted';
  exception when check_violation then raise notice 'PASS 5b: arrival_minutes 1441 rejected';
  end;
  begin
    update public.trip_days set transport_mode = 'flight' where id = '03450000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 5b: flight accepted as a day default mode';
  exception when check_violation then raise notice 'PASS 5b: day default mode limited to the 4 routable modes';
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000f","role":"authenticated"}', true) \g /dev/null
do $$
declare n int; m text;
begin
  select arrival_mode into m from public.trip_places where id = '03440000-0000-4000-8000-0000000000a2';
  if m is distinct from 'flight' then raise exception 'FAIL 5c: viewer cannot read arrival_mode (got %)', m; end if;
  update public.trip_places set arrival_mode = 'walking' where id = '03440000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5c: viewer changed arrival_mode (% rows)', n; end if;
  update public.trip_days set transport_mode = 'walking' where id = '03450000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5c: viewer changed the day mode (% rows)', n; end if;
  raise notice 'PASS 5c: viewer reads the new mode columns but cannot write them';
end $$;

select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000b","role":"authenticated"}', true) \g /dev/null
do $$
declare n int;
begin
  update public.trip_places set arrival_mode = 'walking' where trip_id = '03420000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5d: non-member changed arrival_mode (% rows)', n; end if;
  raise notice 'PASS 5d: non-member cannot touch the trip places';
end $$;
reset role;

-- trip_legs.source (server-written; postgres here plays optimize-trip).
do $$
declare s text;
begin
  insert into public.trip_legs (id, trip_id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters)
  values ('03470000-0000-4000-8000-000000000001', '03420000-0000-4000-8000-0000000000a1',
          '03440000-0000-4000-8000-0000000000a1', '03440000-0000-4000-8000-0000000000a2', 0, 'driving', 600, 5000)
  returning source into s;
  if s <> 'ors' then raise exception 'FAIL 5e: trip_legs.source default is % (expected ors)', s; end if;
  insert into public.trip_legs (trip_id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters, source)
  values ('03420000-0000-4000-8000-0000000000a1', '03440000-0000-4000-8000-0000000000a2',
          '03440000-0000-4000-8000-0000000000a3', 0, 'flight', 7200, 900000, 'user');
  begin
    insert into public.trip_legs (trip_id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters, source)
    values ('03420000-0000-4000-8000-0000000000a1', '03440000-0000-4000-8000-0000000000a1',
            '03440000-0000-4000-8000-0000000000a3', 0, 'driving', 60, 100, 'mapbox');
    raise exception 'FAIL 5e: unknown leg source accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 5e: leg source defaults to ors, accepts user, rejects unknown providers';
end $$;

\echo '=== 0035 §4 duplicate_trip ==='

update public.trip_places set deleted = true where id = '03440000-0000-4000-8000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000a","role":"authenticated"}', true) \g /dev/null
do $$
declare
  v_copy uuid;
  t record;
  n int;
begin
  v_copy := public.duplicate_trip('03420000-0000-4000-8000-0000000000a1');
  select * into t from public.trips where id = v_copy;
  if t.currency <> 'TRY' then raise exception 'FAIL 6a: copy currency is % (expected the source home TRY)', t.currency; end if;
  select count(*) into n from public.trip_places where trip_id = v_copy;
  if n <> 2 then raise exception 'FAIL 6a: copy has % places (expected 2: tombstone skipped)', n; end if;
  if not exists (select 1 from public.trip_places where trip_id = v_copy and google_place_id = 'GPID-M5Y11-2'
                   and arrival_mode = 'flight' and arrival_minutes = 120 and day_index is null and order_in_day is null) then
    raise exception 'FAIL 6a: copied place lost arrival_mode/arrival_minutes or kept optimizer order';
  end if;
  if not exists (select 1 from public.trip_places where trip_id = v_copy and google_place_id = 'GPID-M5Y11-3'
                   and arrival_mode = 'ferry' and arrival_minutes is null) then
    raise exception 'FAIL 6a: ferry arrival_mode not copied';
  end if;
  select count(*) into n from public.trip_expenses where trip_id = v_copy;
  if n <> 0 then raise exception 'FAIL 6a: % expenses were cloned (ADR-0006: never)', n; end if;
  select count(*) into n from public.trip_days where trip_id = v_copy;
  if n <> 0 then raise exception 'FAIL 6a: trip_days were cloned'; end if;
  raise notice 'PASS 6a: duplicate keeps the home currency + arrival overrides; no expenses/days/legs cloned';
end $$;

select set_config('request.jwt.claims', '{"sub":"03410000-0000-4000-8000-00000000000e","role":"authenticated"}', true) \g /dev/null
do $$
begin
  begin
    perform public.duplicate_trip('03420000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL 6b: editor duplicated a trip they do not own';
  exception when insufficient_privilege then
    raise notice 'PASS 6b: duplicate_trip stays owner-only';
  end;
end $$;
reset role;

\echo '=== EXECUTE grants for 0034/0035 functions ==='

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
do $$
begin
  begin
    perform public.duplicate_trip('03420000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL 7a: anon executed duplicate_trip';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_my_trip_stats();
    raise exception 'FAIL 7a: anon executed get_my_trip_stats';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 7a: anon cannot execute duplicate_trip / get_my_trip_stats';
end $$;
reset role;

do $$
declare
  r record;
  bad text := '';
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    bad := bad || r.fn || ' ';
  end loop;
  if bad <> '' then raise exception 'FAIL 7b: anon has EXECUTE on: %', bad; end if;

  if not (has_function_privilege('authenticated', 'public.duplicate_trip(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.duplicate_trip(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.get_my_trip_stats()', 'execute')
      and has_function_privilege('service_role', 'public.get_my_trip_stats()', 'execute')) then
    raise exception 'FAIL 7b: authenticated/service_role lost EXECUTE on duplicate_trip / get_my_trip_stats';
  end if;
  if has_function_privilege('authenticated', 'public.trip_expenses_fill_currency_fn()', 'execute')
     or has_function_privilege('anon', 'public.trip_expenses_fill_currency_fn()', 'execute') then
    raise exception 'FAIL 7b: the trigger-only fill function is client-executable';
  end if;
  if has_table_privilege('anon', 'public.fx_rates', 'select')
     or has_table_privilege('authenticated', 'public.fx_rates', 'insert')
     or has_table_privilege('authenticated', 'public.fx_rates', 'update')
     or has_table_privilege('authenticated', 'public.fx_rates', 'delete')
     or not has_table_privilege('authenticated', 'public.fx_rates', 'select') then
    raise exception 'FAIL 7b: fx_rates table grants are not select-only for authenticated / none for anon';
  end if;
  if has_table_privilege('anon', 'public.analytics_user_trip_stats', 'select')
     or has_table_privilege('authenticated', 'public.analytics_user_trip_stats', 'select') then
    raise exception 'FAIL 7b: analytics MV is directly selectable by a client role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.fx_rates'::regclass) then
    raise exception 'FAIL 7b: RLS is not enabled on fx_rates';
  end if;
  raise notice 'PASS 7b: grant matrix as designed (no anon EXECUTE anywhere; fx_rates RLS on, read-only; MV revoked)';
end $$;

\echo '=== ALL m5_y11 CHECKS PASSED (rolling back) ==='
rollback;
