# Migrations — v2 notes (Phase N2)

## New migration

- **`0019_v2_realtime_and_comments.sql`** — four sections: `trip_place_comments` table + RLS (N2.6), realtime publication wiring for the synced tables (N2.1), `analytics_user_trip_stats` materialized view + `get_my_trip_stats()` security-definer reader (N2.3), and guarded pg_cron nightly jobs — MV refresh at 04:00 UTC + `trip_legs` 30-day Google-ToS purge at 04:15 UTC (N2.3). Every environment-dependent statement (publication, extensions, cron) degrades to a `NOTICE` on local stacks instead of failing.

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
