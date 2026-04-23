-- Tripvisor initial schema
-- Tables: trips, trip_days, trip_places, trip_legs
-- RLS: every child table scoped via trips.user_id

create extension if not exists "uuid-ossp";

-- ============================================================
-- trips
-- ============================================================
create table if not exists public.trips (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  title                text not null,
  start_date           date,
  end_date             date,
  daily_hours_budget   numeric(4,1) not null default 8.0,
  anchor_place_id      uuid,
  transport_mode       text not null default 'driving'
                       check (transport_mode in ('driving','walking','transit')),
  timezone             text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists trips_user_id_idx on public.trips(user_id);

-- ============================================================
-- trip_days (per-day anchors: hotel start / end)
-- ============================================================
create table if not exists public.trip_days (
  id                   uuid primary key default uuid_generate_v4(),
  trip_id              uuid not null references public.trips(id) on delete cascade,
  day_index            integer not null,
  day_start_place_id   uuid,
  day_end_place_id     uuid,
  unique (trip_id, day_index)
);

-- ============================================================
-- trip_places
-- ============================================================
create table if not exists public.trip_places (
  id                       uuid primary key default uuid_generate_v4(),
  trip_id                  uuid not null references public.trips(id) on delete cascade,
  google_place_id          text not null,
  user_title               text,
  category                 text,
  lat                      double precision not null,
  lng                      double precision not null,
  visit_duration_minutes   integer not null default 60,
  day_index                integer,
  order_in_day             integer,
  notes                    text,
  details_refreshed_at     timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists trip_places_trip_id_idx on public.trip_places(trip_id);
create index if not exists trip_places_day_idx on public.trip_places(trip_id, day_index, order_in_day);

-- ============================================================
-- trip_legs (travel segments; 30-day TTL)
-- ============================================================
create table if not exists public.trip_legs (
  id                uuid primary key default uuid_generate_v4(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  from_place_id     uuid not null references public.trip_places(id) on delete cascade,
  to_place_id       uuid not null references public.trip_places(id) on delete cascade,
  day_index         integer not null,
  transport_mode    text not null,
  duration_seconds  integer not null,
  distance_meters   integer not null,
  polyline          text,
  computed_at       timestamptz not null default now()
);

create index if not exists trip_legs_trip_id_idx on public.trip_legs(trip_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.trips       enable row level security;
alter table public.trip_days   enable row level security;
alter table public.trip_places enable row level security;
alter table public.trip_legs   enable row level security;

create policy "trips_owner_all"
  on public.trips for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trip_days_via_trip"
  on public.trip_days for all
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_places_via_trip"
  on public.trip_places for all
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

create policy "trip_legs_via_trip"
  on public.trip_legs for all
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

create trigger trip_places_set_updated_at
  before update on public.trip_places
  for each row execute function public.set_updated_at();
