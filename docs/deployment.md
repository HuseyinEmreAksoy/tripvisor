# Tripvisor — Free-tier deployment guide

This guide walks you through deploying Tripvisor end-to-end on the free tier of every required service. By the end you will have:

- A hosted Supabase project (Postgres, Auth, Edge Functions).
- A live web app on Cloudflare Pages, deploying automatically on every push.
- An installable Android dev client (and, optionally, production app) built with EAS.
- iOS via EAS, **only if** you have an Apple Developer account ($99/yr — optional).

You can ship Web + Android for **$0**. iOS adds the Apple Developer fee. Google Play Store has a one-time $25 fee if you publish there. Everything else (Supabase, Cloudflare, EAS, Google Maps within typical solo usage) sits inside free tiers.

---

## Overview

| Layer | Where it lives | Free-tier limits |
| --- | --- | --- |
| Web bundle (static) | Cloudflare Pages | Unlimited bandwidth, 500 builds/mo, 1 build at a time |
| Postgres + Auth + Storage | Supabase Cloud | 500 MB DB, 2 GB egress, 50k MAU |
| Edge Functions | Supabase Cloud | 500k invocations/mo, 2M CPU-seconds, 250 MB outbound transfer |
| Android / iOS builds | Expo Application Services (EAS) | 30 builds/mo across both platforms (free plan) |
| OTA JS updates | EAS Update | 1k MAU on free plan |
| Google Places + Routes + Maps JS | Google Maps Platform | $200/mo recurring credit |
| Google Play Store (publish) | Google Play Console | $25 one-time registration |
| Apple App Store (publish) | Apple Developer Program | **$99/yr** (optional) |

Tripvisor is engineered to stay well under all of these — see `docs/google-maps-setup.md` § 5 for the cost-control patterns (session tokens, field masks, Distance Matrix caching, React Query persistence).

---

## Prerequisites

Create accounts (you, the human, must do this — credentials cannot be automated):

1. **Supabase Cloud** — <https://supabase.com> — free, no card required.
2. **Cloudflare** — <https://cloudflare.com> — free, no card required for Pages.
3. **Expo / EAS** — <https://expo.dev> — free, no card required for the free plan.
4. **Google Cloud Console** — <https://console.cloud.google.com> — required for Maps Platform; needs a billing account on file even though the $200/mo credit covers typical usage.
5. *(Optional)* **Google Play Console** — <https://play.google.com/console> — $25 one-time, needed only if you publish to the Play Store.
6. *(Optional)* **Apple Developer Program** — <https://developer.apple.com/programs/> — $99/yr, needed only if you publish to the App Store or distribute via TestFlight.

You will also need:
- The Tripvisor repo pushed to your own GitHub (already done — `https://github.com/HuseyinEmreAksoy/tripvisor`).
- Node 22+ and the Supabase CLI installed locally (`npx supabase --version` should resolve).
- The Expo CLI: works via `npx expo`.

---

## Step 1 — Supabase Cloud project

### 1.1 Create the project

1. Sign in at <https://supabase.com/dashboard>.
2. **New project** → name it `tripvisor` → pick a region close to your users (e.g. `eu-west-2` for UK/EU) → set a strong DB password (save it; you rarely need it after this step) → **Create**.
3. Wait ~2 min for the project to provision.

### 1.2 Capture the credentials

Open **Project Settings → API** and save these three values somewhere secure (you will paste them into Cloudflare and your local `.env`):

- **Project URL** → goes to `EXPO_PUBLIC_SUPABASE_URL`
- **anon / public key** → goes to `EXPO_PUBLIC_SUPABASE_ANON_KEY` (safe to bundle; RLS gates everything)
- **service_role key** → keep secret; **never** put it in the client bundle. It is only needed if you run a one-off admin script.

### 1.3 Link the local CLI to the cloud project

From the repo root:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
```

`<project-ref>` is the random subdomain in the project URL (e.g. `abcdefgh` from `https://abcdefgh.supabase.co`).

### 1.4 Apply migrations

```bash
npm run deploy:db
```

This runs `supabase db push --linked` and applies all 18 migrations in `supabase/migrations/` to the cloud project. It is **non-destructive** — it only adds what is missing.

Verify in the Supabase dashboard → **Table Editor** that `trips`, `trip_places`, `trip_legs`, `trip_collaborators`, `trip_accommodations`, `trip_budget_categories`, `trip_place_reactions`, etc. all exist.

### 1.5 Set Edge Function secrets

The server-only Google Maps key must live in Supabase secrets (not in any committed file):

```bash
npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=AIzaSy-your-server-key
# Optional, only if you wire Sentry into Edge Functions:
# npx supabase secrets set SENTRY_DSN=https://...
```

Verify with:

```bash
npx supabase secrets list
```

You should see `GOOGLE_MAPS_SERVER_KEY` in the list (the value is masked).

> Get the server key by following `docs/google-maps-setup.md` § 2.3. The server key has **no referrer restriction** and is restricted by API to Places API (New) + Routes API only.

### 1.6 Deploy all Edge Functions

```bash
npm run deploy:functions
```

This is a wrapper that runs:

```
supabase functions deploy places-autocomplete
supabase functions deploy place-details
supabase functions deploy place-photo --no-verify-jwt
supabase functions deploy distance-matrix
supabase functions deploy directions-polyline
supabase functions deploy optimize-trip
supabase functions deploy manage-collaborators
supabase functions deploy share-trip
supabase functions deploy delete-account
supabase functions deploy export-account
```

Notes:
- `place-photo` is deployed with `--no-verify-jwt` because the function URL is embedded directly in `<Image src>`, which cannot send an `Authorization` header. This is also asserted in `supabase/config.toml` (`[functions.place-photo] verify_jwt = false`). The function key is never exposed; safety is preserved by the API-key-stays-on-server pattern.
- All other functions use the default `verify_jwt = true`, so the Supabase client must be authenticated for them to work.
- If you only need to redeploy one, use `npx supabase functions deploy <name>` directly.

Smoke-test one function with the project URL + anon key:

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/places-autocomplete' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"input":"Lisbon","sessionToken":"00000000-0000-4000-8000-000000000000"}'
```

Expected: a JSON `suggestions` array. If you see `server_misconfigured`, the secret in step 1.5 did not stick — re-run `npx supabase secrets list` and `npm run deploy:functions`.

### 1.7 Configure Auth (defer the Site URL until Step 2 is live)

In the Supabase dashboard:

1. **Authentication → Providers** — confirm **Email** is enabled (it is by default). No password requirement changes are needed.
2. **Authentication → URL Configuration** — leave **Site URL** as the default for now; come back after Step 2 to set it to your live Cloudflare Pages domain.
3. **Authentication → Rate Limits** — defaults are fine for solo usage; bump only if you see legitimate throttling.

---

## Step 2 — Cloudflare Pages (web)

### 2.1 Connect the GitHub repo

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Authorize Cloudflare to read your GitHub repos (one-time per account).
3. Pick `HuseyinEmreAksoy/tripvisor`.

### 2.2 Configure the build

| Field | Value |
| --- | --- |
| Project name | `tripvisor` (gives you `tripvisor.pages.dev`) |
| Production branch | `master` |
| Framework preset | **None** (manual settings below) |
| Build command | `npm install && npm run build:web` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |
| Node version | `22` (set under **Environment variables** as `NODE_VERSION=22`; also pinned in `.nvmrc`) |

### 2.3 Set environment variables in Cloudflare Pages

Pages → your project → **Settings → Environment variables** → **Production**. Add:

| Name | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `EXPO_PUBLIC_SUPABASE_URL` | the Project URL from Step 1.2 |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon key from Step 1.2 |
| `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` | the **WEB** Google Maps key (Maps JS only, referrer-restricted — see `docs/google-maps-setup.md` § 2.4). **NOT the server key.** |
| `EXPO_PUBLIC_SENTRY_DSN` | *(optional — leave unset to disable Sentry)* |

Repeat the four `EXPO_PUBLIC_*` for the **Preview** environment too if you want PR preview deploys to work end-to-end.

### 2.4 First deploy

Click **Save and Deploy**. Cloudflare will:
1. Clone the repo at `master`.
2. Run `npm install && npm run build:web`.
3. Publish `dist/` at `https://tripvisor.pages.dev` (or your custom subdomain).

Build time on a clean checkout is ~3–5 min. The bundle size ceiling is generous (Cloudflare Pages: 25 MB per file, 20k files per deploy); Tripvisor is well under both.

### 2.5 SPA fallback for dynamic routes

Tripvisor uses Expo Router static export. Most routes pre-render to HTML files (`/trips.html`, `/login.html`, etc.) which Cloudflare serves directly. **Dynamic routes** (`/trip/[id]`, `/share/[token]`, `/invite/[token]`, `/place/[placeId]`) export as literal `[id].html` files — meaning a direct visit to `/trip/abc-123` will 404 unless URL rewriting is in place.

Cloudflare Pages serves `[id].html` for the literal URL `/trip/[id]` but does **not** rewrite `/trip/abc-123` → `/trip/[id].html` automatically.

**Fix**: add a `public/_redirects` file at the repo root **before** the first deploy (or push it now and re-deploy). Cloudflare Pages copies anything in `public/` into the build output.

Create `public/_redirects` with:

```
/trip/:id/collaborators  /trip/[id]/collaborators.html  200
/trip/:id/print          /trip/[id]/print.html          200
/trip/:id/add            /trip/[id]/add.html            200
/trip/:id                /trip/[id].html                200
/share/:token            /share/[token].html            200
/invite/:token           /invite/[token].html           200
/place/:placeId          /place/[placeId].html          200
/*                       /index.html                    200
```

The trailing `/* /index.html 200` is a safety net so any unrecognized path lands on the SPA shell instead of a hard 404. `200` (rewrite, same URL bar) is correct here; `301` (redirect) would change the URL bar and break deep-links.

> If you skip this step, the in-app navigation works fine (it's all client-side), but a fresh browser load of `/trip/abc-123` (e.g. someone clicking a shared link) will 404. Add the `_redirects` file before sharing live URLs.

### 2.6 Update Supabase Auth Site URL

Now that you have the Pages URL, go back to **Supabase dashboard → Authentication → URL Configuration**:

- **Site URL**: `https://tripvisor.pages.dev` (or your custom domain).
- **Redirect URLs** (additional): add `https://tripvisor.pages.dev/**` and your custom domain if any. Magic-link emails include the redirect URL; if it isn't on the allow-list, the link will fail.

### 2.7 Custom domain (optional)

Pages → your project → **Custom domains** → add a domain you own. Cloudflare provisions a TLS cert automatically. After the cert is live, repeat Step 2.6 with the custom domain.

---

## Step 3 — EAS for mobile (Android first, iOS optional)

### 3.1 Login + project link

```bash
npx eas login
npx eas init                # creates the Expo project + writes projectId into app.json
```

`eas init` is the recommended command in EAS CLI v7+ to bind a local repo to a new Expo project. After it runs, `app.json` will contain:

```json
"extra": {
  "eas": {
    "projectId": "..."
  }
}
```

If you previously ran the older `eas build:configure`, that also works — it does the same thing and additionally validates `eas.json`.

### 3.2 Confirm the bundle identifiers

`app.json` is already set to:
- `expo.android.package = "com.tripvisor.app"`
- `expo.ios.bundleIdentifier = "com.tripvisor.app"`

These are stable reverse-DNS identifiers and they are what get registered with Google Play / App Store. **Do not change them after your first store upload** — once a package name is published, it cannot be changed; you would need a new app listing. If you want a different identifier (e.g. `com.huseyinemreaksoy.tripvisor`), change it now in `app.json` before any production build.

### 3.3 Native Maps SDK keys

`app.json` has placeholders:

```json
"ios.config.googleMapsApiKey": "REPLACE_WITH_IOS_MAPS_KEY"
"android.config.googleMaps.apiKey": "REPLACE_WITH_ANDROID_MAPS_KEY"
```

These are **separate** from the server key and the web JS key. They are embedded in the binary and restricted in Google Cloud Console by:

- iOS: **iOS app** restriction with the bundle identifier (`com.tripvisor.app`).
- Android: **Android app** restriction with the package name + the SHA-1 of the signing certificate (you'll get the SHA-1 from EAS after the first build via `eas credentials`).

Create these two keys in Google Cloud Console (separate from the server key and web JS key — defence in depth), API-restricted to **Maps SDK for iOS** and **Maps SDK for Android** respectively, then paste them into `app.json` before any production build. For development client builds you can use the same web JS key as a placeholder (it'll throw map errors at runtime but the rest of the app works).

### 3.4 Development client (Android)

The dev client lets you run `npx expo start` against a real device and hot-reload native code. Built once per native dependency change.

```bash
npx eas build --platform android --profile development
```

This uses the `development` profile in `eas.json` (`developmentClient: true`, `distribution: "internal"`). When it finishes (~15 min), EAS gives you an APK URL. Install it on your Android device by opening the URL on the phone and allowing "install from unknown sources".

Then:
```bash
npx expo start --dev-client
```

Scan the QR code from the dev client app on your phone.

### 3.5 Internal preview build (Android)

For sharing a TestFlight-equivalent build with friends/testers without going through Play Store:

```bash
npm run deploy:android:preview
```

EAS produces a downloadable APK under the `preview` profile. Send the link to testers; they install over-the-air via "unknown sources".

### 3.6 Production build + Play Store submit (Android)

```bash
npm run deploy:android:production
```

This builds an `.aab` (Android App Bundle) under the `production` profile.

To publish:

```bash
npx eas submit --platform android --latest
```

Prereqs:
- A **Google Play Console** account ($25 one-time fee).
- A service account JSON from Google Play Console with API access (`eas submit` will prompt you the first time).
- App listing already created in Play Console with the package name `com.tripvisor.app`.

### 3.7 iOS (optional, requires Apple Developer Program — $99/yr)

If you have a paid Apple Developer account:

```bash
npm run deploy:ios:preview
# or for App Store:
npx eas build --platform ios --profile production
npx eas submit --platform ios --latest
```

EAS handles Apple certificates and provisioning profiles automatically the first time (`eas credentials` lets you inspect/rotate them). You must add testers in TestFlight via App Store Connect.

### 3.8 OTA updates (JS-only changes)

For changes that touch only JS/TS/assets (no native dependency change), you can ship to all installed clients without a fresh store upload:

```bash
npm run deploy:ota
```

This calls `eas update --branch production`. Native dev clients on the `development` profile and any production binary that was built with `eas update:configure` will pick up the new bundle on next launch.

If you have not yet run it, do this once:

```bash
npx eas update:configure
```

It wires `app.json`'s `expo.updates.url` and `expo.runtimeVersion` so over-the-air pickup is possible.

---

## Step 4 — Google Maps Platform

The full key setup lives in **`docs/google-maps-setup.md`**. The deployment-specific notes:

- **Three keys** (not two), each with its own restriction profile:
  1. **Server key** (Edge Functions): API-restricted to Places API (New) + Routes API. **No referrer restriction.** Goes into Supabase secrets (Step 1.5).
  2. **Web JS key** (web bundle): API-restricted to Maps JavaScript API only. **HTTP referrer restriction** to `http://localhost:8081/*` and `https://tripvisor.pages.dev/*` (and any custom domain). Goes into Cloudflare Pages env vars (Step 2.3) and your local `.env`.
  3. **Native SDK keys** (one for iOS, one for Android): API-restricted to Maps SDK for iOS / Maps SDK for Android. iOS-app / Android-app restrictions to the bundle id + (Android only) signing-cert SHA-1. Goes into `app.json` (Step 3.3).
- **Enable these APIs** in Google Cloud Console for the project:
  - Places API (New) — `places.googleapis.com`
  - Routes API — `routes.googleapis.com`
  - Maps JavaScript API — `maps-backend.googleapis.com`
  - Maps SDK for iOS — `maps-ios-backend.googleapis.com`
  - Maps SDK for Android — `maps-android-backend.googleapis.com`
- **Billing**: a billing account must be linked to the GCP project (Google requires this even though the $200/mo credit covers typical usage). Set a **budget alert** at $50, $100, $150 in **Billing → Budgets & alerts** so you find out before the bill spikes.

---

## Step 5 — Verify the deploy

Smoke-check after the first end-to-end deploy. Mark each as you confirm:

- [ ] Open `https://tripvisor.pages.dev` in a fresh browser. The login screen renders without console errors.
- [ ] Sign up with a test email. The magic-link email arrives within 1 min.
- [ ] After confirming, you land on `/trips`. Empty state renders.
- [ ] Create a new trip. Add 2 places via autocomplete. Suggestions appear within ~1 s.
- [ ] Switch to the Map tab. Google tiles render (no `MapUnavailable` card, no `RefererNotAllowedMapError` in console).
- [ ] The optimizer banner appears and resolves once Distance Matrix returns.
- [ ] Visit `https://tripvisor.pages.dev/trip/<id>` directly in a fresh tab — the trip detail page loads (this is the SPA-fallback test from Step 2.5; if it 404s, your `_redirects` is missing).
- [ ] Open **Settings → Account → Invite collaborator** and email yourself at a secondary address. The invite email arrives.
- [ ] Open the same trip on the Android dev client (Step 3.4). Sign in. The trip syncs.
- [ ] Open Cloudflare Pages dashboard → your project → **Functions / Invocations** is unused (no SSR). **Build logs** show the last build green.
- [ ] Open Supabase dashboard → **Edge Functions → Logs**. Each function shows recent successful invocations (no `server_misconfigured`).
- [ ] Open Supabase dashboard → **Database → Logs**. RLS blocks (status `42501`) appear only for paths you actually expect to be denied.
- [ ] Open Google Cloud Console → **APIs & Services → Metrics**. Places API (New) and Routes API show requests; Maps JavaScript API shows page loads.

---

## Cost summary

| Item | Cost | Notes |
| --- | --- | --- |
| Cloudflare Pages (web) | $0 | Unlimited bandwidth, 500 builds/mo |
| Supabase Cloud (DB + Auth + Edge Functions) | $0 | 500 MB / 2 GB / 500k inv per month |
| EAS Build | $0 | 30 builds/mo across iOS + Android |
| EAS Update (OTA) | $0 | up to 1k MAU |
| Google Maps Platform | $0 | within $200/mo recurring credit at solo usage |
| Google Play Store (publish) | $25 | one-time, only if publishing |
| Apple App Store (publish) | $99/yr | only if publishing iOS |
| **Total to ship Web + Android dev** | **$0** | |
| **Total to publish Web + Android** | **$25 one-time** | |
| **Total to publish all three platforms** | **$25 one-time + $99/yr** | |

---

## Troubleshooting

**`server_misconfigured` from any Edge Function**
Check `npx supabase secrets list`. If `GOOGLE_MAPS_SERVER_KEY` is missing, re-run Step 1.5 and redeploy functions (`npm run deploy:functions`).

**Web shows the "Map unavailable" card**
`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is not set in Cloudflare Pages env vars (Step 2.3). After adding it, **trigger a new deploy** — Pages does not rebuild on env-var changes alone (push an empty commit or click "Retry deployment"). Then hard-reload the browser.

**Web map shows blank with `RefererNotAllowedMapError` in console**
The web JS key's HTTP referrer restriction does not include the Pages domain. In Google Cloud Console → API key edit → add `https://tripvisor.pages.dev/*` and any custom domain. Wait ~5 min for propagation and hard-reload.

**`/trip/abc-123` returns 404 on a fresh browser**
The `public/_redirects` file is missing or wrong (Step 2.5). Add it, commit, push.

**Magic-link email lands on a "redirect not allowed" error**
**Authentication → URL Configuration** in Supabase does not include your Pages domain. Add it to **Site URL** and **Redirect URLs** (Step 2.6).

**Android EAS build fails with "projectId is required"**
Run `npx eas init` (or `npx eas build:configure`) again — it re-syncs `app.json`'s `extra.eas.projectId` to the linked Expo project.

**`eas submit` fails with "package name not found"**
You haven't created the app in Google Play Console yet. Create the listing with package name `com.tripvisor.app` first, upload one signed `.aab` manually, then `eas submit` will work for subsequent uploads.

**`place-photo` returns 401 / "Missing authorization header"**
You forgot the `--no-verify-jwt` flag when deploying. Re-run `npx supabase functions deploy place-photo --no-verify-jwt` (or just `npm run deploy:functions`, which already includes the flag).

**Cloudflare build fails with "node: command not found" or build timeout**
Add `NODE_VERSION=22` to the Pages env vars (Step 2.3). Default is older.

**Google Maps key works locally but fails on Pages**
You are using the local-dev `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` (which has `localhost:8081` in the referrer list) on the production domain. Either add the Pages domain to that key's referrer list, or create a separate web JS key for production and set it in Pages env vars only.

**`npm run deploy:db` says "no migrations to apply"**
The remote DB is already at HEAD. Check **Supabase dashboard → Table Editor** to confirm the schema matches; if a table is missing, the migration history may be out of sync — open **Database → Migrations** in the dashboard and reconcile.

---

## Maintenance runbook

- **Rotate the Google server key**: create a new key with the same restrictions in Cloud Console, run `npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=<new>`, run `npm run deploy:functions` (forces a new edge deployment that picks up the secret), then delete the old key in Cloud Console.
- **Rotate the Supabase service-role key** (if you use it server-side): rotate in **Project Settings → API → Reset service_role key**. Update any place it's stored. The anon key normally never needs rotation unless leaked.
- **Schema migration to live DB**: write the migration in `supabase/migrations/NNNN_*.sql`, test locally with `npx supabase db reset` (LOCAL ONLY), commit, then `npm run deploy:db`.
- **Edge Function code change**: edit, then `npx supabase functions deploy <name>` (or `npm run deploy:functions` for all).
- **Web change**: push to `master`. Cloudflare auto-deploys. The GitHub Actions `Build web` workflow also runs as a sanity check and uploads the bundle as an artifact.
- **OTA JS update for installed mobile apps**: `npm run deploy:ota`.
- **New native dependency**: bump it in `package.json`, then a new EAS build of every active profile (`npm run deploy:android:production`, etc.) — OTA cannot ship native code.
