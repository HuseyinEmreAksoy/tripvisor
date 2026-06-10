# Migrations — v2 notes (Phases N2, N5)

## New migrations

- **`0019_v2_realtime_and_comments.sql`** — four sections: `trip_place_comments` table + RLS (N2.6), realtime publication wiring for the synced tables (N2.1), `analytics_user_trip_stats` materialized view + `get_my_trip_stats()` security-definer reader (N2.3), and guarded pg_cron nightly jobs — MV refresh at 04:00 UTC + `trip_legs` 30-day Google-ToS purge at 04:15 UTC (N2.3). Every environment-dependent statement (publication, extensions, cron) degrades to a `NOTICE` on local stacks instead of failing.
- **`0022_v2_app_config.sql`** (N5.4) — `app_config` key/value table: runtime kill-switches that steer SHIPPED clients without a build/redeploy (env vars are baked at build time). Known keys: `map_provider_web` (`'maplibre' | 'google'`, client-read) and `routing_provider` (`'ors' | 'google'`, read by the `distance-matrix` / `directions-polyline` Edge Functions). SELECT is open to **anon + authenticated** (the public share page renders a map; values are non-sensitive toggles); there are **no write policies** — writes happen via the dashboard / service role, which IS the kill-switch operation. Seeds nothing: an absent row means "use the env default", so applying this migration changes no behavior by itself.

Apply with `npx supabase db push` (hosted) or `npx supabase db reset` (**LOCAL ONLY**).
If the migration prints a `NOTICE` that `pg_cron` / `pg_net` could not be created, enable them in **Dashboard → Database → Extensions** and re-run the migration — `cron.schedule` upserts by job name, so re-runs are safe.

## Manual dashboard steps (cannot be done in migrations) — BUILD-LOG N2.5

### Resend SMTP (auth emails past the built-in 4/hour cap)

1. Resend: verify the sending domain, create an API key (`re_...`) — lives only in the dashboard, never in this repo (`.env.example` documents the name `RESEND_API_KEY` as dashboard-managed).
2. Supabase **Dashboard → Project Settings → Auth → SMTP Settings**: enable custom SMTP with host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key.
3. Set the sender to an address on the verified domain and send a test magic link. Note: Resend free tier = 100 emails/day — which is why N1.6 adds Google OAuth as the second sign-in path.

### Google OAuth provider (powers N1.6's sign-in button)

1. Google Cloud Console → Credentials → OAuth client (type **Web application**) → add authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase **Dashboard → Authentication → Providers → Google**: enable, paste the Client ID + Client Secret (dashboard-stored secrets; never committed).
3. No new client env vars — `supabase.auth.signInWithOAuth({ provider: 'google' })` rides the existing `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### Keep-alive workflow secrets (BUILD-LOG N2.4 — see `.github/workflows/keepalive.yml`)

GitHub repo → **Settings → Secrets and variables → Actions**:

- `SUPABASE_KEEPALIVE_URL` — base URL **without** a query string (the workflow appends `?ping=1`); recommended: `https://<project-ref>.supabase.co/rest/v1/`.
- `SUPABASE_ANON_KEY` — the project anon key (already public via the app bundle; RLS gates it).

## Ops runbook — routing provider (N5, D2: ORS primary / Google fallback)

The two routing Edge Functions resolve their backend per request:
**`app_config` row → `ROUTING_PROVIDER` secret → `'google'` (hard default)**.
Until you flip something, every deployment keeps the pre-N5 Google behavior.
On ANY ORS failure (missing key, 4xx/5xx, 10s timeout, open circuit breaker)
the request falls back to Google automatically and logs
`{ provider_fallback: 'google', reason }` — flipping the switch can degrade
cost, never availability. Transit always uses Google (ORS has no transit
profile). Keep `GOOGLE_MAPS_SERVER_KEY` set regardless — it backs the
failover.

### Go live on ORS

1. Get a free key at <https://openrouteservice.org> (free tier ≈ 2k directions
   + 500 matrix requests/day, 40/min) and set it:
   `npx supabase secrets set ORS_API_KEY=<key>`
   (local: add it to `supabase/functions/.env`).
2. Flip the switch — either:
   - **Instant, redeploy-free (recommended):** insert the `app_config` row —
     `insert into public.app_config (key, value) values ('routing_provider', 'ors');`
     (dashboard SQL editor; service role bypasses RLS by design). Edge
     isolates pick it up within ~60s (per-isolate config cache).
   - **Env default:** `npx supabase secrets set ROUTING_PROVIDER=ors`
     (functions restart on secret change; the `app_config` row, if present,
     still wins).
3. Verify in the function logs: success lines now carry `provider: 'ors'`
   (`provider_source` tells you which layer decided).

### Kill-switch back to Google

`update public.app_config set value = 'google' where key = 'routing_provider';`
— takes effect within ~60s, no redeploy. (Deleting the row instead falls back
to the `ROUTING_PROVIDER` secret, then the hard default `'google'`.)
