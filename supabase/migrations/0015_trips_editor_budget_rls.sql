-- Tripvisor Phase 22 Step 22.1: editors can update trips.total_budget only.
--
-- Why this exists
-- ---------------
-- Phase 21 (0011_trip_collaborators.sql) established collaborator semantics
-- on every trip-scoped child table, but kept `trips` itself owner-only on
-- writes. The Phase 21 budget UI lives on the trip detail screen — and an
-- editor collaborator who can add/edit `trip_expenses` against the trip's
-- ceiling can NOT change the ceiling itself. That's a usable but awkward
-- product seam: the editor sees a "Total budget: $1,000" card with no way
-- to nudge it up when the plan grows.
--
-- Phase 22 narrows the gap by allowing editors to update EXACTLY ONE
-- column on `trips`: `total_budget`. Title, dates, currency, transport
-- mode, daily_hours_budget, archived_at, optimizing_at, anchor_place_id,
-- timezone, cost_per_km — all stay strictly owner-only. Renaming, archiving,
-- changing the optimizer's inputs, etc. remain owner-privileged actions.
--
-- Design
-- ------
-- We do not rewrite the existing `trips_owner_update` policy (still
-- `using (user_id = auth.uid()) with check (user_id = auth.uid())`).
-- Instead, we ADD a permissive policy `trips_editor_budget_update` that
-- delegates to `public.user_can_access_trip(id, auth.uid(), 'editor')`.
-- Postgres ORs permissive policies for the same action — the owner
-- satisfies the owner policy, the editor satisfies the editor policy,
-- and viewers / non-collaborators satisfy neither and are denied.
--
-- The RLS policy alone is too coarse: it would let an editor update ANY
-- column. To clamp the post-update state to "only total_budget changed",
-- we add a `BEFORE UPDATE` trigger `enforce_trips_column_restrictions` on
-- `trips`. The trigger:
--
--   1. If `auth.uid() = OLD.user_id`, the caller is the owner. Return NEW
--      unchanged — owner can update everything. The owner check is
--      explicit (NOT delegated to user_can_access_trip) because the
--      helper would also accept editors-of-self if such a thing existed,
--      and we want a strict ownership signal here.
--
--   2. Otherwise the caller passed the editor RLS policy. Compare every
--      currently-known column on NEW vs OLD. If any column other than
--      `total_budget` (and `updated_at`, set by the existing
--      `trips_set_updated_at` BEFORE UPDATE trigger) differs, RAISE
--      EXCEPTION with sqlstate `'42501'` (`insufficient_privilege`).
--      Postgres surfaces 42501 to PostgREST as a 403, mirroring an RLS
--      denial — the client sees an `insufficient_privilege` error
--      regardless of whether the block came from RLS or this trigger.
--
-- Future-proofing: the diff is a defensive whitelist. If a future
-- migration adds a column to `trips` and forgets to update this
-- trigger, an editor's update of that new column will pass through
-- silently AS LONG AS the new column's value didn't change between
-- OLD and NEW. The PostgREST client only sends columns it explicitly
-- patches, but the server still observes OLD.* unchanged for omitted
-- columns, so an editor patching only `total_budget` will see `OLD.x =
-- NEW.x` for every other column and the trigger returns NEW unchanged.
-- The risk surface is "an editor crafts a request that touches both
-- total_budget AND some new column the trigger doesn't know about" —
-- which would slip through. Mitigation: the trigger comment explicitly
-- documents the maintenance contract: "any new column added to public.trips
-- MUST be added to this trigger's diff list".
--
-- Trigger ordering
-- ----------------
-- Postgres fires BEFORE UPDATE triggers in alphabetical order by name.
-- `enforce_trips_column_restrictions` sorts before `trips_set_updated_at`
-- alphabetically, so the column-restriction check runs first on the raw
-- NEW the client supplied (before updated_at gets bumped). This is the
-- desired order: we want to validate the user's intent, not whatever
-- the timestamp-update trigger happened to mutate.
--
-- Security
-- --------
-- - `language plpgsql security definer set search_path = public, pg_catalog`:
--   the trigger calls auth.uid(); security definer protects against any
--   future search-path tinkering. The body only reads OLD/NEW (passed in
--   by Postgres) and calls auth.uid() — no untrusted lookups.
-- - The owner check uses `OLD.user_id`, not NEW.user_id. An editor who
--   tried to "promote themselves to owner" by setting NEW.user_id =
--   auth.uid() would be flagged because user_id is not in the whitelist
--   (it would differ from OLD.user_id). Defense in depth.
--
-- Rollback
-- --------
--   drop trigger if exists enforce_trips_column_restrictions on public.trips;
--   drop function if exists public.enforce_trips_column_restrictions_fn();
--   drop policy if exists "trips_editor_budget_update" on public.trips;

-- ============================================================
-- 1. Editor-budget UPDATE policy on trips
-- ============================================================
-- Permissive. ORed with the existing trips_owner_update policy by
-- Postgres, so owners still match the owner policy and editors match
-- this one. Viewers / non-collaborators match neither and are denied.
create policy "trips_editor_budget_update" on public.trips
  for update to authenticated
  using      (public.user_can_access_trip(id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(id, auth.uid(), 'editor'));

comment on policy "trips_editor_budget_update" on public.trips is
  'Phase 22 Step 22.1: editor collaborators may UPDATE trips, but the enforce_trips_column_restrictions BEFORE UPDATE trigger restricts editor UPDATEs to changing only total_budget (plus the updated_at trigger column). Owners are unaffected — they match the trips_owner_update policy and the trigger short-circuits on OLD.user_id = auth.uid().';

-- ============================================================
-- 2. Trigger function: clamp editor UPDATEs to total_budget only
-- ============================================================
-- Whitelist diff: every currently-known column on public.trips except
-- `total_budget` (the one editors may change) and `updated_at` (set by
-- the existing trips_set_updated_at trigger; comparing it would be a
-- moving target).
--
-- Maintenance contract: any future migration that adds a column to
-- public.trips MUST add an `if NEW.<col> is distinct from OLD.<col> ...`
-- clause to this function. Otherwise the new column will be
-- silently editable by editors when they happen to touch it together
-- with total_budget. Tests for the new column's RLS should explicitly
-- exercise the editor path.
--
-- `is distinct from` (rather than `!=`) handles NULLs correctly —
-- a column going from NULL to NULL is "not distinct" (no change),
-- and from NULL to a value (or vice versa) is distinct (changed).
create or replace function public.enforce_trips_column_restrictions_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Owner short-circuit: owner can change anything. Use OLD.user_id
  -- (not NEW.user_id) so an editor cannot claim ownership by setting
  -- NEW.user_id = auth.uid() — that would be caught by the column diff
  -- below, but the explicit OLD-side check is cheaper and clearer.
  if auth.uid() = OLD.user_id then
    return NEW;
  end if;

  -- Caller is an editor (otherwise the RLS policies would have blocked
  -- the UPDATE before this trigger fires). Validate that ONLY
  -- total_budget (plus updated_at, handled by the timestamp trigger)
  -- changed. Any other column diff -> raise insufficient_privilege.

  if NEW.id is distinct from OLD.id then
    raise exception 'editor cannot change trips.id'
      using errcode = '42501';
  end if;
  if NEW.user_id is distinct from OLD.user_id then
    raise exception 'editor cannot change trips.user_id'
      using errcode = '42501';
  end if;
  if NEW.title is distinct from OLD.title then
    raise exception 'editor cannot change trips.title'
      using errcode = '42501';
  end if;
  if NEW.start_date is distinct from OLD.start_date then
    raise exception 'editor cannot change trips.start_date'
      using errcode = '42501';
  end if;
  if NEW.end_date is distinct from OLD.end_date then
    raise exception 'editor cannot change trips.end_date'
      using errcode = '42501';
  end if;
  if NEW.daily_hours_budget is distinct from OLD.daily_hours_budget then
    raise exception 'editor cannot change trips.daily_hours_budget'
      using errcode = '42501';
  end if;
  if NEW.anchor_place_id is distinct from OLD.anchor_place_id then
    raise exception 'editor cannot change trips.anchor_place_id'
      using errcode = '42501';
  end if;
  if NEW.transport_mode is distinct from OLD.transport_mode then
    raise exception 'editor cannot change trips.transport_mode'
      using errcode = '42501';
  end if;
  if NEW.timezone is distinct from OLD.timezone then
    raise exception 'editor cannot change trips.timezone'
      using errcode = '42501';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'editor cannot change trips.created_at'
      using errcode = '42501';
  end if;
  if NEW.archived_at is distinct from OLD.archived_at then
    raise exception 'editor cannot change trips.archived_at'
      using errcode = '42501';
  end if;
  if NEW.currency is distinct from OLD.currency then
    raise exception 'editor cannot change trips.currency'
      using errcode = '42501';
  end if;
  if NEW.cost_per_km is distinct from OLD.cost_per_km then
    raise exception 'editor cannot change trips.cost_per_km'
      using errcode = '42501';
  end if;
  if NEW.optimizing_at is distinct from OLD.optimizing_at then
    raise exception 'editor cannot change trips.optimizing_at'
      using errcode = '42501';
  end if;

  -- total_budget — the only column an editor may change. No check needed
  -- here; falling through means the only diff allowed by the whitelist
  -- is total_budget (and updated_at, handled separately by the
  -- timestamp trigger).
  return NEW;
end;
$$;

comment on function public.enforce_trips_column_restrictions_fn() is
  'Phase 22 Step 22.1: BEFORE UPDATE trigger function on public.trips. Owners (auth.uid() = OLD.user_id) bypass; editors are restricted to changing only total_budget. Raises 42501 (insufficient_privilege) on any other column diff. Maintenance contract: any new column on trips MUST be added to this whitelist diff or it will be silently editable by editors.';

-- ============================================================
-- 3. Trigger wiring
-- ============================================================
-- Name chosen so it sorts BEFORE `trips_set_updated_at` alphabetically
-- (e < t), which is the desired BEFORE-UPDATE firing order: validate
-- the user's intent before the timestamp trigger mutates updated_at.
drop trigger if exists enforce_trips_column_restrictions on public.trips;
create trigger enforce_trips_column_restrictions
  before update on public.trips
  for each row execute function public.enforce_trips_column_restrictions_fn();
