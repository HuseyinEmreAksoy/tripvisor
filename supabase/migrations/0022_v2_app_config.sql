-- Tripvisor v2 Phase N5 — `app_config` runtime kill-switches (BUILD-LOG N5.4).
--
-- Why this table exists (v2 panel decision, docs/v2/architecture.md)
-- ------------------------------------------------------------------
-- `EXPO_PUBLIC_*` env vars are baked into the bundle at BUILD time: flipping
-- one cannot steer clients that already shipped (web needs a redeploy; native
-- needs an EAS build or OTA push). Edge Function secrets are better (redeploy-
-- free for the server) but still can't reach shipped CLIENT behavior. This
-- tiny key/value table closes that gap: it is read once at startup and cached
-- by the client (src/api/app-config.ts, React Query) and read per-request with
-- a 60s in-memory cache by the routing Edge Functions
-- (supabase/functions/_shared/routing.ts). An operator flips a provider for
-- ALL shipped clients by editing one row in the dashboard — no build, no
-- redeploy. Env vars become DEFAULTS only; an absent row means "use the env
-- default", which keeps this migration a behavioral no-op until someone
-- deliberately flips a switch. Seeding: NONE, on purpose.
--
-- Known keys (consumers MUST tolerate absence):
--   'map_provider_web'  : 'maplibre' | 'google' — which web basemap shipped
--                         clients render (client-read; default =
--                         EXPO_PUBLIC_MAP_PROVIDER).
--   'routing_provider'  : 'ors' | 'google'      — which routing backend the
--                         distance-matrix / directions-polyline Edge Functions
--                         call (server-read; default = ROUTING_PROVIDER secret,
--                         then 'google'). Mirrored to clients for debug
--                         surfaces only — clients never call ORS directly.
--
-- Security posture
-- ----------------
-- Values are NON-SENSITIVE display/routing toggles (provider names), never
-- secrets. SELECT is granted to BOTH authenticated AND anon deliberately: the
-- public share page renders a map without a session and must honor the
-- map-provider switch too. There are NO insert/update/delete policies — writes
-- happen exclusively via the dashboard / service role (that IS the kill-switch
-- operation; service role bypasses RLS). Table-level write privileges are also
-- revoked from anon/authenticated as belt-and-braces, so even a future
-- accidentally-permissive policy could not open writes.
--
-- Rollback
-- --------
--   drop trigger if exists app_config_set_updated_at on public.app_config;
--   drop table if exists public.app_config;

-- ============================================================
-- 1. Table
-- ============================================================

create table if not exists public.app_config (
  key        text primary key check (char_length(key) between 1 and 100),
  -- Length-capped so a dashboard typo can never bloat the startup fetch
  -- (clients SELECT the whole table).
  value      text not null check (char_length(value) between 1 and 500),
  -- Audit breadcrumb: when was this switch last flipped (set_updated_at
  -- trigger below). With dashboard-only writes there is no actor column —
  -- "who" is answered by dashboard audit logs, not this table.
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'v2 N5.4: runtime kill-switches / remote config. Known keys: map_provider_web (''maplibre''|''google'', client-read web basemap), routing_provider (''ors''|''google'', server-read by distance-matrix + directions-polyline). Absent key = consumer uses its env default — env vars are baked at build time and cannot steer shipped clients, which is the whole reason this table exists (panel decision, docs/v2/architecture.md). Values are non-sensitive toggles; SELECT open to anon+authenticated (public share page renders a map); writes only via dashboard/service role — no write policies by design.';

comment on column public.app_config.key is
  'Switch name. Known: map_provider_web, routing_provider. Add new keys freely — readers ignore keys they do not know.';

comment on column public.app_config.value is
  'Switch value as text (consumers validate; unknown values are treated as absent → env default → hard default).';

comment on column public.app_config.updated_at is
  'Last flip time (set_updated_at trigger). Operational audit breadcrumb.';

-- ============================================================
-- 2. updated_at trigger (reuses public.set_updated_at from 0001_init.sql)
-- ============================================================

drop trigger if exists app_config_set_updated_at on public.app_config;
create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. RLS — world-readable, dashboard-writable only
-- ============================================================

alter table public.app_config enable row level security;

-- SELECT for BOTH anon and authenticated (see "Security posture" above).
drop policy if exists "app_config_select_all_roles" on public.app_config;
create policy "app_config_select_all_roles" on public.app_config
  for select to anon, authenticated
  using (true);

-- NO insert/update/delete policies: RLS denies writes for anon/authenticated.
-- Writes = the kill-switch operation, performed via the Supabase dashboard SQL
-- editor / table editor or a service-role client (both bypass RLS).

-- Belt-and-braces: strip the default table-level write grants too, and make
-- the read grant explicit instead of relying on schema default privileges.
revoke insert, update, delete on table public.app_config from anon, authenticated;
grant select on table public.app_config to anon, authenticated;
