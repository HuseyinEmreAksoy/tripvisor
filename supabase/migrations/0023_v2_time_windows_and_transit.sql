-- Tripvisor v2 Phase P1 — time-windows + real multi-leg transit
-- (BUILD-LOG P1.1 / P1.2; plan-v2.md post-track §P1)
--
-- Sections:
--   a. trip_places.arrive_after / leave_before — user-confirmed time windows (P1.1)
--   b. trip_legs.transit_steps                 — per-step transit geometry/metadata (P1.2)
--
-- Rollback
-- --------
--   alter table public.trip_legs   drop column if exists transit_steps;
--   alter table public.trip_places drop constraint if exists trip_places_time_window_check;
--   alter table public.trip_places drop column if exists leave_before;
--   alter table public.trip_places drop column if exists arrive_after;

-- ============================================================
-- a. trip_places time windows (BUILD-LOG P1.1)
-- ============================================================
--
-- Per-place visiting window, e.g. "don't arrive before 10:00" /
-- "be gone by 18:00". These feed the itinerary timeline's conflict
-- warnings ("arrives 18:40, closes 18:00") which are computed CLIENT-SIDE
-- against Tier-2 live opening hours.
--
-- Google ToS invariant (load-bearing — do not relax):
--   user-confirmed values only — NEVER auto-filled from Google opening
--   hours. Live opening hours are Tier-2 memory-only (React Query cache);
--   persisting them — including "copying" them into these columns on the
--   user's behalf — violates the project's Google ToS posture (only
--   google_place_id + coordinates are durable). See
--   docs/v2/risks-and-decisions.md (C3 — ToS "second door"). A user
--   *typing* "10:00" because they read it on the place card is fine; code
--   writing Google's hours into these columns is not.
--
-- Optimizer note (orchestrator scoping decision, P1): these columns are a
-- user-confirmed data + warning layer ONLY. The pure optimizer
-- (src/lib/optimizer/kmeans-2opt.ts) does NOT consume them in P1 — hard
-- time-window constraints in the solver are deferred (S2/post-GA).
--
-- RLS: NO policy change needed. trip_places policies (0011 §5a) are
-- row-level — SELECT viewer-gated, INSERT/UPDATE/DELETE editor-gated via
-- user_can_access_trip(trip_id, auth.uid(), ...) — and row-level policies
-- inherit to new columns automatically. Editors can therefore write these
-- columns through the existing policies (same precedent as
-- trip_days.start_time in 0020 §a and trip_days.notes in 0006).

alter table public.trip_places add column if not exists arrive_after time;
alter table public.trip_places add column if not exists leave_before time;

-- When both ends of the window are set, it must be a non-empty interval.
-- Either end may be set alone ("arrive after 10:00" with no departure
-- ceiling is valid, and vice versa). NULL = no constraint on that end.
-- Drop-then-add keeps re-runs idempotent (ADD CONSTRAINT has no IF NOT
-- EXISTS form).
alter table public.trip_places drop constraint if exists trip_places_time_window_check;
alter table public.trip_places add constraint trip_places_time_window_check
  check (
    arrive_after is null
    or leave_before is null
    or leave_before > arrive_after
  );

comment on column public.trip_places.arrive_after is
  'v2 P1.1 (0023): earliest time-of-day the user wants to arrive at this place. user-confirmed values only — NEVER auto-filled from Google opening hours (live hours are Tier-2 memory-only; persisting them violates the project''s Google ToS posture; see docs/v2/risks-and-decisions.md). NULL = no constraint. Warning layer only in P1 — the optimizer does not consume it. Editor-writable through the existing row-level trip_places RLS (0011 §5a) — no policy change required.';

comment on column public.trip_places.leave_before is
  'v2 P1.1 (0023): latest time-of-day the user wants to leave this place. user-confirmed values only — NEVER auto-filled from Google opening hours (live hours are Tier-2 memory-only; persisting them violates the project''s Google ToS posture; see docs/v2/risks-and-decisions.md). NULL = no constraint. When both ends are set, leave_before > arrive_after (trip_places_time_window_check). Editor-writable through the existing row-level trip_places RLS (0011 §5a) — no policy change required.';

-- ============================================================
-- b. trip_legs.transit_steps (BUILD-LOG P1.2)
-- ============================================================
--
-- Per-step transit geometry/metadata for mode='transit' legs, stored
-- verbatim from the directions-polyline Edge Function's optional
-- `transitSteps` response field (Google Routes API
-- routes.legs.steps[]): array of
--   { polyline: string|null, travelMode: 'WALK'|'TRANSIT',
--     lineName: string|null, vehicleType: string|null }
-- NULL for non-transit legs and for pre-P1 rows. Mirrors the TransitStep
-- type in src/api/types.ts.
--
-- Google ToS / 30-day TTL: this column is Google-derived (Routes API step
-- polylines + transit line names), so it falls under the same 30-day
-- retention ceiling as the rest of the row. No separate purge is needed:
-- the nightly pg_cron job (0019 §4b, tripvisor-trip-legs-ttl-purge-nightly)
-- deletes WHOLE trip_legs rows older than 30 days, which takes
-- transit_steps with it.
--
-- RLS: NO policy change needed — trip_legs policies (0011 §5c) are
-- row-level via user_can_access_trip and inherit to new columns. Writes
-- happen from the optimize-trip Edge Function (admin client), reads via
-- the viewer-gated SELECT policy.
--
-- Deploy order: apply this migration BEFORE deploying the P1 optimize-trip
-- Edge Function — its trip_legs INSERT includes transit_steps and would
-- fail with "column does not exist" against a pre-0023 schema.

alter table public.trip_legs add column if not exists transit_steps jsonb;

comment on column public.trip_legs.transit_steps is
  'v2 P1.2 (0023): per-step transit geometry/metadata for transit legs — jsonb array of { polyline, travelMode: WALK|TRANSIT, lineName, vehicleType } stored verbatim from directions-polyline''s transitSteps (Google Routes API routes.legs.steps). NULL for non-transit legs. Google-derived → covered by the 30-day ToS TTL automatically: the nightly purge (0019 §4b) deletes whole trip_legs rows, transit_steps included.';
