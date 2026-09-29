-- Tripvisor v2: per-owner daily cap on collaborator invites
-- (security audit 2026-09-29, finding #14 — invite spam)
--
-- manage-collaborators `invite` calls supabase.auth.admin.inviteUserByEmail,
-- which CREATES an auth.users row and sends an email for every new address.
-- Nothing bounded it: one account could mint unlimited auth users and use our
-- sender reputation to spam arbitrary inboxes.
--
-- Why a ledger counter and not "count trip_collaborators rows from the last
-- 24h": trip_collaborators rows CASCADE away with their trip (0011 FK), so
-- create-trip → invite → delete-trip would reset that count forever, and a
-- read-then-insert count races under concurrent requests. The counter below
-- is keyed on the OWNER (survives trip deletion; cascades only with the
-- account) and is consumed atomically.
--
-- Ledger: reuse public.ai_usage (0020 §c — "the quota table AND the usage
-- ledger", per-user per-UTC-day rows). This migration adds ONE counter and
-- ONE dedicated write path. It deliberately does NOT extend 0032's
-- consume_usage_quota(): that function's kind list belongs to the metered
-- Google/ORS functions, and re-creating it here would silently overwrite any
-- later edit to it. Same atomic shape, though:
--
--   consume_invite_quota(p_user, p_cap) → boolean
--     INSERT … ON CONFLICT (user_id, day) DO UPDATE … WHERE counter + 1 <= cap.
--     Concurrent invites serialize on the (user_id, day) row lock and READ
--     COMMITTED re-evaluates the WHERE against the committed row, so the
--     counter can never pass the cap. A rejected call consumes NOTHING (a 429
--     retry storm cannot wind it up). Window = UTC day (current_date), same
--     bucket semantics as every other ai_usage counter.
--
-- The cap is NOT stored here: it is DAILY_INVITE_CAP in
-- supabase/functions/manage-collaborators/index.ts ("tuning is a redeploy,
-- not a migration", 0020 §d). The per-TRIP pending-invite cap needs no
-- schema: the function counts live pending rows in trip_collaborators.
--
-- Privileges: EXECUTE for service_role ONLY (the Edge Function's admin client
-- passes the GoTrue-verified caller id). If `authenticated` could call it,
-- any user could burn another user's daily invite budget. Supabase's default
-- privileges grant EXECUTE on new public functions to anon + authenticated,
-- so both are revoked explicitly.
--
-- Additive + idempotent (`add column if not exists`, `create or replace`,
-- revoke/grant). Client contract: ai_usage SELECT-own RLS (0020) already
-- covers the new column; no client code reads it.
--
-- Deploy order: apply this migration BEFORE deploying manage-collaborators.
-- The function fails CLOSED (503 quota_unavailable) if the RPC is missing —
-- a mis-ordered deploy disables invites loudly instead of silently removing
-- the cap.
--
-- Inverse (rollback)
-- ------------------
--   -- roll back manage-collaborators first (it would 503 every invite otherwise)
--   drop function if exists public.consume_invite_quota(uuid, int);
--   alter table public.ai_usage drop column if exists collaborator_invites;

-- ============================================================
-- 1. Counter on the existing ledger
-- ============================================================

alter table public.ai_usage
  add column if not exists collaborator_invites int not null default 0;

comment on column public.ai_usage.collaborator_invites is
  '0033 (audit #14): collaborator invites sent by this user today (UTC). Written only by consume_invite_quota().';

-- ============================================================
-- 2. consume_invite_quota — atomic check-and-increment
-- ============================================================

create or replace function public.consume_invite_quota(
  p_user uuid,
  p_cap  int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user is null then
    raise exception 'consume_invite_quota: p_user is required';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'consume_invite_quota: p_cap must be >= 0';
  end if;
  if p_cap = 0 then
    return false;
  end if;

  insert into public.ai_usage as u (user_id, day, collaborator_invites)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update
    set collaborator_invites = u.collaborator_invites + 1
    where u.collaborator_invites + 1 <= p_cap;

  -- FOUND is true when the INSERT inserted a row or the guarded DO UPDATE
  -- updated one; false only when the cap WHERE rejected the update.
  return found;
end;
$$;

comment on function public.consume_invite_quota(uuid, int) is
  '0033 (audit #14): atomic per-owner per-UTC-day collaborator-invite cap over ai_usage.collaborator_invites. Returns true and consumes 1 when the new total stays <= p_cap; returns false and consumes NOTHING otherwise. Cap passed by the caller (DAILY_INVITE_CAP in supabase/functions/manage-collaborators/index.ts). SECURITY DEFINER, search_path pinned, EXECUTE for service_role only.';

revoke all on function public.consume_invite_quota(uuid, int) from public, anon, authenticated;
grant execute on function public.consume_invite_quota(uuid, int) to service_role;
