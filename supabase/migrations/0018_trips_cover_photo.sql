-- Tripvisor Phase 25 Step 25.2: trips.cover_photo_google_place_id +
-- editor allow-list extension.
--
-- Why this exists
-- ---------------
-- Phase 25 introduces a per-trip "cover photo" so the trip detail screen
-- and the trip list cards have a hero image to lean on. The image itself
-- is fetched live from Google Places (the `place-photo` Edge Function
-- proxies the bytes server-side; no Google content is persisted) — the
-- only thing we store is a *pointer* to which Google Place's photo is
-- the cover. That pointer is the place's `google_place_id`; the chosen
-- photo's `name` (resource name) is recomputed live by re-fetching the
-- place's `photos[]` field and taking the first one. Storing the
-- google_place_id alone (NOT the photo resource name itself) keeps us
-- on the right side of the 30-day Google ToS ceiling — the resource
-- name has a TTL, the place id does not.
--
-- Editor / collaborator UX
-- ------------------------
-- Phase 22 (migration 0015) and Phase 23 (migration 0016) clamped editor
-- UPDATEs on `trips` to a tight allow-list via the
-- `enforce_trips_column_restrictions_fn` BEFORE UPDATE trigger. The
-- allow-list grew from `{ total_budget }` to
-- `{ total_budget, route_render_mode }`. Phase 25 extends it to
-- `{ total_budget, route_render_mode, cover_photo_google_place_id }`.
--
-- Picking a cover photo is a low-stakes presentation choice — denying
-- editors the affordance is a worse product seam than allowing it.
-- The owner short-circuit (`auth.uid() = OLD.user_id`) is preserved
-- exactly as before, so owners remain unrestricted.
--
-- Trigger semantics: explicit deny list, NOT silent fall-through
-- --------------------------------------------------------------
-- Important: the trigger is a *deny list* of every known column on
-- `public.trips` except the allow-list members. A new column added to
-- `trips` without a matching trigger update would be SILENTLY editable
-- by editors, because the trigger only raises on a column it explicitly
-- knows about. The maintenance contract from migrations 0015 + 0016 is
-- "any new column on trips MUST be added to this trigger's diff or the
-- allow-list".
--
-- For Phase 25 we explicitly want `cover_photo_google_place_id` to be
-- editor-mutable. So we:
--   1. Add the column to `public.trips`.
--   2. `create or replace` the trigger function with NO new deny clause
--      for this column (since it's whitelisted, falling through is the
--      desired behavior).
--
-- The trigger wiring itself was created in 0015 and stays in place — we
-- only swap the function body.
--
-- Manual SQL probes (verify after `npx supabase db reset`)
-- --------------------------------------------------------
-- Run as superuser, see scripts/smoke-trips-cover-photo-rls.sql for the
-- full transactional version with auth.users seeding. Quick spot-checks:
--
--   -- 1. Owner can UPDATE cover_photo_google_place_id
--   set local "request.jwt.claims" = '{"sub":"<owner-uuid>"}';
--   update public.trips set cover_photo_google_place_id = 'ChIJ...' where id = '<trip-uuid>';
--     -- expect: 1 row
--
--   -- 2. Editor can UPDATE cover_photo_google_place_id
--   set local "request.jwt.claims" = '{"sub":"<editor-uuid>"}';
--   update public.trips set cover_photo_google_place_id = 'ChIJ...' where id = '<trip-uuid>';
--     -- expect: 1 row
--
--   -- 3. Editor cannot UPDATE title -> 42501 (regression check)
--   set local "request.jwt.claims" = '{"sub":"<editor-uuid>"}';
--   update public.trips set title = 'x' where id = '<trip-uuid>';
--     -- expect: 42501
--
--   -- 4. Viewer cannot UPDATE cover_photo_google_place_id
--   set local "request.jwt.claims" = '{"sub":"<viewer-uuid>"}';
--   update public.trips set cover_photo_google_place_id = 'ChIJ...' where id = '<trip-uuid>';
--     -- expect: 0 rows (RLS filtered)
--
-- Rollback
-- --------
--   alter table public.trips drop column if exists cover_photo_google_place_id;
--   -- restore the prior trigger function body from 0016 (i.e. without
--   -- the cover_photo_google_place_id mention in this file's comment;
--   -- the body is byte-identical to 0016 today since we only ADD a
--   -- column to the allow-list-by-omission, not the deny clauses).

-- ============================================================
-- 1. Add cover_photo_google_place_id column
-- ============================================================
-- Nullable: trips without a cover photo render the existing default
-- gradient placeholder. No backfill needed — every existing row stays
-- as NULL until the user picks a cover.
--
-- No CHECK constraint on the value: Google place ids are opaque strings
-- of varying length and prefix (`ChIJ...`, `EhIa...`, etc.). The
-- application layer (Edge Function field mask + place-photo proxy) is
-- the source of truth on what's a valid id; an arbitrary string here
-- only fails when the client tries to render the photo.
alter table public.trips
  add column if not exists cover_photo_google_place_id text null;

comment on column public.trips.cover_photo_google_place_id is
  'Phase 25 Step 25.2: pointer to which Google Place provides the trip cover photo. NULL = no cover. We store ONLY the place id (not the photo resource name) because the resource name has a Google ToS TTL while the place id does not. The cover image is fetched live via the place-photo Edge Function (which re-resolves photos[].name from place-details and proxies the bytes). Editor collaborators may UPDATE this column — see the enforce_trips_column_restrictions trigger.';

-- ============================================================
-- 2. Extend the editor allow-list trigger
-- ============================================================
-- Replace the function from 0016 in place. Owner short-circuit
-- (`auth.uid() = OLD.user_id`) is preserved verbatim. The diff is:
--
--   - No new `if NEW.cover_photo_google_place_id is distinct from
--     OLD.cover_photo_google_place_id then ...` deny clause is added.
--     The trigger's allow-list works by omission — any column NOT
--     listed in a deny clause falls through and is silently mutable
--     by editors. cover_photo_google_place_id is the third whitelisted
--     column (alongside total_budget + route_render_mode).
--
-- Maintenance contract (unchanged from 0015 / 0016): any new column
-- added to public.trips MUST be added to this trigger's deny list
-- UNLESS it is intentionally editor-mutable. Otherwise editors will
-- be able to silently change it. Tests should explicitly exercise the
-- editor path for each new column.
create or replace function public.enforce_trips_column_restrictions_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Owner short-circuit (preserved from 0015 / 0016). Owners can change
  -- anything. Use OLD.user_id (not NEW.user_id) so an editor cannot
  -- claim ownership by setting NEW.user_id = auth.uid() — that would
  -- also be caught by the column diff below, but the explicit OLD-side
  -- check is cheaper.
  if auth.uid() = OLD.user_id then
    return NEW;
  end if;

  -- Caller is an editor (otherwise the trips_editor_budget_update RLS
  -- policy would have blocked the UPDATE before this trigger fires).
  -- Validate that ONLY total_budget OR route_render_mode OR
  -- cover_photo_google_place_id (plus updated_at, set by the timestamp
  -- trigger) changed. Any other column diff -> raise 42501.

  if NEW.id is distinct from OLD.id then
    raise exception 'editor cannot change trips.id'
      using errcode = '42501';
  end if;
  if NEW.user_id is distinct from OLD.user_id then
    raise exception 'editor cannot change trips.user_id'
      using errcode = '42501';
  end if;
  if NEW.title is distinct from OLD.title then
    raise exception 'editor cannot change trips.title'
      using errcode = '42501';
  end if;
  if NEW.start_date is distinct from OLD.start_date then
    raise exception 'editor cannot change trips.start_date'
      using errcode = '42501';
  end if;
  if NEW.end_date is distinct from OLD.end_date then
    raise exception 'editor cannot change trips.end_date'
      using errcode = '42501';
  end if;
  if NEW.daily_hours_budget is distinct from OLD.daily_hours_budget then
    raise exception 'editor cannot change trips.daily_hours_budget'
      using errcode = '42501';
  end if;
  if NEW.anchor_place_id is distinct from OLD.anchor_place_id then
    raise exception 'editor cannot change trips.anchor_place_id'
      using errcode = '42501';
  end if;
  if NEW.transport_mode is distinct from OLD.transport_mode then
    raise exception 'editor cannot change trips.transport_mode'
      using errcode = '42501';
  end if;
  if NEW.timezone is distinct from OLD.timezone then
    raise exception 'editor cannot change trips.timezone'
      using errcode = '42501';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'editor cannot change trips.created_at'
      using errcode = '42501';
  end if;
  if NEW.archived_at is distinct from OLD.archived_at then
    raise exception 'editor cannot change trips.archived_at'
      using errcode = '42501';
  end if;
  if NEW.currency is distinct from OLD.currency then
    raise exception 'editor cannot change trips.currency'
      using errcode = '42501';
  end if;
  if NEW.cost_per_km is distinct from OLD.cost_per_km then
    raise exception 'editor cannot change trips.cost_per_km'
      using errcode = '42501';
  end if;
  if NEW.optimizing_at is distinct from OLD.optimizing_at then
    raise exception 'editor cannot change trips.optimizing_at'
      using errcode = '42501';
  end if;

  -- total_budget                    — editor may change (Phase 22 Step 22.1).
  -- route_render_mode               — editor may change (Phase 23 Step 23.1).
  -- cover_photo_google_place_id     — editor may change (Phase 25 Step 25.2).
  -- Falling through with these three whitelisted columns mutable: any
  -- diff in them slips past the deny list, which is the desired
  -- behavior.
  return NEW;
end;
$$;

comment on function public.enforce_trips_column_restrictions_fn() is
  'Phase 25 Step 25.2 (extends Phase 22/23): BEFORE UPDATE trigger function on public.trips. Owners (auth.uid() = OLD.user_id) bypass; editors are restricted to changing only total_budget, route_render_mode, and cover_photo_google_place_id. Raises 42501 (insufficient_privilege) on any other column diff. Maintenance contract: any new column on trips MUST be added to this whitelist diff OR this comment, depending on whether editors should be able to change it.';

-- The trigger wiring itself (`enforce_trips_column_restrictions BEFORE
-- UPDATE`) was created in 0015 and points at this function by name; the
-- `create or replace function` above swaps the body in place without
-- needing to drop/recreate the trigger.
