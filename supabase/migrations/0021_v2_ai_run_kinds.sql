-- Tripvisor v2 Phase N4 — widen trip_ai_runs.kind for the ai-edit Edge Function
-- (BUILD-LOG N4.1–N4.3; plan-v2.md v2.1 §N4; docs/v2/architecture.md §AI pipeline)
--
-- The new `ai-edit` function records three additional run kinds in the
-- append-only trip_ai_runs audit/idempotency store (0020 §b):
--   'edit'    — NL edit previews ("swap the museum") returned as a DIFF the
--               user accepts/rejects. The kind was already in the 0020 CHECK
--               (reserved for N4); listed here for completeness.
--   'suggest' — gap-fill suggestions for one day's spare minutes.
--   'ground'  — LLM-free grounding of a pasted/imported names list (the
--               import-places feature). No LLM is involved, so these rows
--               carry model = 'none' and do NOT count toward the daily AI-run
--               quota — they are budgeted against ai_usage.grounding_calls
--               instead (100 grounded names/user/day, constant in the
--               function).
--
-- Additive-safe: drop + re-add the inline CHECK (auto-named
-- trip_ai_runs_kind_check by Postgres) with the widened value set. All
-- existing rows are kind 'plan' (ai-itinerary was the only writer), so
-- re-validation always passes and the ACCESS EXCLUSIVE lock is momentary.
--
-- Constants note (supersedes the 0020 §d wording): the shared daily AI-run
-- limit (10/day/user) now lives in supabase/functions/_shared/ai.ts
-- (DAILY_RUN_LIMIT), consumed by both ai-itinerary and ai-edit. The
-- ground-budget limit (100 names/day) lives in ai-edit
-- (DAILY_GROUNDING_LIMIT). Still deliberately NOT in the DB: tuning is a
-- function redeploy, not a migration.
--
-- Rollback
-- --------
--   alter table public.trip_ai_runs drop constraint if exists trip_ai_runs_kind_check;
--   alter table public.trip_ai_runs add constraint trip_ai_runs_kind_check
--     check (kind in ('plan', 'edit'));
--   -- Only valid while no 'suggest'/'ground' rows exist; delete them first
--   -- otherwise. Then restore the 0020 versions of the two comments below.

alter table public.trip_ai_runs
  drop constraint if exists trip_ai_runs_kind_check;

alter table public.trip_ai_runs
  add constraint trip_ai_runs_kind_check
  check (kind in ('plan', 'edit', 'suggest', 'ground'));

-- Refresh the table/column docs to cover the new kinds and their draft
-- shapes (COMMENT ON replaces the 0020 text wholesale).

comment on table public.trip_ai_runs is
  'v2 N3.3 + N4: append-only audit + idempotency store for AI runs (ai-itinerary kind ''plan''; ai-edit kinds ''edit''/''suggest''/''ground''). One row per successful run; (user_id, idempotency_key) UNIQUE makes client retries replay the stored draft instead of double-billing LLM + Google grounding credit (replay lookups additionally filter on kind so a key can never replay across actions). draft jsonb holds ONLY ToS-durable fields — never ratings/reviews/photos/hours. prompt_hash = sha256 hex of the user-authored input (instruction / canonical params / names list), never raw text. kind ''ground'' rows are LLM-free: model = ''none'', budgeted via ai_usage.grounding_calls rather than ai_runs. Written under the caller''s JWT so RLS applies; no UPDATE/DELETE policies (append-only).';

comment on column public.trip_ai_runs.draft is
  'The staged result the client reviews — trip data is written only when the user accepts, via normal client hooks. Shape by kind: ''plan'' = { places: AiDraftPlace[], unresolved: string[], notes, dayCount }; ''edit'' = { diff: { adds: AiDraftPlace[], removes: [{tripPlaceId,name}], moves: [{tripPlaceId,name,toDay}], durationChanges: [{tripPlaceId,name,visitMinutes}], notes }, unresolved: string[] }; ''suggest'' = { suggestions: AiDraftPlace[], unresolved: string[] }; ''ground'' = { resolved: [{name,googlePlaceId,lat,lng}], unresolved: string[] }. AiDraftPlace = { name, googlePlaceId, lat, lng, visitMinutes, category, dayHint }. Durable-safe per Google ToS: names + place ids + coordinates only.';
