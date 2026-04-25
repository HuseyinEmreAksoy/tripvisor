-- Tripvisor Phase 19 follow-up — document the trip_shares INSERT-policy design.
--
-- Background
-- ----------
-- During Phase 19 testing the suite `tests/rls.share.test.ts` reported that an
-- authenticated user using the Supabase JS client cannot INSERT a trip_shares
-- row for their own trip. The query
--
--     userClient.from('trip_shares').insert({...}).select('id').single()
--
-- consistently returned `42501 new row violates row-level security policy`,
-- even though the WITH CHECK predicate on `trip_shares_owner_insert` was
-- satisfied (the caller really did own the trip).
--
-- Diagnosis
-- ---------
-- The failure is a well-known PostgreSQL RLS interaction: `INSERT ... RETURNING`
-- requires the inserted row to *also* satisfy a SELECT policy in order for the
-- RETURNING clause to read it back. `trip_shares` deliberately has NO SELECT
-- policy (see migration 0003) -- token values must not be visible to any client,
-- not even the owner, after creation. The Supabase JS chain `.insert(...).select(...)`
-- compiles to `INSERT ... RETURNING ...` at the SQL level, so the post-INSERT
-- visibility check fails and Postgres surfaces it with the same `42501` error
-- code that would normally indicate a WITH CHECK failure.
--
-- A bare `INSERT` (without `.select()` chained) does succeed under the user JWT
-- as long as the trip is owned by the caller. That was confirmed by direct
-- `psql` reproduction:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL "request.jwt.claims" = '{"sub":"<owner-uuid>","role":"authenticated"}';
--     INSERT INTO public.trip_shares (trip_id, token) VALUES (...);                -- succeeds
--     INSERT INTO public.trip_shares (trip_id, token) VALUES (...) RETURNING id;   -- 42501
--
-- Decision
-- --------
-- We keep the policies exactly as they are. The intended write path for
-- `trip_shares` is the `share-trip` Edge Function, which:
--
--   1. Verifies trip ownership using the caller's JWT against `trips` (RLS
--      enforces ownership there).
--   2. Performs the actual `trip_shares` INSERT with the service-role admin
--      client -- bypassing RLS entirely on the trip_shares write. This is the
--      only place service-role is used for this table.
--   3. Returns the freshly minted token to the caller exactly once. The token
--      is never readable from the client thereafter, which is the whole point.
--
-- The `trip_shares_owner_insert` policy is therefore defense-in-depth: it
-- guards against a bare `INSERT` from any client that somehow reaches the
-- table directly. It is intentionally NOT a path the application code uses,
-- because using it would either (a) require chaining `.select()` (which is
-- structurally impossible without a SELECT policy) or (b) accept a write
-- without confirmation, which is a worse developer experience than the
-- Edge Function flow we already have.
--
-- This migration only attaches `COMMENT ON POLICY` strings explaining the
-- design. No schema or policy logic changes.

comment on policy "trip_shares_owner_insert" on public.trip_shares is
  'Defense-in-depth: permits an authenticated owner to INSERT a share row for their own trip. Production writes do NOT use this path -- they go through the share-trip Edge Function, which validates ownership via the user JWT on the trips table and then performs the insert with the service-role admin client. A direct ".insert(...).select(...)" chain from the JS SDK will FAIL with 42501 because trip_shares has no SELECT policy and INSERT ... RETURNING requires SELECT visibility on the inserted row. A bare ".insert(...)" without .select() succeeds. See migration 0009 for the full rationale.';

comment on policy "trip_shares_owner_update" on public.trip_shares is
  'Defense-in-depth UPDATE policy. Cannot actually be exercised under a user JWT in practice: trip_shares has no SELECT policy, and Postgres requires a row to be SELECT-visible for UPDATE / DELETE to find it; an UPDATE under the user JWT therefore silently affects 0 rows. The share-trip Edge Function handleRevoke flow proves trip ownership via the user JWT against trips and then performs the UPDATE with the service-role admin client. This policy is kept as defense-in-depth in case the SELECT-policy design ever changes.';

comment on policy "trip_shares_owner_delete" on public.trip_shares is
  'Owner can DELETE share rows for trips they own. Not currently invoked by application code (revocation is preferred over deletion to preserve audit history), but kept for completeness and future cleanup tooling.';
