-- Tripvisor Phase 12 — advisory-lock wrappers for optimize-trip serialization.
--
-- Why this exists
-- ---------------
-- The optimize-trip Edge Function previously called
--   admin.rpc('pg_advisory_xact_lock', { key: hashString(tripId) })
-- intending to serialize concurrent optimize calls per trip. That call was a
-- no-op in practice for two compounding reasons:
--
--   1. `pg_advisory_xact_lock` is a Postgres built-in, NOT a user-defined
--      function. PostgREST does not auto-expose built-in functions, so every
--      RPC call hit a 404 that was silently swallowed.
--
--   2. Even if a wrapper had existed, `pg_advisory_xact_lock` releases at
--      transaction end. supabase-js .rpc() runs each call in its own implicit
--      transaction that commits immediately, so the lock would have been
--      released before the next `await` ran in the Edge Function.
--
-- The fix is two thin SECURITY DEFINER wrappers around the SESSION-scoped
-- advisory-lock primitives. SESSION (not transaction) scope is required so
-- that the lock survives across the Edge Function's subsequent .rpc() /
-- query calls. The wrapper names mean PostgREST will expose them at
-- /rest/v1/rpc/try_lock_trip and /rest/v1/rpc/unlock_trip.
--
-- Design notes
-- ------------
-- * `pg_try_advisory_lock` (non-blocking try) is used instead of
--   `pg_advisory_lock` (blocking). If a concurrent optimize is already in
--   flight, we want to bail fast with `409 already_optimizing` rather than
--   serialize and double-charge the user's compute against the Google free
--   tier. Concurrent optimize requests for the same trip are almost always a
--   double-click bug, not intentional parallelism.
--
-- * `hashtextextended(uuid::text, 0)` hashes the UUID into a `bigint` lock
--   key. `pg_*_advisory_lock(bigint)` is the single-argument signature; the
--   per-trip-stable hash gives us a deterministic key with negligible
--   collision risk (2^64 keyspace, low optimize concurrency).
--
-- * `security definer` + `set search_path = public` is the standard
--   defensive pattern for RPCs called through PostgREST: it pins the schema
--   resolution so a malicious search_path on the caller cannot redirect the
--   underlying function calls. The wrappers themselves don't read or write
--   any user-owned table, so there's no row-level escalation risk from
--   running as definer.
--
-- * Granted to `service_role` ONLY. The optimize-trip Edge Function calls
--   these via the service-role admin client, so this is sufficient. We
--   intentionally do NOT grant to `authenticated`: a client-callable lock
--   keyed only by trip UUID would let any signed-in user grief any other
--   trip's optimize flow (e.g. via a leaked share URL — the UUID is the
--   sole authority). If we ever want direct-from-client serialization later
--   we'll wrap it in a function that checks `auth.uid()` against
--   `trips.user_id` and grant THAT to `authenticated`.
--
-- Rollback
-- --------
--   drop function if exists public.try_lock_trip(uuid);
--   drop function if exists public.unlock_trip(uuid);

create or replace function public.try_lock_trip(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_try_advisory_lock(
    hashtextextended(p_trip_id::text, 0)
  );
$$;

create or replace function public.unlock_trip(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_advisory_unlock(
    hashtextextended(p_trip_id::text, 0)
  );
$$;

-- service_role only — see "Granted to" note above for why this is NOT
-- exposed to `authenticated`.
revoke all on function public.try_lock_trip(uuid) from public;
revoke all on function public.unlock_trip(uuid) from public;
grant execute on function public.try_lock_trip(uuid) to service_role;
grant execute on function public.unlock_trip(uuid) to service_role;

comment on function public.try_lock_trip(uuid) is
  'Phase 12: non-blocking session-scoped advisory lock keyed by trip id. Returns true if acquired, false if another session holds it. Pair with unlock_trip in a try/finally.';

comment on function public.unlock_trip(uuid) is
  'Phase 12: releases the session-scoped advisory lock acquired by try_lock_trip for the same trip id.';
