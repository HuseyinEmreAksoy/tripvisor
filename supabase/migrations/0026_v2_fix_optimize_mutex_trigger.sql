-- ============================================================================
-- 0026 — fix: optimize-trip row-mutex blocked by the editor-restriction
-- trigger (latent since Phase 22 / migration 0015; caught live 2026-06-11).
--
-- Root cause
-- ----------
-- `optimize-trip` claims its per-trip mutex via `claim_trip_optimize()`
-- using the SERVICE-ROLE client (`UPDATE trips SET optimizing_at = …`).
-- Under service-role there is no JWT, so `auth.uid()` is NULL → the owner
-- short-circuit (`auth.uid() = OLD.user_id`) fails → the function falls
-- into the editor deny-list, which explicitly denies `optimizing_at` →
-- EVERY optimize dies at the lock stage with
-- "editor cannot change trips.optimizing_at".
--
-- Optimize was last live-verified in Phase 20 — migration 0015 (Phase 22)
-- introduced the trigger after that, and no optimize smoke ran again until
-- the v2 AI golden-path test surfaced it.
--
-- Fix
-- ---
-- Add a service-role bypass at the top of the trigger function. Safety
-- analysis: this trigger only fires on UPDATEs that already passed RLS —
-- i.e. the owner JWT, an editor JWT (via the column-restricted policy), or
-- the service-role (which bypasses RLS). Among those, `auth.uid() IS NULL`
-- uniquely identifies the service-role — our own trusted Edge Functions.
-- The editor restriction (including the `optimizing_at` deny for direct
-- client writes) is preserved verbatim.
--
-- Rollback: re-run the `create or replace function` block from migration
-- 0018 (identical body minus the service-role bypass).
-- ============================================================================

create or replace function public.enforce_trips_column_restrictions_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- 0026: service-role bypass. The trigger fires only after RLS admitted
  -- the UPDATE; a NULL auth.uid() at that point can only be the
  -- service-role (Edge Functions: optimize-trip mutex claim/release,
  -- share-trip admin paths). Blocking our own server was never the
  -- intent of the Phase 22 editor restriction.
  if auth.uid() is null then
    return NEW;
  end if;

  -- Owner short-circuit (preserved from 0015 / 0016 / 0018). Owners can
  -- change anything. Use OLD.user_id (not NEW.user_id) so an editor cannot
  -- claim ownership by setting NEW.user_id = auth.uid().
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
  'v2 0026 (extends Phase 22/23/25): BEFORE UPDATE trigger function on public.trips. Service-role (auth.uid() IS NULL after RLS admission) bypasses — fixes the optimize-trip mutex blocked since 0015. Owners (auth.uid() = OLD.user_id) bypass; editors are restricted to changing only total_budget, route_render_mode, and cover_photo_google_place_id. Raises 42501 on any other column diff. Maintenance contract: any new column on trips MUST be added to this whitelist diff OR this comment.';
