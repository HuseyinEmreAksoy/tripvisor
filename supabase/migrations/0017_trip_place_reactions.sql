-- Tripvisor Phase 24 Step 24.1: per-user, per-place like/dislike reactions.
--
-- Why this exists
-- ---------------
-- Phase 24 introduces a "reactions" surface so collaborators on a trip can
-- each express their own opinion (liked / disliked) on each place that
-- has been added. The trip owner can see the spread; collaborators can
-- see each other's opinions. This is meaningfully different from a "vote"
-- (one-per-place per trip) — every collaborator gets a single, mutable
-- row per place, and the union of those rows powers the catalog views
-- (per-trip rollups + the cross-trip analytics screen in Step 24.x).
--
-- Why a separate table (not a column on trip_places)
-- --------------------------------------------------
-- Reactions are a many-to-many relationship between users and trip_places:
-- N collaborators × M places per trip. A column on trip_places would
-- collapse the dimension and force the owner's opinion to be the only one
-- representable. A dedicated child table with `(trip_place_id, user_id)`
-- as a uniqueness key gives us the natural shape and a cheap UPSERT path
-- (`ON CONFLICT (trip_place_id, user_id) DO UPDATE`).
--
-- Schema
-- ------
--   id              uuid pk
--   trip_place_id   uuid fk(trip_places) on delete cascade
--   user_id         uuid fk(auth.users) on delete cascade
--   reaction        text in ('liked','disliked')
--   created_at      timestamptz default now()
--   updated_at      timestamptz default now()
--   unique (trip_place_id, user_id) — one row per (place, user)
--
-- Indexes
-- -------
--   - (trip_place_id) — fast per-place lookup for the trip detail surface
--     (when rendering a place card we need every collaborator's reaction).
--   - (user_id, reaction) — the cross-trip analytics screen (Step 24.x)
--     queries "all places the current user liked across all their trips".
--     A composite index on (user_id, reaction) lets that scan be index-
--     only, with the result set already partitioned by reaction kind.
--   - The unique (trip_place_id, user_id) constraint creates an implicit
--     unique index that also serves the `useTripPlaceReaction` lookup
--     (single-row by (place, user)).
--
-- RLS
-- ---
-- Reactions are scoped to "users with at least viewer access to the
-- parent trip". Reactions are NOT trip edits — they are personal opinions
-- — so we deliberately gate INSERT/UPDATE/DELETE on the VIEWER role
-- rather than the EDITOR role. A read-only collaborator can still react.
--
-- The four policies below delegate to `public.user_can_access_trip`
-- (introduced in 0011) for the viewer-or-better gate. Each policy ALSO
-- pins `user_id = auth.uid()` for write paths so a collaborator can
-- never insert / update / delete another collaborator's reaction even
-- though they can SEE it.
--
-- updated_at trigger
-- ------------------
-- Reuses `public.set_updated_at()` from 0001_init.sql, matching the
-- convention used by trip_places / trip_expenses / trip_accommodations.
--
-- Rollback
-- --------
--   drop trigger if exists trip_place_reactions_set_updated_at on public.trip_place_reactions;
--   drop table   if exists public.trip_place_reactions;

-- ============================================================
-- 1. trip_place_reactions table
-- ============================================================
create table if not exists public.trip_place_reactions (
  id              uuid primary key default gen_random_uuid(),
  trip_place_id   uuid not null references public.trip_places(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  reaction        text not null check (reaction in ('liked','disliked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One reaction per (place, user). The UI's "toggle" semantics are
  -- expressed as an UPSERT: ON CONFLICT (trip_place_id, user_id) DO UPDATE.
  unique (trip_place_id, user_id)
);

comment on table public.trip_place_reactions is
  'Phase 24: per-user, per-place like/dislike reactions. Each collaborator (viewer or editor) on a trip may set a single reaction per place. Powers the trip-detail catalog rollups and the cross-trip analytics screen.';

comment on column public.trip_place_reactions.reaction is
  'liked | disliked. To "clear" a reaction the client DELETEs the row (no nullable third state). The Phase 24 API hook `useSetTripPlaceReaction` accepts null and routes to DELETE in that case.';

-- ============================================================
-- 2. Indexes
-- ============================================================

-- Fast per-place lookup for the trip detail render path (every place card
-- aggregates all collaborator reactions). The unique constraint on
-- (trip_place_id, user_id) creates a btree that ALSO serves single-place
-- scans, but a separate index on just (trip_place_id) is preferable for
-- the per-place fan-out query because we don't need user_id in the index
-- entry to satisfy it.
create index if not exists trip_place_reactions_trip_place_idx
  on public.trip_place_reactions (trip_place_id);

-- Cross-trip catalog: "show me all places I (or anyone) liked across all
-- my trips". (user_id, reaction) lets the analytics screen filter to
-- 'liked' or 'disliked' with an index-only scan.
create index if not exists trip_place_reactions_user_reaction_idx
  on public.trip_place_reactions (user_id, reaction);

-- ============================================================
-- 3. updated_at trigger (reuses public.set_updated_at from 0001_init.sql)
-- ============================================================
create trigger trip_place_reactions_set_updated_at
  before update on public.trip_place_reactions
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. RLS — viewer-gated reads, self-only writes
-- ============================================================
alter table public.trip_place_reactions enable row level security;

-- 4a. SELECT: anyone with viewer access to the PARENT trip sees ALL
-- reactions on that trip's places. This unlocks "see what your travel
-- companions liked" without leaking cross-trip data.
--
-- The predicate joins through trip_places to find the parent trip, then
-- delegates to `public.user_can_access_trip`. Phase 21's helper is
-- `security definer` so this nested EXISTS does not recurse through
-- trips' or trip_collaborators' RLS policies.
create policy "trip_place_reactions_collab_select"
  on public.trip_place_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_reactions.trip_place_id
        and public.user_can_access_trip(tp.trip_id, auth.uid(), 'viewer')
    )
  );

-- 4b. INSERT: a collaborator (viewer or editor) inserts ONLY their own
-- row. The WITH CHECK pins `user_id = auth.uid()` so a malicious caller
-- can't write a row impersonating another user. Viewer access is the
-- minimum bar — read-only collaborators can still react.
create policy "trip_place_reactions_collab_insert"
  on public.trip_place_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.trip_places tp
      where tp.id = trip_place_reactions.trip_place_id
        and public.user_can_access_trip(tp.trip_id, auth.uid(), 'viewer')
    )
  );

-- 4c. UPDATE: users update only their OWN row. We do NOT re-check the
-- trip-access predicate here because the access check happens implicitly
-- via the row's existence (which already passed the SELECT policy at
-- INSERT time and is still gated by SELECT for the UPDATE round trip).
-- Pinning user_id on both USING and WITH CHECK prevents a row from being
-- "moved" to another user's account.
create policy "trip_place_reactions_self_update"
  on public.trip_place_reactions for update
  to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4d. DELETE: users delete only their own row. Same self-only rule as
-- UPDATE. The trip owner CANNOT delete a collaborator's reaction (this
-- is intentional — reactions are personal opinions, not trip artefacts
-- the owner curates). If product later wants "owner can clear all
-- reactions on archive", that's a service-role Edge Function, not an
-- RLS widening.
create policy "trip_place_reactions_self_delete"
  on public.trip_place_reactions for delete
  to authenticated
  using (user_id = auth.uid());
