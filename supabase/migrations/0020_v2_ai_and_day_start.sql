-- Tripvisor v2 Phase N3 — AI core: per-day start time + AI run audit + usage quota
-- (BUILD-LOG N3.1–N3.3; plan-v2.md v2.1 §N3; docs/v2/architecture.md §AI pipeline)
--
-- Sections:
--   a. trip_days.start_time              — per-day itinerary start (timeline math, N1.2)
--   b. trip_ai_runs                      — append-only AI run audit + idempotency store
--   c. ai_usage + increment_ai_usage()   — C4 per-user quota table = usage ledger (day one)
--   d. note: daily quota CONSTANTS live in the Edge Function, not the DB
--
-- Rollback
-- --------
--   revoke all on function public.increment_ai_usage(uuid, int, int, int) from authenticated, service_role;
--   drop function if exists public.increment_ai_usage(uuid, int, int, int);
--   drop table if exists public.ai_usage;
--   drop table if exists public.trip_ai_runs;
--   alter table public.trip_days drop column if exists start_time;

-- ============================================================
-- a. trip_days.start_time (BUILD-LOG N1.2 data prerequisite)
-- ============================================================
--
-- Per-day itinerary start time. NULL means "client default" (09:00 — the
-- default lives client-side so changing it never needs a backfill). The
-- itinerary timeline computes per-stop arrival/departure chips as pure
-- client math: start_time + cumulative (visit minutes + trip_legs travel).
--
-- RLS: NO policy change needed. trip_days policies (0011 §5b) are
-- row-level — SELECT viewer-gated, INSERT/UPDATE/DELETE editor-gated via
-- user_can_access_trip(trip_id, auth.uid(), ...) — and row-level policies
-- inherit to new columns automatically (same precedent as trip_days.notes
-- in 0006, reviewed in docs/reviews/phase-9.md).

alter table public.trip_days add column if not exists start_time time;

comment on column public.trip_days.start_time is
  'v2 N3 (0020): per-day itinerary start. NULL = client default (09:00). Feeds the timeline''s computed per-stop arrival/departure (pure client math over visit minutes + trip_legs). Editor-writable through the existing row-level trip_days RLS (0011 §5b) — no policy change required.';

-- ============================================================
-- b. trip_ai_runs (BUILD-LOG N3.3 — idempotency + audit)
-- ============================================================
--
-- One row per *successful* AI run (status 'ok' or 'partial'), written by the
-- ai-itinerary Edge Function UNDER THE CALLER'S JWT — so the RLS below is
-- what actually gates the write; the function holds no special privilege
-- for this table.
--
-- Idempotency contract
-- --------------------
-- The client sends an idempotencyKey per planning intent. Before spending
-- any LLM/grounding credit, the function SELECTs by (user_id,
-- idempotency_key); a hit with status ok/partial replays the stored draft
-- for free. UNIQUE (user_id, idempotency_key) makes the race between two
-- concurrent identical requests converge: the loser's INSERT fails 23505
-- and it re-reads + returns the winner's draft.
--
-- Failed runs (llm_failed / grounding_failed / quota_exceeded) are NOT
-- inserted in N3 — deliberately:
--   1. The UNIQUE key must stay free so a retry with the same key can
--      succeed and store its draft (RLS below is append-only: no UPDATE
--      policy, so an upsert-on-retry is impossible by design).
--   2. Failures are still observable (structured Edge Function logs) and
--      still counted (ai_usage ledger increments whenever an LLM call was
--      actually dispatched).
-- The failure statuses are kept in the CHECK constraint so a future
-- service-role writer (e.g. N4 ai-edit telemetry) can record them without
-- a schema change.
--
-- Google ToS / privacy posture
-- ----------------------------
--   - draft jsonb holds ONLY durable-safe fields: place names,
--     google_place_id, lat/lng, visitMinutes, category, dayHint, plus the
--     unresolved name list and an LLM notes string. NEVER ratings, reviews,
--     photos, opening hours, phone, website, or attributions.
--   - prompt_hash is sha256 hex of the user prompt — the raw prompt is
--     never persisted (D4 data-minimization).

create table if not exists public.trip_ai_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- on delete SET NULL (not cascade): the audit row outlives the trip; the
  -- run still happened and still counts toward usage history.
  trip_id          uuid references public.trips(id) on delete set null,
  kind             text not null check (kind in ('plan', 'edit')),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 64),
  model            text not null,
  -- sha256 hex of the prompt — never the raw prompt (D4 data-minimization).
  prompt_hash      text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
  status           text not null check (status in ('ok', 'partial', 'llm_failed', 'grounding_failed', 'quota_exceeded')),
  draft            jsonb,
  tokens_in        int,
  tokens_out       int,
  created_at       timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

comment on table public.trip_ai_runs is
  'v2 N3.3: append-only audit + idempotency store for AI runs (ai-itinerary now; ai-edit in N4). One row per successful run; (user_id, idempotency_key) UNIQUE makes client retries replay the stored draft instead of double-billing Gemini RPD + Google grounding credit. draft jsonb holds ONLY ToS-durable fields (names + google_place_id + lat/lng + visitMinutes + category + dayHint + unresolved[] + notes) — never ratings/reviews/photos/hours. prompt_hash = sha256 hex, never the raw prompt. Written under the caller''s JWT so RLS applies; no UPDATE/DELETE policies (append-only).';

comment on column public.trip_ai_runs.draft is
  'The grounded draft the client reviews (draft staging — trip_places is written only when the user accepts, via normal client hooks). Shape: { places: [{ name, googlePlaceId, lat, lng, visitMinutes, category, dayHint }], unresolved: string[], notes: string|null, dayCount: int }. Durable-safe per Google ToS: no ratings/reviews/photos/hours ever.';

comment on column public.trip_ai_runs.prompt_hash is
  'sha256 hex digest of the user prompt. The raw prompt is NEVER persisted (D4 data-minimized posture).';

-- Idempotency lookup: WHERE user_id = $1 AND idempotency_key = $2 — served
-- by the UNIQUE constraint's index. No further index needed in N3.

alter table public.trip_ai_runs enable row level security;

-- SELECT: own rows only.
drop policy if exists "trip_ai_runs_own_select" on public.trip_ai_runs;
create policy "trip_ai_runs_own_select"
  on public.trip_ai_runs for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: own rows only. The optional trip_id must be a trip the caller can
-- at least VIEW (defense-in-depth: keeps audit rows meaningful and stops a
-- direct PostgREST caller from probing/associating foreign trip ids; the
-- Edge Function pre-validates this and returns a clean 400 instead).
drop policy if exists "trip_ai_runs_own_insert" on public.trip_ai_runs;
create policy "trip_ai_runs_own_insert"
  on public.trip_ai_runs for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      trip_id is null
      or public.user_can_access_trip(trip_id, auth.uid(), 'viewer')
    )
  );

-- NO UPDATE / DELETE policies: append-only audit. Rows vanish only via the
-- auth.users cascade (account deletion).

-- ============================================================
-- c. ai_usage — C4 quota + usage ledger (BUILD-LOG N3.3)
-- ============================================================
--
-- Panel decision: the C4 per-user quota table doubles as the USAGE LEDGER
-- from day one — AI runs, Google-metered grounding calls, and (from N5)
-- routing calls, bucketed per UTC day (`day` defaults to current_date and
-- the increment function stamps current_date; Supabase Postgres runs UTC,
-- so quota windows roll over at midnight UTC).
--
-- Clients can SELECT their own rows (quota meter UX); they can NEVER write.
-- The only write path is increment_ai_usage() below.

create table if not exists public.ai_usage (
  user_id          uuid not null references auth.users(id) on delete cascade,
  day              date not null default current_date,
  ai_runs          int  not null default 0,
  grounding_calls  int  not null default 0,
  routing_calls    int  not null default 0,
  primary key (user_id, day)
);

comment on table public.ai_usage is
  'v2 N3.3 (risk C4): per-user-per-UTC-day quota counters AND the usage ledger from day one (panel decision) — ai_runs (LLM calls dispatched), grounding_calls (Google place-details calls, Google-metered), routing_calls (reserved for N5 ORS/OSRM). Read-only to clients (own rows); written ONLY via increment_ai_usage(). Daily limit constants live in the Edge Functions (ai-itinerary: 10 plans/day), not the DB. P5.2 layers threshold alerts on top — presentation only.';

alter table public.ai_usage enable row level security;

-- SELECT: own rows only (lets the client render "7/10 plans used today").
drop policy if exists "ai_usage_own_select" on public.ai_usage;
create policy "ai_usage_own_select"
  on public.ai_usage for select
  to authenticated
  using (user_id = auth.uid());

-- NO INSERT/UPDATE/DELETE policies for clients — the ledger is written
-- exclusively through increment_ai_usage().

-- The single write path. SECURITY DEFINER so it can upsert the
-- policy-less table; search_path pinned per the 0011/0019 helper
-- conventions. Two guards:
--   1. negative increments rejected — a caller must not be able to wind
--      its own counters back below real spend (quota bypass);
--   2. an authenticated (non-service) caller may only touch their OWN row.
--      auth.uid() is NULL for the service-role JWT (no sub claim), which is
--      how the Edge Function's admin client passes an arbitrary p_user_id.
--      Without this guard, EXECUTE-to-authenticated would let any user
--      inflate another user's counters and lock them out for the day.
create or replace function public.increment_ai_usage(
  p_user_id   uuid,
  p_runs      int,
  p_grounding int,
  p_routing   int
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    raise exception 'increment_ai_usage: p_user_id is required';
  end if;
  if coalesce(p_runs, 0) < 0 or coalesce(p_grounding, 0) < 0 or coalesce(p_routing, 0) < 0 then
    raise exception 'increment_ai_usage: negative increments are not allowed';
  end if;
  if auth.uid() is not null and p_user_id is distinct from auth.uid() then
    raise exception 'increment_ai_usage: callers may only increment their own usage';
  end if;

  insert into public.ai_usage as u (user_id, day, ai_runs, grounding_calls, routing_calls)
  values (p_user_id, current_date, coalesce(p_runs, 0), coalesce(p_grounding, 0), coalesce(p_routing, 0))
  on conflict (user_id, day) do update
    set ai_runs         = u.ai_runs         + excluded.ai_runs,
        grounding_calls = u.grounding_calls + excluded.grounding_calls,
        routing_calls   = u.routing_calls   + excluded.routing_calls;
end;
$$;

comment on function public.increment_ai_usage(uuid, int, int, int) is
  'v2 N3.3: the ONLY write path into ai_usage (C4 quota + usage ledger). SECURITY DEFINER upsert keyed on (user_id, current_date) — UTC day buckets. Guards: no negative increments; authenticated callers are pinned to their own row (auth.uid() is NULL under the service-role JWT, which is how Edge Functions increment on a user''s behalf). Granted to authenticated AND service_role per the N3 panel decision.';

revoke all on function public.increment_ai_usage(uuid, int, int, int) from public, anon;
grant execute on function public.increment_ai_usage(uuid, int, int, int) to authenticated, service_role;

-- ============================================================
-- d. Quota constants
-- ============================================================
-- Deliberately NOT stored in the DB: the daily plan limit (10/day/user) is
-- a constant in supabase/functions/ai-itinerary/index.ts (DAILY_PLAN_LIMIT)
-- so tuning it is a function redeploy, not a migration. If per-user tiers
-- ever land, promote the limit into a table then — not before.
