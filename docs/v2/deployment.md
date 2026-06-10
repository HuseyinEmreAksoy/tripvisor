# Tripvisor v2 — Free Cloud & Live Deployment Runbook

> **Status:** Planned 2026-06-11 — the GO-LIVE path from localhost to a public URL, all on free tiers ($0).
> Supersedes `docs/deployment.md` (v1) for the live environment. Everything here is config — no code changes required.

## Target topology (all free)

```
users ──► Cloudflare Pages (web, free, auto-deploys master)
                │  EXPO_PUBLIC_* env (anon key, cloud URL, maplibre)
                ▼
        Supabase Cloud FREE project
        Postgres+RLS · Auth · 12 Edge Functions · Storage · Realtime · pg_cron
                │ server secrets (never bundled)
                ▼
        Google (Places/Routes, $200 credit) · ORS (free key) · Gemini/Groq (free) · Open-Meteo (keyless)
```

## Step 1 — Supabase Cloud project (~20 min)

1. Create a free project at supabase.com (org free tier = 2 projects; this is prod — keep local for dev).
2. Link + push schema (all 24 migrations):
   ```
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   Watch for **0024 storage-privilege NOTICEs** → if they appear, create the 3 storage policies via Dashboard (SQL printed in the NOTICE; see `supabase/migrations/README-v2.md`).
3. Secrets:
   ```
   npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=… GEMINI_API_KEY=… GROQ_API_KEY=… ORS_API_KEY=… \
     ALLOWED_ORIGINS=https://<your-pages-domain>,http://localhost:8081
   ```
   (`ALLOWED_ORIGINS` fails closed — it MUST include the Pages domain.)
4. Deploy all functions:
   ```
   npx supabase functions deploy places-autocomplete place-details place-photo distance-matrix \
     directions-polyline optimize-trip manage-collaborators share-trip delete-account export-account \
     ai-itinerary ai-edit weather
   ```
5. Routing switch (D2): insert `app_config` row `('routing_provider','ors')` via Dashboard (Google stays the automatic fallback).

## Step 2 — Auth config (Dashboard, ~10 min — easy to forget, breaks login silently)

- **Auth → URL Configuration**: Site URL = `https://<pages-domain>`; Additional Redirect URLs += `http://localhost:8081`, `https://<pages-domain>/**`. (Magic links and OAuth redirect here — wrong values = login dead.)
- **Auth → SMTP**: enable custom SMTP with **Resend** (free 3k/mo; built-in sender is ~2–4 emails/hr dev-only).
- **Auth → Providers → Google**: enable; OAuth client from Google Cloud Console (web client id/secret; authorized redirect = the Supabase callback URL shown in the dashboard).

## Step 3 — Cloudflare Pages (~10 min)

1. Pages → connect the GitHub repo → production branch `master`.
2. Build command: `npm ci && npx expo export --platform web` · Output dir: `dist`.
3. Environment variables (production):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<cloud anon key>
   EXPO_PUBLIC_MAP_PROVIDER=maplibre
   EXPO_PUBLIC_MAPLIBRE_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
   EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=<optional — only if flipping map provider to google>
   EXPO_PUBLIC_SENTRY_DSN=<optional, Sentry free>
   EXPO_PUBLIC_POSTHOG_KEY=<optional, decision D5>
   ```
4. Deploy → every push to `master` ships automatically. (Local `.env` keeps pointing at `127.0.0.1` — dev and prod stay separate by construction.)

## Step 4 — Keep-alive + ops (~5 min)

- GitHub repo secrets: `SUPABASE_KEEPALIVE_URL=https://<ref>.supabase.co/rest/v1/`, `SUPABASE_ANON_KEY=<cloud anon>` → run `keepalive.yml` once via *Actions → workflow_dispatch* (defeats the 7-day free-tier pause).
- Optional: Sentry DSN (free 5k errors/mo) so production errors are visible.

## Step 5 — Post-deploy smoke (the go-live gate)

☐ Sign-up via magic link arrives (Resend) · ☐ Google OAuth round-trips · ☐ create trip + add place (autocomplete works) · ☐ map renders (MapLibre, attribution visible) · ☐ optimize draws routes · ☐ "Plan my trip" generates a real itinerary (Gemini) · ☐ weather chips on a dated trip · ☐ share link opens logged-out · ☐ packing + documents upload (web) · ☐ no console errors. Record in `docs/smoke/v2-live.md`.

## Cost ceiling

| Service | Tier | Realistic cost |
|---|---|---|
| Supabase (DB/Auth/Functions/Storage/Realtime) | free | $0 (keep-alive prevents pause) |
| Cloudflare Pages | free (500 builds/mo) | $0 |
| OpenFreeMap tiles + Open-Meteo | keyless | $0 |
| ORS routing | free key (~2k/day) | $0 (falls over to Google credit) |
| Gemini + Groq | free tiers | $0 (quota-guarded, C4) |
| Google Places/Routes | $200/mo credit | $0 at hobby scale (grounding metered — watch the ledger) |

**Native (later, P4):** EAS free tier (30 builds/mo) → preview APK / TestFlight; OTA via `eas update` for JS-only changes. Not part of web go-live.

See also: [`BUILD-LOG.md`](BUILD-LOG.md) user-action checklist · [`monetization.md`](monetization.md) · v1 doc: `../deployment.md`
