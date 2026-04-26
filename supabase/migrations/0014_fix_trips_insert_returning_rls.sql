-- Fix trips INSERT ... RETURNING under collaborator-aware RLS.
--
-- 0011 changed the trips SELECT policy to delegate entirely to
-- user_can_access_trip(id, auth.uid(), 'viewer'). That helper is safe for
-- normal reads, but during INSERT ... RETURNING on trips the returned row is
-- checked by the SELECT policy before the helper can observe the just-inserted
-- row through its inner SELECT against public.trips. The insert WITH CHECK
-- passes, then RETURNING fails with:
--
--   new row violates row-level security policy for table "trips"
--
-- Keep collaborator reads through the helper, but restore the direct owner
-- predicate on the row itself so owner-created rows are visible immediately
-- during RETURNING.

drop policy if exists "trips_collab_select" on public.trips;

create policy "trips_collab_select" on public.trips
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.user_can_access_trip(id, auth.uid(), 'viewer')
  );
