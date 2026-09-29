-- Tripvisor M5 Y1.1: multi-currency expenses (ADR-0012).
--
-- WHY: the product vision (2026-09-29) tracks expenses in ANY currency: keep the
-- original amount + currency, convert to the trip's home currency with a rate
-- FROZEN at entry (free ECB rates via the fx-rates Edge Function), and show a
-- per-currency breakdown. Until now trip_expenses.amount had no currency (it
-- implicitly used trips.currency, which a CHECK limited to 5 codes).
--
-- WHAT (all additive):
--   §1  trips.currency check widened from the 5-code list to ISO 4217 shape
--       `^[A-Z]{3}$`. trips.currency is the trip's HOME currency. It stays
--       OWNER-ONLY: the 0015/0026 enforce_trips_column_restrictions_fn deny
--       list already raises 42501 for an editor changing it, and this
--       migration does not touch that trigger (asserted in the SQL test).
--   §2  public.fx_rates: the daily rate cache (EUR-based) that the fx-rates Edge
--       Function (Y1.3) fills. Global reference data, not trip-scoped:
--       authenticated may SELECT, only the service role writes. anon: nothing.
--   §3  trip_expenses.{currency, fx_rate, fx_date, fx_home_currency} + checks,
--       a one-time backfill of legacy rows, and a BEFORE INSERT filler for
--       rows written by pre-M5 clients (see §3c).
--   §4  analytics MV redefined: spend totals are converted to the trip's home
--       currency (0029 mechanics: drop fn → drop MV → recreate MV + unique
--       index + REVOKE + fn + grants).
--
-- Expense money model (ADR-0012 §3; mirrored in src/api/types.ts TripExpense):
--   amount            original amount, in `currency` (unchanged column)
--   currency          original ISO code. NULL = legacy = "the trip's home
--                     currency at rate 1" (only pre-backfill rows, or a client
--                     that explicitly clears it)
--   fx_rate           home units per 1 original unit, frozen at entry. NULL =
--                     "rate pending" (entered offline with no cached rate; the
--                     Y2.2 reconciler fills it on reconnect)
--   fx_date           the rate date used (or wanted, while pending)
--   fx_home_currency  the home currency `fx_rate` converts INTO. When it no
--                     longer equals trips.currency (home changed), consumers
--                     re-derive from fx_rates at fx_date.
-- Editors MAY write all four (trip_expenses has had editor-level write RLS
-- since 0011's trip_expenses_collab_* policies, and no column trigger exists
-- on trip_expenses). Viewers stay read-only (unchanged RLS).
--
-- Deploy order (cloud): push this migration BEFORE shipping any client build
-- whose src/sync/allowlist.ts lists the new columns. The Tier-1 hydration
-- SELECT names every allowlisted column, so a client ahead of the DB gets a
-- PostgREST 400 on the trip_expenses root.
--
-- Inverse (local only):
--   §4  drop function if exists public.get_my_trip_stats();
--       drop materialized view if exists public.analytics_user_trip_stats;
--       then re-run 0029 §2–§3 verbatim (unconverted amount sums).
--   §3  drop trigger if exists trip_expenses_fill_currency on public.trip_expenses;
--       drop function if exists public.trip_expenses_fill_currency_fn();
--       alter table public.trip_expenses
--         drop constraint if exists trip_expenses_currency_check,
--         drop constraint if exists trip_expenses_fx_home_currency_check,
--         drop constraint if exists trip_expenses_fx_rate_check,
--         drop constraint if exists trip_expenses_fx_frozen_check,
--         drop column if exists fx_home_currency, drop column if exists fx_date,
--         drop column if exists fx_rate, drop column if exists currency;
--       (LOSSY: foreign-currency amounts become trip-currency amounts. Export first.)
--   §2  drop table if exists public.fx_rates;
--   §1  alter table public.trips drop constraint trips_currency_check;
--       alter table public.trips add constraint trips_currency_check
--         check (currency in ('USD','EUR','GBP','TRY','JPY'));
--       (fails if any trip already uses another code: re-map those first.)

-- ============================================================
-- §1. trips.currency: any ISO 4217 alphabetic code
-- ============================================================
-- Same constraint NAME as 0005 so tooling/grep keeps finding it. The regex is
-- the shape check only; the picker (Y3.2) lists what fx-rates supports.
alter table public.trips drop constraint if exists trips_currency_check;
alter table public.trips
  add constraint trips_currency_check check (currency ~ '^[A-Z]{3}$');

comment on column public.trips.currency is
  'M5 (0034): the trip HOME currency (ISO 4217, ^[A-Z]{3}$). total_budget and every converted expense total are in this unit. Owner-only (enforce_trips_column_restrictions_fn denies editors).';

-- ============================================================
-- §2. fx_rates: daily EUR-based rate cache (ADR-0012 §2)
-- ============================================================
-- One row per (base, quote, rate_date). base is ALWAYS 'EUR' by convention
-- (ADR-0012): the Edge Function stores the whole day's EUR→X table and serves
-- cross rates as r(to)/r(from), with r(EUR) = 1 (no EUR→EUR row is needed).
-- A weekend/holiday request resolves to the last published ECB day and is
-- stored under the REQUESTED date too, so rate_date lookups are exact.
-- Past dates never change (cached permanently); today's row is refreshed by
-- the function after 6 h (fetched_at). Size: ~30 quotes per used day.
--
-- Writers MUST store upper-case 3-letter codes only (the currency-api
-- fallback returns lower-case codes and non-ISO tokens such as crypto
-- tickers: filter to ^[A-Z]{3}$ before the upsert, or the whole batch fails
-- on the CHECK).
create table if not exists public.fx_rates (
  base        text        not null default 'EUR',
  quote       text        not null,
  rate_date   date        not null,
  rate        numeric     not null,
  source      text        not null,
  fetched_at  timestamptz not null default now(),
  primary key (base, quote, rate_date),
  constraint fx_rates_base_check   check (base  ~ '^[A-Z]{3}$'),
  constraint fx_rates_quote_check  check (quote ~ '^[A-Z]{3}$'),
  constraint fx_rates_rate_check   check (rate > 0),
  constraint fx_rates_source_check check (char_length(source) between 1 and 64)
);

-- The PK (base, quote, rate_date) serves every lookup: exact date, and the
-- "latest on or before D" read (backward index scan). No FK columns.

comment on table public.fx_rates is
  'M5 Y1.1 (0034, ADR-0012): daily FX rate cache, base EUR, one row per (base, quote, rate_date); rate = quote units per 1 base unit. Filled ONLY by the fx-rates Edge Function (service role). Readable by any authenticated user (non-sensitive public ECB data); anon has no access. Cross rate X→Y on day D = rate(Y)/rate(X), with rate(EUR) = 1.';
comment on column public.fx_rates.rate is 'Quote units per 1 base (EUR) unit, > 0. numeric (exact); round only at display.';
comment on column public.fx_rates.source is 'Provider tag written by fx-rates (e.g. frankfurter, currency-api). Free text, 1–64 chars.';

alter table public.fx_rates enable row level security;

-- Not trip-scoped, so the owner/editor/viewer split does not apply: every
-- signed-in user reads the same public reference data; nobody writes through
-- PostgREST (no INSERT/UPDATE/DELETE policy + no grant). The service role
-- bypasses RLS for the Edge Function's upserts.
drop policy if exists "fx_rates_authenticated_select" on public.fx_rates;
create policy "fx_rates_authenticated_select"
  on public.fx_rates for select
  to authenticated
  using (true);

-- Supabase default privileges grant ALL on new public tables to anon and
-- authenticated. Close them explicitly (RLS alone would already block anon
-- reads and all client writes; the grants make the intent auditable).
revoke all on public.fx_rates from public, anon, authenticated;
grant select on public.fx_rates to authenticated;
grant select, insert, update, delete on public.fx_rates to service_role;

-- ============================================================
-- §3. trip_expenses: original currency + frozen rate (ADR-0012 §3)
-- ============================================================

-- §3a. Columns (nullable; see the model in the header).
alter table public.trip_expenses
  add column if not exists currency         text,
  add column if not exists fx_rate          numeric,
  add column if not exists fx_date          date,
  add column if not exists fx_home_currency text;

-- §3b. Checks. Kept deliberately minimal: a Tier-1 write the server rejects is
-- retried forever by the sync engine (hydrate.ts header), so every rule here is
-- mirrored client-side in src/sync/mutations.ts (assertExpenseMoney) and throws
-- BEFORE the store write.
--   - codes are ISO-shaped;
--   - a rate is positive;
--   - a FROZEN rate (fx_rate not null) must say what it converts from and into,
--     and on which day. A pending rate (fx_rate null) may carry fx_date /
--     fx_home_currency (the reconciler needs the wanted date).
alter table public.trip_expenses drop constraint if exists trip_expenses_currency_check;
alter table public.trip_expenses
  add constraint trip_expenses_currency_check
  check (currency is null or currency ~ '^[A-Z]{3}$');

alter table public.trip_expenses drop constraint if exists trip_expenses_fx_home_currency_check;
alter table public.trip_expenses
  add constraint trip_expenses_fx_home_currency_check
  check (fx_home_currency is null or fx_home_currency ~ '^[A-Z]{3}$');

alter table public.trip_expenses drop constraint if exists trip_expenses_fx_rate_check;
alter table public.trip_expenses
  add constraint trip_expenses_fx_rate_check
  check (fx_rate is null or fx_rate > 0);

alter table public.trip_expenses drop constraint if exists trip_expenses_fx_frozen_check;
alter table public.trip_expenses
  add constraint trip_expenses_fx_frozen_check
  check (
    fx_rate is null
    or (currency is not null and fx_date is not null and fx_home_currency is not null)
  );

comment on column public.trip_expenses.amount is
  'Original amount in trip_expenses.currency (M5 0034; NULL currency = the trip home currency). Never pre-converted.';
comment on column public.trip_expenses.currency is
  'M5 (0034): original ISO 4217 code of amount. NULL = legacy = trip home currency at rate 1.';
comment on column public.trip_expenses.fx_rate is
  'M5 (0034): home units per 1 original unit, FROZEN at entry. NULL = rate pending (reconciled on reconnect).';
comment on column public.trip_expenses.fx_date is
  'M5 (0034): date of the rate used for fx_rate (or wanted, while pending).';
comment on column public.trip_expenses.fx_home_currency is
  'M5 (0034): the home currency fx_rate converts into. If it differs from trips.currency (home changed), re-derive from fx_rates at fx_date.';

-- §3c. Backfill legacy rows: freeze them at the trip's CURRENT home currency,
-- rate 1. This is what those amounts always meant (pre-M5 there was one
-- currency per trip), and freezing it now is what lets a LATER home-currency
-- change re-derive them correctly instead of silently relabelling TRY as EUR.
-- handle_times() bumps updated_at, so Tier-1 clients re-pull the rows through
-- their incremental `updated_at > last-sync` query and see the new fields.
-- fx_date = the day the row was created (UTC), the closest "entry date" known.
update public.trip_expenses te
   set currency         = t.currency,
       fx_rate          = 1,
       fx_date          = (te.created_at at time zone 'utc')::date,
       fx_home_currency = t.currency
  from public.trips t
 where t.id = te.trip_id
   and te.currency is null;

-- §3d. Pre-M5 clients (older OTA bundles / native binaries, flag-off v1 path)
-- keep inserting rows without a currency. Fill them the same way as the
-- backfill so no NEW legacy-NULL row appears. Only on INSERT and only when
-- currency is NULL: an M5 client always sends its own values, and an UPDATE is
-- never rewritten. SECURITY INVOKER: the inserting user already passed the
-- editor-level INSERT policy, so they can SELECT the parent trip under RLS.
-- The service role (duplicate/import paths) bypasses RLS and reads it too.
create or replace function public.trip_expenses_fill_currency_fn()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_home text;
begin
  if new.currency is null then
    select t.currency into v_home from public.trips t where t.id = new.trip_id;
    if v_home is not null then
      -- NULL currency means "the trip currency", so the row converts home →
      -- home at exactly 1. Any caller-supplied fx_rate / fx_home_currency for
      -- a NULL currency is meaningless and is replaced.
      new.currency         := v_home;
      new.fx_home_currency := v_home;
      new.fx_rate          := 1;
      new.fx_date          := coalesce(new.fx_date, (now() at time zone 'utc')::date);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.trip_expenses_fill_currency_fn() is
  'M5 (0034): BEFORE INSERT on trip_expenses. A row inserted with currency NULL (pre-M5 client) is frozen at the trip home currency, rate 1, fx_date today (UTC). Trigger-only; no client EXECUTE.';

-- Trigger function: EXECUTE is not checked when a trigger fires, and
-- PostgREST cannot call a `returns trigger` function. No role needs it.
revoke all on function public.trip_expenses_fill_currency_fn() from public, anon, authenticated;

drop trigger if exists trip_expenses_fill_currency on public.trip_expenses;
create trigger trip_expenses_fill_currency
  before insert on public.trip_expenses
  for each row execute function public.trip_expenses_fill_currency_fn();

-- ============================================================
-- §4. Analytics MV: spend in the trip's home currency
-- ============================================================
-- 0029 mechanics verbatim (drop the dependent function first, then the MV,
-- then recreate MV + unique index + REVOKE + function + grants). COLUMN SHAPE
-- IS UNCHANGED (get_my_trip_stats() / TripStatsRow in src/api/trip-stats.ts);
-- total_actual_spend / total_estimated_spend are now "in trips.currency".
-- The 0019 §4a pg_cron refresh job references the MV by name: no change.
--
-- Per-row conversion factor into the trip's CURRENT home currency (the same
-- precedence the client money lib uses, documented on TripExpense in
-- src/api/types.ts):
--   1. currency NULL or = trips.currency            → 1
--   2. frozen rate for the current home              → fx_rate
--   3. otherwise (home changed, or rate pending)     → re-derive from fx_rates
--      on fx_date: rate(home)/rate(currency), rate(EUR) = 1
--   4. still unknown                                 → coalesce(fx_rate, 1)
--      (ADR-0012's plain `amount * coalesce(fx_rate, 1)`; approximate, and it
--      self-heals on the next nightly refresh once the rate is cached)

drop function if exists public.get_my_trip_stats();
drop materialized view if exists public.analytics_user_trip_stats;

create materialized view public.analytics_user_trip_stats as
with user_trips as (
  -- Owner rows…
  select t.user_id, t.id as trip_id
  from public.trips t
  union
  -- …plus accepted, bound collaborators. UNION (not UNION ALL) dedupes the
  -- degenerate "owner also appears as collaborator" case defensively.
  select c.user_id, c.trip_id
  from public.trip_collaborators c
  where c.status = 'accepted'
    and c.user_id is not null
),
expense_totals as (
  -- 0029: tombstoned expenses never count. 0034: every amount is converted to
  -- the trip's home currency first (see the precedence above).
  select
    te.trip_id,
    coalesce(sum(te.amount * cv.home_rate) filter (where te.kind = 'actual'),    0) as total_actual_spend,
    coalesce(sum(te.amount * cv.home_rate) filter (where te.kind = 'estimated'), 0) as total_estimated_spend
  from public.trip_expenses te
  join public.trips t on t.id = te.trip_id
  cross join lateral (
    select case
      when te.currency is null or te.currency = t.currency then 1::numeric
      when te.fx_rate is not null and te.fx_home_currency = t.currency then te.fx_rate
      else coalesce(
        (case when t.currency = 'EUR' then 1::numeric
              else (select r.rate from public.fx_rates r
                     where r.base = 'EUR' and r.quote = t.currency and r.rate_date = te.fx_date)
         end)
        /
        (case when te.currency = 'EUR' then 1::numeric
              else (select r.rate from public.fx_rates r
                     where r.base = 'EUR' and r.quote = te.currency and r.rate_date = te.fx_date)
         end),
        te.fx_rate,
        1::numeric
      )
    end as home_rate
  ) cv
  where te.deleted = false
  group by te.trip_id
),
place_counts as (
  -- S2.8: tombstoned places are deleted-for-users — never count them.
  select tp.trip_id, count(*) as place_count
  from public.trip_places tp
  where tp.deleted = false
  group by tp.trip_id
),
reaction_counts as (
  -- Per (trip, reacting user): join through trip_places to find the trip.
  -- S2.8 tombstone hygiene on BOTH sides of the join (see 0028).
  select
    tp.trip_id,
    r.user_id,
    count(*) filter (where r.reaction = 'liked')    as liked_count,
    count(*) filter (where r.reaction = 'disliked') as disliked_count
  from public.trip_place_reactions r
  join public.trip_places tp
    on tp.id = r.trip_place_id
   and tp.deleted = false
  where r.deleted = false
  group by tp.trip_id, r.user_id
)
select
  ut.user_id,
  ut.trip_id,
  coalesce(et.total_actual_spend,    0)::numeric as total_actual_spend,
  coalesce(et.total_estimated_spend, 0)::numeric as total_estimated_spend,
  coalesce(rc.liked_count,    0)::int as liked_count,
  coalesce(rc.disliked_count, 0)::int as disliked_count,
  coalesce(pc.place_count,    0)::int as place_count
from user_trips ut
left join expense_totals  et on et.trip_id = ut.trip_id
left join place_counts    pc on pc.trip_id = ut.trip_id
left join reaction_counts rc on rc.trip_id = ut.trip_id
                            and rc.user_id = ut.user_id;

comment on materialized view public.analytics_user_trip_stats is
  'v2 N2.3 (tombstone-filtered in 0028 + 0029; currency-converted in 0034): per-(user, trip) analytics rollup. total_actual_spend/total_estimated_spend are in the trip HOME currency (trips.currency): each expense is converted by its frozen fx_rate, or re-derived from fx_rates at fx_date when the home changed / the rate is pending, else rate 1. place count, personal liked/disliked counts. Tombstones excluded. User dimension = owner UNION accepted collaborators. NO RLS possible on MVs: SELECT is revoked from anon/authenticated; clients read ONLY via get_my_trip_stats(). Refreshed nightly by pg_cron (concurrently — see the unique index).';

-- Restore everything the DROP lost (0029 §3 verbatim, + service_role per 0031).
create unique index if not exists analytics_user_trip_stats_user_trip_idx
  on public.analytics_user_trip_stats (user_id, trip_id);

-- MVs cannot carry RLS and Supabase default privileges re-grant SELECT on
-- the freshly-created relation — this REVOKE is load-bearing.
revoke all on public.analytics_user_trip_stats from anon, authenticated;

create or replace function public.get_my_trip_stats()
returns setof public.analytics_user_trip_stats
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select *
  from public.analytics_user_trip_stats
  where user_id = auth.uid();
$$;

comment on function public.get_my_trip_stats() is
  'v2 N2.3: the ONLY client read path for analytics_user_trip_stats (the MV itself is revoked — MVs cannot carry RLS). SECURITY DEFINER + WHERE user_id = auth.uid(). Returns one row per trip the caller owns or collaborates on (nightly-refreshed; pair with a live same-day fallback, P3.2). Spend totals are in each trip''s home currency since 0034. Call via supabase.rpc(''get_my_trip_stats'').';

-- 0031 matrix: authenticated (client RPC) + service_role; never anon/PUBLIC.
revoke all on function public.get_my_trip_stats() from public, anon;
grant execute on function public.get_my_trip_stats() to authenticated, service_role;
