-- Tripvisor Phase 21 Step 21.7 follow-up: rewrite trip_accommodations RLS
-- to honour the collaboration access model.
--
-- Why this exists
-- ---------------
-- Two parallel slices landed in Phase 21:
--   - 0011_trip_collaborators.sql introduced the `user_can_access_trip`
--     helper and rewrote RLS on every trip-scoped child table
--     (trip_places / trip_days / trip_legs / trip_expenses) plus `trips`
--     itself to consult the helper instead of doing a raw owner check.
--   - 0012_trip_accommodations.sql created the new `trip_accommodations`
--     table with simple owner-only RLS, deliberately NOT referencing the
--     helper because it had no guarantee of migration ordering — see the
--     long-form note at the head of 0012 explaining why this was the
--     conservative call.
--
-- The two slices ran in parallel and 0012 ended up with file ordinal
-- AFTER 0011, but its RLS still uses the old owner-only pattern. Net
-- effect: collaborators (viewer or editor) on a trip cannot see or
-- modify that trip's accommodations, even though they can see and (as
-- editors) modify every other trip-scoped child. This is a bug — the
-- accommodations surface needs to mirror the rest of the trip detail
-- surface for collaborators.
--
-- Approach
-- --------
-- This migration is a clean drop-and-replace of the four
-- trip_accommodations_owner_* policies with the same shape that the
-- collaboration sweep applied to every other child table:
--
--   *_collab_select  — using (user_can_access_trip(trip_id, auth.uid(), 'viewer'))
--   *_collab_insert  — with check (user_can_access_trip(trip_id, auth.uid(), 'editor'))
--   *_collab_update  — using/with check (user_can_access_trip(trip_id, auth.uid(), 'editor'))
--   *_collab_delete  — using (user_can_access_trip(trip_id, auth.uid(), 'editor'))
--
-- Viewer = read-only. Editor = read + write. The owner is treated as
-- having editor (and beyond) by `user_can_access_trip` via its
-- short-circuit on `trips.user_id`, so we don't need to special-case it.
--
-- Drop-and-replace (rather than ALTER POLICY) for consistency with the
-- 0011 pattern and to keep policy NAMES uniform across all child tables.
-- Both DROP and CREATE run inside the same migration transaction, so
-- there is no window where the table is unprotected.
--
-- Rollback
-- --------
--   drop policy if exists "trip_accommodations_collab_select" on public.trip_accommodations;
--   drop policy if exists "trip_accommodations_collab_insert" on public.trip_accommodations;
--   drop policy if exists "trip_accommodations_collab_update" on public.trip_accommodations;
--   drop policy if exists "trip_accommodations_collab_delete" on public.trip_accommodations;
--   -- then re-create the trip_accommodations_owner_* policies from 0012
--   -- (see lines 154-169 of 0012_trip_accommodations.sql).

-- ============================================================
-- 1. Drop the temporary owner-only policies from 0012
-- ============================================================
drop policy if exists "trip_accommodations_owner_select" on public.trip_accommodations;
drop policy if exists "trip_accommodations_owner_insert" on public.trip_accommodations;
drop policy if exists "trip_accommodations_owner_update" on public.trip_accommodations;
drop policy if exists "trip_accommodations_owner_delete" on public.trip_accommodations;

-- ============================================================
-- 2. Re-create as collaborator-aware policies via user_can_access_trip
-- ============================================================
create policy "trip_accommodations_collab_select" on public.trip_accommodations
  for select to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'viewer'));

create policy "trip_accommodations_collab_insert" on public.trip_accommodations
  for insert to authenticated
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_accommodations_collab_update" on public.trip_accommodations
  for update to authenticated
  using      (public.user_can_access_trip(trip_id, auth.uid(), 'editor'))
  with check (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));

create policy "trip_accommodations_collab_delete" on public.trip_accommodations
  for delete to authenticated
  using (public.user_can_access_trip(trip_id, auth.uid(), 'editor'));
