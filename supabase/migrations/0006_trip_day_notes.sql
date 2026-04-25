-- Tripvisor Phase 9: trip_days.notes
--
-- Adds a free-text `notes` column to public.trip_days so users can attach a
-- per-day journal entry (Markdown, rendered client-side per ADR-0008).
--
-- Why nullable, no default: nullable expresses "no entry yet" without forcing
-- a row rewrite for every existing day; no default avoids backfilling rows
-- that may not exist (trip_days rows are sparsely populated — they're created
-- only when the user pins a start/end anchor or, going forward, writes a
-- note). Empty string and NULL are treated the same by the UI.
--
-- Why no index: notes are read on a single-row trip-detail query (joined to
-- trips by trip_id, ordered by day_index) and never filtered or searched on.
-- Adding an index would be pure overhead.
--
-- Why no RLS change: the existing `trip_days_via_trip` policy
-- (0001_init.sql) gates the row via the parent trip's user_id; new columns
-- inherit that coverage automatically.
--
-- Why no duplicate_trip change: the duplicate_trip RPC (0004_trip_lifecycle.sql)
-- intentionally does NOT clone trip_days rows per ADR-0006 — they are
-- recomputed by the optimizer on the new copy. So adding a column here has
-- no cascading effect on the RPC.
--
-- Rollback:
--   alter table public.trip_days drop column if exists notes;

alter table public.trip_days
  add column if not exists notes text;

comment on column public.trip_days.notes is
  'Free-text per-day notes / journal entry (Markdown, rendered client-side). Nullable.';
