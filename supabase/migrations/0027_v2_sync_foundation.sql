-- Tripvisor v2 Phase S2 Wave 1 — sync-engine schema foundation (BUILD-LOG S2.1).
--
-- Prepares the eight Tier-1 synced roots for the Legend-State ⇄ Supabase
-- offline engine (docs/v2/architecture.md §"Sync & conflict model"):
--
--   trips · trip_places · trip_days · trip_expenses · trip_accommodations ·
--   trip_place_reactions · trip_place_comments · trip_packing_items
--
-- Seven clearly-separated sections, all idempotent (re-runs no-op):
--
--   1. `handle_times()`          — server-stamped created_at/updated_at trigger fn
--   2. trip_days timestamps      — created_at/updated_at (table had none; migration.md §0)
--   3. Soft-delete sweep         — `deleted boolean` on synced roots where missing
--   4. Comments updated_at fix   — backfill NULL → created_at, then NOT NULL
--   5. trip_places.manual_rank   — user-intent order, fractional index (C1 refinement)
--   6. Trigger swap              — `<table>_handle_times` replaces `<table>_set_updated_at`
--   7. Realtime publication      — add trips + trip_place_reactions + trip_packing_items
--
-- Conflict model this enables (per-field LWW, NOT CRDT):
--   - `updated_at` is the conflict clock and is SERVER-stamped: clients can
--     never supply their own (handle_times overwrites it on INSERT and
--     UPDATE). A stale offline write can therefore never claim to be newer
--     than a fresher server row.
--   - `created_at` is client-suppliable on INSERT (an offline-created row
--     keeps its true creation moment) but immutable afterwards.
--   - `deleted` is the soft-delete tombstone: the row survives so offline
--     replicas converge on the deletion (a hard DELETE has no row left to
--     carry the fact through an incremental `updated_at > last-sync` pull).
--
-- Deliberate NON-changes (read before "fixing"):
--   - `trips` gets NO `deleted` column. Archive (`archived_at`, 0004) IS the
--     trips lifecycle: users archive/unarchive trips, they don't tombstone
--     them, and account deletion hard-cascades via the auth.users FK. Adding
--     a second, parallel "gone" flag would create two sources of truth.
--   - `trip_legs` gets NO deleted / NO handle_times / NO realtime change.
--     Legs are SERVER-AUTHORITATIVE optimizer output (C1): written only by
--     the optimize-trip Edge Function, purged nightly by the 30-day ToS TTL
--     job (0019 §4b), and read-only on the client. They are never LWW-merged
--     — syncing them client→server could resurrect ToS-expired Google
--     polylines (risk R4). `computed_at` remains their only clock.
--   - `set_updated_at()` (0001) is KEPT — `app_config` (0022) still uses it,
--     and it remains the default for future non-synced tables.
--
-- Rollback
-- --------
--   -- 7. (per table, guarded like the DO block below)
--   --    alter publication supabase_realtime drop table public.trips;
--   --    alter publication supabase_realtime drop table public.trip_place_reactions;
--   --    alter publication supabase_realtime drop table public.trip_packing_items;
--   -- 6. For each of the 8 roots:
--   --    drop trigger if exists <table>_handle_times on public.<table>;
--   --    create trigger <table>_set_updated_at before update on public.<table>
--   --      for each row execute function public.set_updated_at();
--   --    (trip_days had no trigger before this migration — just drop its handle_times.)
--   -- 5. alter table public.trip_places drop column if exists manual_rank;
--   --    drop index if exists trip_places_updated_at_idx; (and the other *_updated_at_idx)
--   -- 4. alter table public.trip_place_comments alter column updated_at drop not null;
--   --    (the backfilled values are harmless to keep)
--   -- 3. alter table public.<table> drop column if exists deleted; (per table added here)
--   -- 2. alter table public.trip_days drop column if exists created_at, drop column if exists updated_at;
--   -- 1. drop function if exists public.handle_times();  (after section 6 rollback)

-- ============================================================
-- 1. handle_times() — server-stamped timestamps for synced roots
-- ============================================================
--
-- Replaces set_updated_at() on the Tier-1 synced roots. Differences that
-- matter to the sync engine:
--
--   INSERT: created_at := coalesce(client value, now())  — an offline-created
--           row may carry its true creation moment; never NULL afterwards.
--           updated_at := now() ALWAYS — the server receipt time is the
--           conflict clock; a client-supplied value is overwritten so a
--           replayed offline INSERT can never antedate itself below another
--           client's last-sync watermark (rows would vanish from their
--           incremental pulls).
--   UPDATE: created_at := OLD.created_at — immutable, even against a
--           malicious/buggy client payload.
--           updated_at := now() ALWAYS.
--
-- now() is stable within a transaction, so a server-side INSERT gets
-- created_at == updated_at exactly; "this row was edited after creation" is
-- expressible as updated_at > created_at.

create or replace function public.handle_times()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
  elsif (tg_op = 'UPDATE') then
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.handle_times() is
  'v2 S2.1: BEFORE INSERT OR UPDATE trigger fn for the Tier-1 synced roots (trips, trip_places, trip_days, trip_expenses, trip_accommodations, trip_place_reactions, trip_place_comments, trip_packing_items). updated_at is SERVER-stamped on every write — it is the sync engine''s per-field LWW conflict clock and clients must never supply their own. created_at: client-suppliable on INSERT (offline-created rows keep their true creation time), immutable on UPDATE. Non-synced tables (app_config) keep set_updated_at().';

-- ============================================================
-- 2. trip_days: created_at / updated_at (migration.md §0 flagged the gap)
-- ============================================================
--
-- 0001 created trip_days with NO timestamps. The sync engine needs both
-- (changesSince pulls filter on updated_at > last-sync). `default now()` is
-- volatile so Postgres backfills existing rows with the migration timestamp
-- — acceptable: the first hydration is a full pull (last-sync = epoch), so
-- no row is missed; only "how old is this row" history is approximated.

alter table public.trip_days
  add column if not exists created_at timestamptz not null default now();
alter table public.trip_days
  add column if not exists updated_at timestamptz not null default now();

comment on column public.trip_days.updated_at is
  'v2 S2.1: server-stamped by handle_times() — sync conflict clock. Pre-0027 rows were backfilled with the migration timestamp.';

-- ============================================================
-- 3. Soft-delete tombstones on synced roots
-- ============================================================
--
-- `deleted = true` becomes the NORMAL delete path for synced user content
-- once Wave 2 (S2.4) enables writes — same semantics trip_place_comments
-- shipped with in 0019. Until then nothing writes `true`, all existing read
-- paths see only `false`, and behavior is unchanged (constant default →
-- PG11+ fast-path ADD COLUMN, no table rewrite).
--
-- Wave 2 contract (documented here so it isn't lost): every v1 hard-delete
-- path on these tables (e.g. trip-place-reactions "clear", trip-packing
-- remove) must flip to `set deleted = true`, and every list read must add
-- `eq('deleted', false)` — incremental `updated_at > last-sync` pulls cannot
-- observe hard DELETEs (no row left to carry the fact); only tombstones
-- replicate reliably.
--
-- trip_place_comments already has `deleted` (0019). trips/trip_legs: see
-- the header's "deliberate NON-changes".

alter table public.trip_places
  add column if not exists deleted boolean not null default false;
alter table public.trip_days
  add column if not exists deleted boolean not null default false;
alter table public.trip_expenses
  add column if not exists deleted boolean not null default false;
alter table public.trip_accommodations
  add column if not exists deleted boolean not null default false;
alter table public.trip_place_reactions
  add column if not exists deleted boolean not null default false;
alter table public.trip_packing_items
  add column if not exists deleted boolean not null default false;

comment on column public.trip_places.deleted is
  'v2 S2.1 soft-delete tombstone for the offline sync engine. Nothing writes true until S2 Wave 2 enables Tier-1 writes; from then on it is the NORMAL delete path (tombstones replicate through incremental LWW pulls; hard DELETEs do not). Reads must filter deleted = false once writes start.';
comment on column public.trip_place_reactions.deleted is
  'v2 S2.1 soft-delete tombstone. NOTE for Wave 2: the v1 "clear reaction" path hard-DELETEs the row — it must become `set deleted = true` (the unique (trip_place_id, user_id) slot stays occupied; re-reacting flips deleted back to false in the same upsert).';
comment on column public.trip_packing_items.deleted is
  'v2 S2.1 soft-delete tombstone — supersedes the "hard delete until S2" stance documented in 0024. Nothing writes true until Wave 2.';

-- ============================================================
-- 4. trip_place_comments.updated_at: backfill + NOT NULL
-- ============================================================
--
-- 0019 left updated_at NULL until first edit (it doubled as the "edited"
-- badge). The sync engine's incremental pull filters `updated_at >
-- last-sync` — a NULL updated_at row would be INVISIBLE to every
-- incremental pull forever. Backfill NULL → created_at, then lock the
-- column NOT NULL (handle_times stamps every new row, so the constraint
-- can never be violated again).
--
-- The "edited" signal (if a UI ever wants it — nothing renders it today)
-- becomes `updated_at > created_at`, which the handle_times now()-stability
-- guarantee makes exact for server-created rows.

update public.trip_place_comments
  set updated_at = created_at
  where updated_at is null;

alter table public.trip_place_comments
  alter column updated_at set not null;

comment on column public.trip_place_comments.updated_at is
  'v2 S2.1: NOT NULL, server-stamped by handle_times() on INSERT and UPDATE — sync conflict clock (a NULL here would hide the row from incremental updated_at > last-sync pulls). "Edited" indicator, if ever rendered, is updated_at > created_at.';

-- ============================================================
-- 5. trip_places.manual_rank — user-intent order (C1 refinement)
-- ============================================================
--
-- Order is TWO fields with TWO owners (docs/v2/risks-and-decisions.md C1,
-- refined 2026-06-10):
--
--   manual_rank (this column)        — USER-intent order. Fractional index
--     (lexicographic text key, e.g. "a0" < "a0V" < "a1"): inserting between
--     two rows generates a key between their keys, so a reorder touches ONE
--     row — which is what makes it safe under per-field LWW and offline
--     editing. Client-writable, LWW-synced, NEVER reverted on reconnect.
--   day_index / order_in_day / trip_legs — OPTIMIZER-computed order.
--     Server-only (the optimize-trip mutex path), never client-LWW-merged.
--
-- text (not numeric): fractional-index keys are arbitrary-precision base-62
-- strings; numeric would re-introduce the "ran out of room between 1 and 2"
-- rebalancing problem the technique exists to avoid. NULL = user has never
-- hand-ordered this place.
--
-- No index: manual_rank is sorted client-side over an already-loaded trip's
-- places (≤ dozens of rows); it is never a server-side filter.

alter table public.trip_places
  add column if not exists manual_rank text null;

comment on column public.trip_places.manual_rank is
  'v2 S2.1 (C1 refinement): USER-AUTHORED fractional-index order key (lexicographic text). Client-writable + LWW-synced + offline-safe; offline drags write this and are never reverted. The optimize-trip manual branch will CONSUME it to recompute legs (later wave) but NEVER writes it. Optimizer-computed order lives in day_index/order_in_day/trip_legs (server-only). trips.route_render_mode picks which order renders. NULL = never hand-ordered.';

-- Incremental-pull support: every sync pull is `WHERE updated_at > $last
-- ORDER BY updated_at` under RLS. Tiny tables today, but this is THE hot
-- query of the sync engine on every reconnect/foreground — and a btree on a
-- timestamptz is cheap to maintain at this write volume.
create index if not exists trips_updated_at_idx               on public.trips (updated_at);
create index if not exists trip_places_updated_at_idx         on public.trip_places (updated_at);
create index if not exists trip_days_updated_at_idx           on public.trip_days (updated_at);
create index if not exists trip_expenses_updated_at_idx       on public.trip_expenses (updated_at);
create index if not exists trip_accommodations_updated_at_idx on public.trip_accommodations (updated_at);
create index if not exists trip_place_reactions_updated_at_idx on public.trip_place_reactions (updated_at);
create index if not exists trip_place_comments_updated_at_idx on public.trip_place_comments (updated_at);
create index if not exists trip_packing_items_updated_at_idx  on public.trip_packing_items (updated_at);

-- ============================================================
-- 6. Trigger swap: <table>_set_updated_at → <table>_handle_times
-- ============================================================
--
-- BEFORE INSERT OR UPDATE (the old triggers were UPDATE-only — INSERT
-- stamping is new and is what makes updated_at trustworthy as the conflict
-- clock from a row's first heartbeat).
--
-- Trigger-name ordering note (trips): Postgres fires same-event BEFORE
-- triggers in name order. `enforce_trips_column_restrictions` (0015/0026)
-- must observe the client's intent BEFORE the timestamp trigger mutates
-- NEW — 'e' < 't' keeps `trips_handle_times` second, exactly as it was with
-- `trips_set_updated_at`. Do not rename either trigger without rechecking.

-- trips
drop trigger if exists trips_set_updated_at on public.trips;
drop trigger if exists trips_handle_times on public.trips;
create trigger trips_handle_times
  before insert or update on public.trips
  for each row execute function public.handle_times();

-- trip_places
drop trigger if exists trip_places_set_updated_at on public.trip_places;
drop trigger if exists trip_places_handle_times on public.trip_places;
create trigger trip_places_handle_times
  before insert or update on public.trip_places
  for each row execute function public.handle_times();

-- trip_days (no prior trigger — the drop of *_set_updated_at is a no-op kept
-- for symmetry/idempotence)
drop trigger if exists trip_days_set_updated_at on public.trip_days;
drop trigger if exists trip_days_handle_times on public.trip_days;
create trigger trip_days_handle_times
  before insert or update on public.trip_days
  for each row execute function public.handle_times();

-- trip_expenses
drop trigger if exists trip_expenses_set_updated_at on public.trip_expenses;
drop trigger if exists trip_expenses_handle_times on public.trip_expenses;
create trigger trip_expenses_handle_times
  before insert or update on public.trip_expenses
  for each row execute function public.handle_times();

-- trip_accommodations
drop trigger if exists trip_accommodations_set_updated_at on public.trip_accommodations;
drop trigger if exists trip_accommodations_handle_times on public.trip_accommodations;
create trigger trip_accommodations_handle_times
  before insert or update on public.trip_accommodations
  for each row execute function public.handle_times();

-- trip_place_reactions
drop trigger if exists trip_place_reactions_set_updated_at on public.trip_place_reactions;
drop trigger if exists trip_place_reactions_handle_times on public.trip_place_reactions;
create trigger trip_place_reactions_handle_times
  before insert or update on public.trip_place_reactions
  for each row execute function public.handle_times();

-- trip_place_comments
drop trigger if exists trip_place_comments_set_updated_at on public.trip_place_comments;
drop trigger if exists trip_place_comments_handle_times on public.trip_place_comments;
create trigger trip_place_comments_handle_times
  before insert or update on public.trip_place_comments
  for each row execute function public.handle_times();

-- trip_packing_items
drop trigger if exists trip_packing_items_set_updated_at on public.trip_packing_items;
drop trigger if exists trip_packing_items_handle_times on public.trip_packing_items;
create trigger trip_packing_items_handle_times
  before insert or update on public.trip_packing_items
  for each row execute function public.handle_times();

-- ============================================================
-- 7. Realtime publication: complete the synced-root set
-- ============================================================
--
-- 0019 published trip_places, trip_days, trip_legs, trip_expenses,
-- trip_accommodations, trip_place_comments and DELIBERATELY excluded trips
-- ("list refetch is fine") + trip_place_reactions ("optimistic toggle") —
-- correct for postgres_changes UI subscribers, but the Legend-State
-- syncedSupabase engine needs realtime on EVERY synced root: realtime is
-- its push channel, and an unpublished table would degrade to pull-only
-- and go stale between foregrounds. trip_packing_items (0024) postdates
-- 0019 and was never published. Same idempotent, environment-tolerant
-- pattern as 0019 §2; authorization is unchanged (Realtime checks the
-- subscriber's RLS SELECT policies before delivering rows).

do $realtime$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication "supabase_realtime" not found — skipping realtime wiring (expected on bare local stacks; hosted Supabase always has it).';
    return;
  end if;

  foreach tbl in array array[
    'trips',
    'trip_place_reactions',
    'trip_packing_items'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname    = 'supabase_realtime'
        and schemaname = 'public'
        and tablename  = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
      raise notice 'added public.% to supabase_realtime publication', tbl;
    end if;
  end loop;
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to alter publication "supabase_realtime" — add the tables via Dashboard -> Database -> Replication instead.';
end
$realtime$;
