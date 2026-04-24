-- Tripvisor Phase 4: share links
--
-- trip_shares stores opaque 128-bit random tokens that grant read-only access
-- to a trip via the `share-trip` Edge Function. The Edge Function uses the
-- service-role key and is the ONLY code path that reads rows from this table.
--
-- RLS model:
--   - Owner (via trips.user_id = auth.uid()) can INSERT / UPDATE / DELETE their
--     own shares (for create + revoke flows that run under the caller's JWT).
--   - No SELECT policy is granted to anyone — authenticated callers included.
--     This forces the anonymous read path through the Edge Function, which uses
--     the service-role key. It also means the owner cannot list/read tokens
--     directly from the client; the share-create Edge Function returns the
--     token once on create and never again (tokens are write-once reveal).
--
-- Rollback: drop table public.trip_shares cascade;

create table if not exists public.trip_shares (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  token       text not null unique,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists trip_shares_token_idx on public.trip_shares(token);
create index if not exists trip_shares_trip_id_idx on public.trip_shares(trip_id);

alter table public.trip_shares enable row level security;

-- Owner can INSERT a share for a trip they own.
create policy "trip_shares_owner_insert"
  on public.trip_shares for insert
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

-- Owner can UPDATE their own shares (used to set revoked_at).
create policy "trip_shares_owner_update"
  on public.trip_shares for update
  using      (trip_id in (select id from public.trips where user_id = auth.uid()))
  with check (trip_id in (select id from public.trips where user_id = auth.uid()));

-- Owner can DELETE their own shares.
create policy "trip_shares_owner_delete"
  on public.trip_shares for delete
  using (trip_id in (select id from public.trips where user_id = auth.uid()));

-- Deliberately NO select policy — all reads go through the Edge Function with
-- the service-role key. This prevents token enumeration attacks even by
-- authenticated users.

comment on table public.trip_shares is
  'Public share links for trips. Reads only via share-trip Edge Function (service role). No SELECT policy by design.';
