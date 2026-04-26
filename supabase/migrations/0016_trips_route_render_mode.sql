-- Tripvisor Phase 23 Step 23.1: trips.route_render_mode + bicycling transport.
--
-- Why this exists
-- ---------------
-- Phase 23 introduces a per-trip "render mode" toggle on the trip detail
-- screen so a user can choose between two route presentations:
--
--   * 'optimized' — the optimizer (k-means + 2-opt) decides cluster
--                   assignment + within-day order. Today's behavior.
--   * 'manual'    — the user has hand-arranged places into days /
--                   order and the polyline simply traces that order.
--                   The optimizer step skips clustering + 2-opt and
--                   only refreshes trip_legs against the existing
--                   (day_index, order_in_day) chain.
--
-- The new column lives on `trips` (not on `trip_places` or `trip_days`)
-- because it is a trip-level presentation choice — every place / leg
-- inherits it. NOT NULL with a `'optimized'` default preserves the
-- behavior of every pre-Phase-23 trip without a backfill step.
--
-- Editor / collaborator UX
-- ------------------------
-- Phase 22 (migration 0015) clamped editor UPDATEs on `trips` to the
-- single column `total_budget` via the `enforce_trips_column_restrictions_fn`
-- BEFORE UPDATE trigger. The trigger raises 42501 on any other column diff.
--
-- The render-mode toggle is a low-risk, presentation-only choice — denying
-- it to editors is a worse product seam than allowing it. We extend the
-- allow-list to `{ total_budget, route_render_mode }`. The owner short-
-- circuit (`auth.uid() = OLD.user_id`) is preserved exactly as before, so
-- owners remain unrestricted.
--
-- Bicycling transport mode
-- ------------------------
-- The user requested four transport modes (walking / driving / transit /
-- bicycling). The Phase 1 schema (`0001_init.sql`) constrains
-- `transport_mode` to `('driving','walking','transit')`. Adding
-- `'bicycling'` here keeps the data layer and the Edge Function MODE_MAP
-- in lockstep — a partial change (Edge Function maps 'bicycling' -> BICYCLE
-- but the DB rejects the value at INSERT/UPDATE time) would silently
-- prevent the UI from ever sending it.
--
-- The Routes API exposes BICYCLE as a first-class travelMode, so the
-- distance-matrix and directions-polyline Edge Functions can honor it
-- without further work beyond extending their Zod enum + MODE_MAP (done
-- in the same commit as this migration).
--
-- This widens, never narrows: every existing 'driving' / 'walking' /
-- 'transit' row remains valid. No backfill needed.
--
-- Manual SQL probes (verify after `npx supabase db reset`)
-- --------------------------------------------------------
-- Run as superuser, see scripts/smoke-route-render-mode-rls.sql for the
-- full transactional version with auth.users seeding. Quick spot-checks:
--
--   -- 1. Owner can update title (control)
--   set local "request.jwt.claims" = '{"sub":"<owner-uuid>"}';
--   update public.trips set title = 'x' where id = '<trip-uuid>';   -- expect: 1 row
--
--   -- 2. Owner can update route_render_mode
--   set local "request.jwt.claims" = '{"sub":"<owner-uuid>"}';
--   update public.trips set route_render_mode = 'manual' where id = '<trip-uuid>';   -- expect: 1 row
--
--   -- 3. Editor cannot update title  -> 42501
--   set local "request.jwt.claims" = '{"sub":"<editor-uuid>"}';
--   update public.trips set title = 'x' where id = '<trip-uuid>';   -- expect: 42501
--
--   -- 4. Editor can update route_render_mode
--   set local "request.jwt.claims" = '{"sub":"<editor-uuid>"}';
--   update public.trips set route_render_mode = 'manual' where id = '<trip-uuid>';   -- expect: 1 row
--
--   -- 5. Viewer cannot update route_render_mode
--   set local "request.jwt.claims" = '{"sub":"<viewer-uuid>"}';
--   update public.trips set route_render_mode = 'manual' where id = '<trip-uuid>';   -- expect: 0 rows (RLS filtered)
--
-- Rollback
-- --------
--   alter table public.trips drop column if exists route_render_mode;
--   -- restore the prior trigger function body from 0015; the bicycling
--   -- CHECK widening is forward-only (no rollback needed unless data
--   -- already references 'bicycling').

-- ============================================================
-- 1. Widen transport_mode CHECK to include 'bicycling'
-- ============================================================
-- Phase 1 wrote the CHECK inline on the column (anonymous). Postgres
-- assigns a system name like `trips_transport_mode_check`. Using the
-- conventional name lets us drop and re-add idempotently across local
-- resets and production migrations.
alter table public.trips
  drop constraint if exists trips_transport_mode_check;

alter table public.trips
  add constraint trips_transport_mode_check
  check (transport_mode in ('driving', 'walking', 'transit', 'bicycling'));

comment on constraint trips_transport_mode_check on public.trips is
  'Phase 23: widened from 0001_init.sql to include bicycling. Values must stay in lockstep with src/api/types.ts TransportMode AND the MODE_MAP enums in supabase/functions/distance-matrix/index.ts and supabase/functions/directions-polyline/index.ts. Routes API expects BICYCLE; the Edge Functions translate.';

-- ============================================================
-- 2. Add route_render_mode column
-- ============================================================
-- Default 'optimized' so every existing row keeps current behavior
-- without a backfill. NOT NULL because an absent value is a legal-but-
-- ambiguous state — the UI always renders one mode or the other.
alter table public.trips
  add column if not exists route_render_mode text not null default 'optimized'
    check (route_render_mode in ('optimized', 'manual'));

comment on column public.trips.route_render_mode is
  'Phase 23: per-trip toggle between optimizer-driven layout (optimized) and user-arranged layout (manual). The optimize-trip Edge Function branches on this value: optimized runs k-means + 2-opt; manual only recomputes trip_legs against the existing (day_index, order_in_day) chain. The UI flips this via useUpdateRouteRenderMode and immediately re-runs optimize-trip with the new mode.';

-- ============================================================
-- 3. Extend the editor allow-list trigger to include route_render_mode
-- ============================================================
-- Replace the function from 0015 in place. Owner short-circuit
-- (`auth.uid() = OLD.user_id`) is preserved verbatim. The diff is:
--
--   - Removed the implicit "any-column-other-than-total_budget" denial
--     scope — `route_render_mode` is now also legal.
--   - No `if NEW.route_render_mode is distinct from OLD.route_render_mode then ...`
--     clause is needed: the function falls through to `return NEW` when no
--     denied column has changed, so a route_render_mode-only diff slips
--     through the same way `total_budget` does.
--
-- Maintenance contract (unchanged from 0015): any new column added to
-- public.trips MUST be added to this trigger's whitelist diff. Otherwise
-- editors will be able to silently change it.
create or replace function public.enforce_trips_column_restrictions_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Owner short-circuit (preserved from 0015). Owners can change anything.
  -- Use OLD.user_id (not NEW.user_id) so an editor cannot claim ownership
  -- by setting NEW.user_id = auth.uid() — that would also be caught by
  -- the column diff below, but the explicit OLD-side check is cheaper.
  if auth.uid() = OLD.user_id then
    return NEW;
  end if;

  -- Caller is an editor (otherwise trips_editor_budget_update RLS would
  -- have blocked the UPDATE before this trigger fires). Validate that
  -- ONLY total_budget OR route_render_mode (plus updated_at, set by the
  -- timestamp trigger) changed. Any other column diff -> 42501.

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

  -- total_budget — editor may change (Phase 22 Step 22.1).
  -- route_render_mode — editor may change (Phase 23 Step 23.1).
  -- Falling through with both whitelisted columns mutable: any diff in
  -- these columns slips past the deny list, which is the desired
  -- behavior.
  return NEW;
end;
$$;

comment on function public.enforce_trips_column_restrictions_fn() is
  'Phase 23 Step 23.1 (extends Phase 22 Step 22.1): BEFORE UPDATE trigger function on public.trips. Owners (auth.uid() = OLD.user_id) bypass; editors are restricted to changing only total_budget AND route_render_mode. Raises 42501 (insufficient_privilege) on any other column diff. Maintenance contract: any new column on trips MUST be added to this whitelist diff or it will be silently editable by editors.';

-- The trigger wiring itself (`enforce_trips_column_restrictions BEFORE
-- UPDATE`) was created in 0015 and points at this function by name; the
-- `create or replace function` above swaps the body in place without
-- needing to drop/recreate the trigger.
