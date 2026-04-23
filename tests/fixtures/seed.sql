-- Seed data for local Supabase tests. Run against local only.
--
-- Usage:
--   supabase start
--   supabase db reset            # applies migrations
--   psql "$SUPABASE_LOCAL_DB_URL" -f tests/fixtures/seed.sql
--
-- Creates two users with a trip each so RLS isolation can be verified.

-- auth.users is managed by supabase_auth_admin. Use the admin helper
-- if seeding via SQL directly is needed. For tests, prefer creating users
-- via the Supabase admin JS client (see tests/rls.test.ts).

-- Example inline users (safe to run; IDs are deterministic):
--
--   insert into auth.users (id, email) values
--     ('11111111-1111-1111-1111-111111111111', 'user-a@test.local'),
--     ('22222222-2222-2222-2222-222222222222', 'user-b@test.local')
--   on conflict do nothing;
--
-- Seed a trip for user A so the RLS test can assert user B can't see it.

insert into public.trips (id, user_id, title, daily_hours_budget, transport_mode)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'User A seed trip',
  8.0,
  'driving'
)
on conflict (id) do nothing;

insert into public.trip_places (
  id, trip_id, google_place_id, user_title, category, lat, lng, visit_duration_minutes
) values (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'ChIJSeed1',
  'Seed Place',
  'attraction',
  38.71,
  -9.14,
  60
)
on conflict (id) do nothing;
