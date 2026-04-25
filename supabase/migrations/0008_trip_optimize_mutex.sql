-- Tripvisor Phase 13 — replace session-scoped advisory lock with a row-mutex
-- on trips.optimizing_at. Closes the C1 finding from docs/reviews/phase-12.md.
--
-- Why a row-mutex now
-- -------------------
-- The Phase 12 implementation used `pg_try_advisory_lock` / `pg_advisory_unlock`
-- via SECURITY DEFINER wrappers (migration 0007). Session-scoped advisory locks
-- are tied to the underlying Postgres backend connection. Supabase's PgBouncer
-- runs in transaction-pooling mode by default, which means each .rpc() call
-- from the Edge Function may be routed to a different backend connection. The
-- net effect: the unlock could land on a different backend than the one that
-- holds the lock, leaving the lock dangling until the holder backend cycles.
-- We logged this as a known limitation (C1) and are now fixing it.
--
-- Design
-- ------
-- A row-based mutex is atomic at the row level regardless of which backend
-- the connection is routed to. The claim is a single UPDATE wrapped in a SQL
-- function, which runs as its own implicit transaction:
--
--   UPDATE trips
--      SET optimizing_at = now()
--    WHERE id = p_trip_id
--      AND (optimizing_at IS NULL
--           OR optimizing_at < now() - make_interval(secs => p_ttl_seconds))
--   RETURNING true;
--
-- Atomicity properties:
--   * Two concurrent calls race on the same row. Postgres serializes via row
--     locks taken by UPDATE; only one will see the predicate satisfied and
--     return a row. The other returns no rows -> the SQL function yields
--     NULL, which we coalesce to false in the caller.
--   * No state lives in the connection — this is immune to PgBouncer
--     connection swaps because each UPDATE is its own transaction.
--
-- Trade-off
-- ---------
-- We lose automatic release on connection drop (advisory locks self-clear
-- when the backend dies). To compensate we add a TTL: if a holder crashes
-- mid-optimize, the row clears itself once now() exceeds optimizing_at + TTL
-- without operator intervention. We size the TTL at 5 minutes (default 300s)
-- vs. an observed worst-case optimize duration well under 30s for the
-- MAX_PLACES = 25 budget — 10x headroom for cold starts + retry while still
-- recovering from a hung function within minutes.
--
-- Tenancy
-- -------
-- These RPCs intentionally do NOT include `where user_id = auth.uid()`. They
-- are SECURITY DEFINER and granted only to service_role. The Edge Function
-- has already validated trip ownership via an RLS-scoped SELECT under the
-- caller's JWT before invoking these. Adding auth.uid() here would break the
-- service-role client path (auth.uid() is null under service-role) and
-- duplicate the check.
--
-- Rollback
-- --------
-- To undo this migration:
--   1. drop function if exists public.claim_trip_optimize(uuid, int);
--   2. drop function if exists public.release_trip_optimize(uuid);
--   3. (optional) recreate public.try_lock_trip(uuid) and public.unlock_trip(uuid)
--      from migration 0007 if the optimize-trip Edge Function is reverted to
--      the advisory-lock path.
--   4. alter table public.trips drop column if exists optimizing_at;
--
-- Step 1 — column on trips serving as the row-mutex.
alter table public.trips
  add column if not exists optimizing_at timestamptz null;

comment on column public.trips.optimizing_at is
  'Phase 13 row-mutex for serializing concurrent optimize-trip calls. NOT user-visible state. Set to now() when a claim is granted; cleared by release_trip_optimize on completion or auto-expires after the claim TTL passed to claim_trip_optimize (default 5 minutes) for stale-claim recovery if the Edge Function crashes mid-optimize.';

-- Step 2 — drop the unused 0007 advisory-lock wrappers. They have no other
-- callers; the optimize-trip Edge Function is the sole consumer and is being
-- migrated to the row-mutex in this same change set. Keeping them around
-- would be dead surface and a footgun. The 0007 migration file itself is
-- preserved in history for traceability.
drop function if exists public.try_lock_trip(uuid);
drop function if exists public.unlock_trip(uuid);

-- Step 3 — claim_trip_optimize: atomic try-claim with TTL-based stale recovery.
--
-- Returns true iff this call won the claim:
--   * the row had no prior claim (optimizing_at IS NULL), OR
--   * the prior claim is older than p_ttl_seconds (stale; we steal it).
-- Returns false otherwise (an unexpired claim is held by someone else, OR the
-- row does not exist — but the Edge Function has already validated existence
-- via an RLS-scoped SELECT, so the second case is not reachable in practice).
--
-- Implemented as a data-modifying CTE so the UPDATE runs as a subquery. We
-- then coalesce the (zero-or-one-row) result to false so the function always
-- returns a clean boolean. The whole statement is one transaction at the
-- Postgres level — atomic regardless of PgBouncer routing.
create or replace function public.claim_trip_optimize(
  p_trip_id uuid,
  p_ttl_seconds int default 300
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.trips
       set optimizing_at = now()
     where id = p_trip_id
       and (optimizing_at is null
            or optimizing_at < now() - make_interval(secs => p_ttl_seconds))
    returning true as ok
  )
  select coalesce((select ok from claimed), false);
$$;

comment on function public.claim_trip_optimize(uuid, int) is
  'Phase 13: row-mutex try-claim for optimize-trip. Atomic single-statement UPDATE — immune to PgBouncer connection swaps. Returns true if the caller won the claim (no prior claim, or prior claim older than p_ttl_seconds). TTL gives automatic stale-claim recovery if the holder crashes. service_role-only; tenancy already enforced by the Edge Function via RLS-scoped SELECT under the caller JWT before this is invoked.';

-- Step 4 — release_trip_optimize: unconditional clear.
--
-- The release is unconditional — any caller authorized to invoke this (i.e.
-- service_role) is trusted to release. There is no session-mismatch failure
-- mode (unlike pg_advisory_unlock). If the row wasn't claimed, the UPDATE is
-- a no-op.
create or replace function public.release_trip_optimize(p_trip_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trips
     set optimizing_at = null
   where id = p_trip_id;
$$;

comment on function public.release_trip_optimize(uuid) is
  'Phase 13: clears the row-mutex set by claim_trip_optimize. Unconditional — no-op if the row was not claimed. service_role-only; pair with claim_trip_optimize in a try/finally on the Edge Function side.';

-- Grants — service_role only. Same rationale as the 0007 wrappers: a
-- client-callable mutex keyed solely by trip UUID would let any signed-in
-- user grief any other trip's optimize flow. The optimize-trip Edge Function
-- calls these via the service-role admin client AFTER it has already
-- validated trip ownership under the user's JWT.
revoke all on function public.claim_trip_optimize(uuid, int) from public;
revoke all on function public.release_trip_optimize(uuid) from public;
grant execute on function public.claim_trip_optimize(uuid, int) to service_role;
grant execute on function public.release_trip_optimize(uuid) to service_role;
