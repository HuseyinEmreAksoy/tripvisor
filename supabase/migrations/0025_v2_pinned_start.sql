-- ============================================================================
-- 0025 — T1: editable timeline — user-pinned arrival times (v2 plan addendum
-- 2026-06-11; spec: docs/v2/features.md §L5, BUILD-LOG §T1).
--
-- Users can pin a clock time onto any scheduled stop ("be here at 14:00").
-- The client timeline (computeDayTimeline) treats the pin as an anchor: the
-- cursor jumps to the pin (early arrival = wait chip; a pin earlier than the
-- computed arrival = the existing conflict-chip language). Clearing the pin
-- restores the computed flow.
--
-- ToS note: this is USER-AUTHORED data (like arrive_after / leave_before in
-- 0023) — never derived from or auto-filled with Google data. It is therefore
-- durable-safe and Tier-1-syncable (S2).
--
-- Rollback: alter table public.trip_places drop column if exists pinned_start;
-- ============================================================================

alter table public.trip_places
  add column if not exists pinned_start time;

comment on column public.trip_places.pinned_start is
  'T1 editable timeline: user-pinned arrival time for this stop (local trip '
  'time-of-day). USER-AUTHORED ONLY — never auto-filled from Google data. '
  'NULL = arrival is computed from the day flow. The optimizer ignores this '
  'column (display-layer anchor); editor-writable via the existing '
  'trip_places RLS policies, which are row-scoped and inherit new columns.';
