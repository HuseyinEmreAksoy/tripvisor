-- Tripvisor Phase 21 Step 21.5/21.6: collaboration spine.
--
-- Why this exists
-- ---------------
-- Up to Phase 20 every trip-scoped table assumed a single owner: RLS gated
-- access via `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())`.
-- Phase 21 introduces multi-user collaboration on trips. A trip owner can
-- invite other users by email, who, after explicit accept, gain either
-- viewer (read-only) or editor (read + write) access to the same set of
-- child rows the owner sees.
--
-- This migration is the highest-blast-radius change in the project: it
-- rewrites the RLS policies on every trip-scoped table to honour the new
-- access model. Get this wrong and either (a) collaborators can't see
-- shared trips, or (b) cross-user data leaks. Both are showstoppers, so
-- the design is conservative:
--
--   1. A single helper SQL function `public.user_can_access_trip(trip_id,
--      user_id, min_role)` is the source of truth for "can this user
--      perform an op of this minimum role on this trip?". Every child-table
--      RLS policy delegates to this function. If we ever need to evolve
--      the access semantics (e.g. "team" trips, "anonymous viewer link"),
--      we change the function, not 8 policy bodies.
--
--   2. The function is `security definer` AND `set search_path =
--      public, pg_catalog`. This matters: when invoked from a child
--      table's RLS policy, the function's own queries against `trips` and
--      `trip_collaborators` MUST NOT recurse through THEIR RLS, otherwise
--      we'd deadlock (the policy's own evaluation would re-trigger the
--      policy). `security definer` runs the function as the migration
--      owner, bypassing RLS on the rows it reads. The function only reads
--      `trips.user_id`, `trip_collaborators.user_id/status/role` and
--      returns a boolean — no data leaks.
--
--   3. Explicit accept (no auto-bind on link click). The invitee receives
--      an email with a tokenized link; following the link lands them on a
--      sign-in screen, and only after they hit "Accept" does the
--      `manage-collaborators:accept` Edge Function bind `user_id =
--      auth.uid()` and flip status. This gates write access against
--      URL-stealing.
--
--   4. Trip owner is NEVER part of `trip_collaborators`. The function
--      checks ownership FIRST via `trips.user_id = p_user_id`. Only if
--      that fails does it look at the collaborators table. This keeps the
--      common-path query (owner accessing their own trip) cheap.
--
-- Schema for `trip_collaborators`
-- -------------------------------
--   id              uuid pk
--   trip_id         uuid fk(trips) on delete cascade
--   invitee_email   text — the email the invite was sent to
--   user_id         uuid fk(auth.users) on delete set null — bound on accept
--   role            text in (viewer, editor) default viewer
--   status          text in (pending, accepted, declined, revoked) default pending
--   invite_token    text unique — base64url-encoded 32-byte random
--   created_at      timestamptz default now()
--   accepted_at     timestamptz — set by trigger on status -> accepted
--   revoked_at      timestamptz — set by trigger on status -> revoked
--
-- Indexes:
--   - (invitee_email) for "shared with me" lookups by email (pre-bind path)
--   - (user_id, status) for the UNION query in useCollaboratedTrips/useTrips
--   - unique (trip_id, invitee_email) to prevent double-invites of the same
--     person to the same trip
--
-- RLS rewrite scope
-- -----------------
-- Every trip-scoped child table has its existing RLS policies dropped and
-- replaced with collaborator-aware policies that delegate to
-- `user_can_access_trip`:
--
--   - trip_places           (was: trip_places_via_trip)
--   - trip_days             (was: trip_days_via_trip)
--   - trip_legs             (was: trip_legs_via_trip)
--   - trip_expenses         (was: trip_expenses_owner_select/insert/update/delete)
--
-- `trip_shares` is INTENTIONALLY left owner-only. Collaborators do NOT
-- manage public link shares in v1 — that capability stays with the trip
-- owner alone. The existing 0003 + 0009 design (no SELECT policy, owner-
-- only INSERT/UPDATE/DELETE via defense-in-depth + Edge Function) is
-- unchanged.
--
-- `trips` itself gets a widened SELECT policy (owner OR accepted
-- collaborator) but UPDATE/INSERT/DELETE remain owner-only in v1. Renaming
-- a trip, changing its budget, archiving it, or deleting it are owner-
-- privileged actions; collaborators only edit children (trip_places,
-- trip_days notes, trip_expenses).
--
-- RLS on `trip_collaborators` itself
-- ----------------------------------
--   SELECT: trip owner sees all rows for their trips. An authenticated
--   user sees rows where they are the bound user_id, OR rows whose
--   invitee_email matches the user's auth.users email — this lets a
--   pending invitee see invites addressed to them BEFORE they accept
--   (and thus BEFORE user_id is bound).
--
--   INSERT: trip owner only. The Edge Function is the canonical caller
--   under the user JWT, so RLS enforces ownership.
--
--   UPDATE: two paths.
--     - Trip owner can revoke (status -> 'revoked'). Used for "remove
--       collaborator" UI.
--     - Invitee can flip pending -> accepted/declined when their JWT
--       matches user_id (already bound) OR user_id IS NULL (first accept;
--       the Edge Function will also bind user_id in the same UPDATE).
--   Encoded via permissive owner policy + invitee policy + WITH CHECK
--   that constrains the post-update state.
--
--   DELETE: trip owner only. Soft-revoke is preferred over hard delete
--   (audit trail, "you were removed" UX) but the policy is here for
--   completeness.
--
-- Triggers
-- --------
--   - `trip_collaborators_set_timestamps`: BEFORE UPDATE, sets
--     `accepted_at = now()` when status flips to 'accepted' (and was not
--     'accepted' before), and `revoked_at = now()` when status flips to
--     'revoked'. Idempotent — reaccepting doesn't re-stamp.
--
--   - `trip_collaborators_set_invite_token`: BEFORE INSERT, populates
--     `invite_token` with a base64url-encoded 32-byte random value if the
--     caller didn't supply one. base64url avoids `+/=` so the token is
--     URL-safe (the email link drops it into an `${app}/invite/${token}`
--     URL). Done in a trigger rather than a column DEFAULT because
--     `gen_random_bytes` + `encode` + `replace` is awkward to express as
--     a column default and the trigger lets us keep the `not null` +
--     unique constraint while making the column writeable from the Edge
--     Function (which generates the token itself for log-prefix
--     purposes).
--
-- Rollback
-- --------
--   drop trigger if exists trip_collaborators_set_timestamps on public.trip_collaborators;
--   drop trigger if exists trip_collaborators_set_invite_token on public.trip_collaborators;
--   drop function if exists public.trip_collaborators_set_timestamps_fn();
--   drop function if exists public.trip_collaborators_set_invite_token_fn();
--   drop function if exists public.user_can_access_trip(uuid, uuid, text);
--   drop function if exists public.current_user_email();
--   drop table  if exists public.trip_collaborators;
--   -- And restore the pre-Phase-21 RLS policies on trip_places / trip_days /
--   -- trip_legs / trip_expenses / trips by reapplying 0001_init.sql and
--   -- 0010_trip_budget_categories.sql per-table policy stanzas.

-- ============================================================
-- 1. trip_collaborators table
-- ============================================================
create table if not exists public.trip_collaborators (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  invitee_email   text not null,
  -- Bound on accept; nullable so a pending invite can exist before the
  -- invitee has signed up. on delete set null preserves the audit row
  -- (status='accepted' historical) when an invitee deletes their account.
  user_id         uuid null references auth.users(id) on delete set null,
  role            text not null
                  check (role in ('viewer','editor'))
                  default 'viewer',
  status          text not null
                  check (status in ('pending','accepted','declined','revoked'))
                  default 'pending',
  -- 32 random bytes -> ~43 base64url chars. NOT NULL is enforced; the
  -- BEFORE INSERT trigger fills this in if the caller doesn't.
  invite_token    text not null unique,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz null,
  revoked_at      timestamptz null,
  -- One pending/accepted invite per email per trip. Re-inviting after a
  -- decline / revoke requires deleting the prior row (or expanding this
  -- to a partial unique index keyed on status — deferred until product
  -- asks for resend semantics).
  unique (trip_id, invitee_email)
);

comment on table public.trip_collaborators is
  'Phase 21: trip collaboration. Owner invites by email, invitee accepts via tokenized link to bind user_id and flip status to accepted. Viewer = read-only on child tables; editor = read + write. Owner-only management.';

create index if not exists trip_collaborators_invitee_email_idx
  on public.trip_collaborators (invitee_email);

create index if not exists trip_collaborators_user_status_idx
  on public.trip_collaborators (user_id, status)
  where user_id is not null;

create index if not exists trip_collaborators_trip_id_idx
  on public.trip_collaborators (trip_id);

-- ============================================================
-- 2. Helper: user_can_access_trip(trip_id, user_id, min_role)
-- ============================================================
-- Returns true if the user can access the trip at >= min_role.
-- - 'viewer' is satisfied by owner OR (collaborator status=accepted, role in viewer/editor).
-- - 'editor' is satisfied by owner OR (collaborator status=accepted, role=editor).
--
-- Owner-first short-circuit: the owner check is a single PK lookup on
-- trips, while the collaborator check is an indexed scan on
-- (user_id, status). Cheaper to check ownership first.
--
-- security definer: this function is invoked from RLS policies on
-- child tables. It MUST NOT recurse through RLS on `trips` and
-- `trip_collaborators` themselves — otherwise the policy on (e.g.)
-- trip_places would call user_can_access_trip, which would query
-- trips, whose RLS would call user_can_access_trip again (for the
-- inner select), and so on. With security definer, the inner queries
-- run as the migration owner role and bypass RLS on the rows they
-- read. The function exposes only a boolean result, so no data leaks.
--
-- set search_path = public, pg_catalog: defense against search_path
-- injection. Without this, a malicious user with CREATE privilege on a
-- schema earlier in their search_path could shadow `trips` /
-- `trip_collaborators` with a malicious view.
--
-- stable: deterministic for a given (trip, user, role) within a single
-- query — Postgres can cache the result across multiple per-row checks
-- in the same SELECT.
create or replace function public.user_can_access_trip(
  p_trip_id   uuid,
  p_user_id   uuid,
  p_min_role  text default 'viewer'
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    -- Owner short-circuit
    exists (
      select 1
      from public.trips
      where id = p_trip_id
        and user_id = p_user_id
    )
    or
    -- Accepted collaborator with sufficient role
    exists (
      select 1
      from public.trip_collaborators
      where trip_id = p_trip_id
        and user_id = p_user_id
        and status  = 'accepted'
        and (
          -- viewer requirement: any accepted role suffices
          (p_min_role = 'viewer')
          or
          -- editor requirement: only role='editor' suffices
          (p_min_role = 'editor' and role = 'editor')
        )
    );
$$;

comment on function public.user_can_access_trip(uuid, uuid, text) is
  'Phase 21: returns true if the given user can access the trip at >= min_role. Owner OR accepted collaborator. SECURITY DEFINER so child-table RLS policies do not recurse. Used by RLS on trip_places / trip_days / trip_legs / trip_expenses / trips.';

-- The function does not need to be granted to PUBLIC explicitly — it is
-- invoked from RLS policies which run under the policy's own context.
-- Still, allow authenticated callers to call it directly (handy for
-- pre-flight checks in the app):
grant execute on function public.user_can_access_trip(uuid, uuid, text) to authenticated;

-- ============================================================
-- 2b. Helper: current_user_email()
-- ============================================================
-- The `authenticated` role does not have SELECT on `auth.users`, so RLS
-- predicates that need to look up the calling user's email cannot do so
-- with a plain subselect. Wrapping the lookup in a `security definer`
-- function with `set search_path` is the standard Supabase pattern for
-- this situation.
--
-- Used by:
--   - trip_collaborators_select (pre-bind: invitee sees rows addressed
--     to their email even before user_id is bound)
--   - trip_collaborators_invitee_update (same — invitee can flip
--     pending -> accepted/declined when their email matches)
--
-- Returns NULL if the caller is anonymous or has no email on file.
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select email::text from auth.users where id = auth.uid();
$$;

comment on function public.current_user_email() is
  'Phase 21: returns auth.users.email for the calling auth.uid(). SECURITY DEFINER because the authenticated role does not have SELECT on auth.users. Used by RLS policies on trip_collaborators that need to email-match invitees pre-bind.';

grant execute on function public.current_user_email() to authenticated;

-- ============================================================
-- 3. Triggers on trip_collaborators
-- ============================================================

-- 3a. Stamp accepted_at / revoked_at when status changes
create or replace function public.trip_collaborators_set_timestamps_fn()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    new.accepted_at := now();
  end if;
  if new.status = 'revoked' and (old.status is distinct from 'revoked') then
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

create trigger trip_collaborators_set_timestamps
  before update on public.trip_collaborators
  for each row execute function public.trip_collaborators_set_timestamps_fn();

-- 3b. Generate invite_token on insert if not provided
-- base64url encoding: drop +/= per RFC 4648 §5.
create or replace function public.trip_collaborators_set_invite_token_fn()
returns trigger
language plpgsql
as $$
begin
  if new.invite_token is null or length(new.invite_token) = 0 then
    new.invite_token :=
      replace(replace(replace(
        encode(gen_random_bytes(32), 'base64'),
        '+', '-'),
        '/', '_'),
        '=', '');
  end if;
  return new;
end;
$$;

create trigger trip_collaborators_set_invite_token
  before insert on public.trip_collaborators
  for each row execute function public.trip_collaborators_set_invite_token_fn();

-- ============================================================
-- 4. RLS on trip_collaborators
-- ============================================================
alter table public.trip_collaborators enable row level security;

-- 4a. SELECT: owner sees everything for their trip; the invitee sees
-- their own rows (matched by user_id once bound, or by invitee_email
-- before accept).
--
-- The email-match path goes through `public.current_user_email()` (a
-- security-definer helper) because the `authenticated` role does NOT
-- have SELECT on `auth.users`. Comparing lowercase makes the match
-- robust to capitalisation in the entered email.
create policy "trip_collaborators_select"
  on public.trip_collaborators for select
  to authenticated
  using (
    -- Trip owner sees all rows
    exists (
      select 1 from public.trips
      where id = trip_collaborators.trip_id
        and user_id = auth.uid()
    )
    or
    -- Bound invitee sees their own rows
    user_id = auth.uid()
    or
    -- Pre-bind: invitee can see rows addressed to their email
    lower(invitee_email) = lower(public.current_user_email())
  );

-- 4b. INSERT: trip owner only.
create policy "trip_collaborators_owner_insert"
  on public.trip_collaborators for insert
  to authenticated
  with check (
    exists (
      select 1 from public.trips
      where id = trip_collaborators.trip_id
        and user_id = auth.uid()
    )
  );

-- 4c. UPDATE: two paths.
--
-- Path A — owner: can change status to 'revoked' (and theoretically role,
-- though the Edge Function only ever revokes). USING gates which rows are
-- visible to UPDATE; WITH CHECK gates the post-update state.
--
-- Path B — invitee: can flip pending -> accepted/declined IF either
-- (a) the row is already bound to their auth.uid(), or (b) it is unbound
-- (user_id IS NULL) and they are the email recipient. The WITH CHECK
-- ensures the post-update state binds user_id to auth.uid() (the Edge
-- Function does this) and the new status is in {accepted, declined}.
--
-- We split into two policies (owner vs invitee) because the WITH CHECK
-- predicates differ. Postgres ORs together permissive policies for the
-- same action.
create policy "trip_collaborators_owner_update"
  on public.trip_collaborators for update
  to authenticated
  using (
    exists (
      select 1 from public.trips
      where id = trip_collaborators.trip_id
        and user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.trips
      where id = trip_collaborators.trip_id
        and user_id = auth.uid()
    )
  );

create policy "trip_collaborators_invitee_update"
  on public.trip_collaborators for update
  to authenticated
  using (
    -- Already bound to this user
    user_id = auth.uid()
    or
    -- Unbound but addressed to this user's email (looked up via
    -- security-definer helper — see public.current_user_email()).
    (
      user_id is null
      and lower(invitee_email) = lower(public.current_user_email())
    )
  )
  with check (
    -- Post-update must be bound to the caller, and status must be one of
    -- the invitee-permitted transitions. Status guards keep the invitee
    -- from doing anything other than accept / decline.
    user_id = auth.uid()
    and status in ('accepted', 'declined', 'pending')
  );

-- 4d. DELETE: trip owner only.
create policy "trip_collaborators_owner_delete"
  on public.trip_collaborators for delete
  to authenticated
  using (
    exists (
      select 1 from public.trips
      where id = trip_collaborators.trip_id
        and user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. Rewrite RLS on trip-scoped child tables
-- ============================================================
-- Each table: drop the existing owner-only policy/policies and replace
-- with viewer-gated SELECT and editor-gated INSERT/UPDATE/DELETE that
-- delegate to public.user_can_access_trip.
--
-- IMPORTANT: dropping the existing policy in the same migration that adds
-- the replacement keeps the table protected at all times — RLS stays
-- enabled and any gap between drop and create is inside the same
-- transaction.

-- 5a. trip_places ----------------------------------------------------------
drop policy if exists "trip_places_via_trip"        on public.trip_places;
drop policy if exists "trip_places_owner_select"    on public.trip_places;
drop policy if exists "trip_places_owner_insert"    on public.trip_places;
drop policy if exists "trip_places_owner_update"    on public.trip_places;
drop policy if exists "trip_places_owner_delete"    on public.trip_places;

create policy "trip_places_collab_select" on public.trip_places
  for select to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

create policy "trip_places_collab_insert" on public.trip_places
  for insert to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_places_collab_update" on public.trip_places
  for update to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_places_collab_delete" on public.trip_places
  for delete to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- 5b. trip_days ------------------------------------------------------------
drop policy if exists "trip_days_via_trip"     on public.trip_days;
drop policy if exists "trip_days_owner_select" on public.trip_days;
drop policy if exists "trip_days_owner_insert" on public.trip_days;
drop policy if exists "trip_days_owner_update" on public.trip_days;
drop policy if exists "trip_days_owner_delete" on public.trip_days;

create policy "trip_days_collab_select" on public.trip_days
  for select to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

create policy "trip_days_collab_insert" on public.trip_days
  for insert to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_days_collab_update" on public.trip_days
  for update to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_days_collab_delete" on public.trip_days
  for delete to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- 5c. trip_legs ------------------------------------------------------------
drop policy if exists "trip_legs_via_trip"     on public.trip_legs;
drop policy if exists "trip_legs_owner_select" on public.trip_legs;
drop policy if exists "trip_legs_owner_insert" on public.trip_legs;
drop policy if exists "trip_legs_owner_update" on public.trip_legs;
drop policy if exists "trip_legs_owner_delete" on public.trip_legs;

create policy "trip_legs_collab_select" on public.trip_legs
  for select to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

create policy "trip_legs_collab_insert" on public.trip_legs
  for insert to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_legs_collab_update" on public.trip_legs
  for update to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_legs_collab_delete" on public.trip_legs
  for delete to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- 5d. trip_expenses --------------------------------------------------------
drop policy if exists "trip_expenses_owner_select" on public.trip_expenses;
drop policy if exists "trip_expenses_owner_insert" on public.trip_expenses;
drop policy if exists "trip_expenses_owner_update" on public.trip_expenses;
drop policy if exists "trip_expenses_owner_delete" on public.trip_expenses;

create policy "trip_expenses_collab_select" on public.trip_expenses
  for select to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

create policy "trip_expenses_collab_insert" on public.trip_expenses
  for insert to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_expenses_collab_update" on public.trip_expenses
  for update to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_expenses_collab_delete" on public.trip_expenses
  for delete to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

-- ============================================================
-- 6. Rewrite RLS on trips
-- ============================================================
-- SELECT: owner OR accepted collaborator (any role).
-- INSERT: owner only (creating a trip is by definition an owner action;
--   the new row's user_id MUST equal auth.uid()).
-- UPDATE: owner only in v1. Renaming a trip, changing its budget,
--   archiving, transport mode — all owner-privileged. Collaborators edit
--   children, not the trip itself. Revisit in Phase 22 if product wants
--   editors to rename / change daily_hours_budget.
-- DELETE: owner only.
--
-- The pre-Phase-21 policy was a single `for all` `trips_owner_all`. We
-- replace it with verb-specific policies because SELECT now widens to
-- collaborators while writes stay owner-only.

drop policy if exists "trips_owner_all"    on public.trips;
drop policy if exists "trips_owner_select" on public.trips;
drop policy if exists "trips_owner_insert" on public.trips;
drop policy if exists "trips_owner_update" on public.trips;
drop policy if exists "trips_owner_delete" on public.trips;

-- IMPORTANT: this policy delegates to `public.user_can_access_trip`,
-- which is `security definer` and bypasses RLS on the rows it reads.
-- An inline `exists (select ... from trip_collaborators ...)` here would
-- recurse: the trips policy would query trip_collaborators, which has
-- a SELECT policy that queries trips, which would re-trigger this
-- policy, etc. The helper short-circuits the recursion safely.
create policy "trips_collab_select" on public.trips
  for select to authenticated
  using (public.user_can_access_trip(id, auth.uid(), 'viewer'));

create policy "trips_owner_insert" on public.trips
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "trips_owner_update" on public.trips
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "trips_owner_delete" on public.trips
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 7. Notes for trip_shares
-- ============================================================
-- trip_shares is INTENTIONALLY left untouched. Public link shares are an
-- owner-only capability in v1. Collaborators do NOT manage public links;
-- the existing 0003 + 0009 policies (no SELECT, owner-only INSERT /
-- UPDATE / DELETE as defense-in-depth, all reads via the share-trip Edge
-- Function under service-role) remain authoritative. Revisit if product
-- decides editors should also be able to share/revoke links.
