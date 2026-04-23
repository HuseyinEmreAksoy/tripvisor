-- Tripvisor RPCs for Phase 3
-- SECURITY INVOKER so RLS policies still apply — caller must own the trip.
-- Returns the count of rows updated.

-- apply_optimization(p_trip_id uuid, p_assignments jsonb)
-- p_assignments shape: [{ "id": uuid, "day_index": int, "order_in_day": int }, ...]
-- All IDs must belong to p_trip_id (enforced by the WHERE clause + RLS).

create or replace function public.apply_optimization(
  p_trip_id uuid,
  p_assignments jsonb
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  with assignments as (
    select
      (value->>'id')::uuid as id,
      (value->>'day_index')::integer as day_index,
      (value->>'order_in_day')::integer as order_in_day
    from jsonb_array_elements(p_assignments)
  )
  update public.trip_places as tp
  set
    day_index = a.day_index,
    order_in_day = a.order_in_day
  from assignments a
  where tp.id = a.id
    and tp.trip_id = p_trip_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_optimization(uuid, jsonb) to authenticated, service_role;

-- apply_manual_day_order(p_trip_id uuid, p_day_index int, p_ordered_ids uuid[])
-- Sets order_in_day = array position for each id in p_ordered_ids on the given day.
-- Caller must own the trip (RLS enforces it).

create or replace function public.apply_manual_day_order(
  p_trip_id uuid,
  p_day_index integer,
  p_ordered_ids uuid[]
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  with positions as (
    select
      unnest(p_ordered_ids) as id,
      generate_series(0, array_length(p_ordered_ids, 1) - 1) as pos
  )
  update public.trip_places as tp
  set
    order_in_day = p.pos,
    day_index = p_day_index
  from positions p
  where tp.id = p.id
    and tp.trip_id = p_trip_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_manual_day_order(uuid, integer, uuid[]) to authenticated, service_role;
