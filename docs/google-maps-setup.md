# Google Maps Platform — Setup

Tripvisor needs Google Maps Platform credentials to power autocomplete, place details, distance matrix routing, directions polylines, and the web map tile layer. Without these the `add place` flow returns `server_misconfigured` and the web Map tab shows the **MapUnavailable** fallback.

This guide walks through obtaining the keys, where to put them locally, and how to verify each one works.

---

## 1. Why two keys

The project deliberately uses **two separate API keys** with different restriction profiles:

| Key | Used by | Restriction | Where it lives |
| --- | --- | --- | --- |
| **Server key** (`GOOGLE_MAPS_SERVER_KEY`) | Edge Functions: `places-autocomplete`, `place-details`, `distance-matrix`, `directions-polyline` | API restrictions: Places API (New) + Routes API. **No referrer restriction** (Edge Functions call from server-side). | Supabase Edge Function secrets only — never bundled in client code. |
| **Web JS key** (`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`) | Web bundle, Maps JavaScript API only (renders tiles + markers in `Map.web.tsx`) | API restriction: Maps JavaScript API only. **HTTP referrer restriction** to your dev host (`localhost:8081`) and prod domain. | Bundled into the web build at compile time via `EXPO_PUBLIC_*` (this is safe because the referrer restriction prevents abuse). |

Native iOS / Android use the Maps SDK keys embedded in `app.json` (restricted by bundle id + SHA-1) — those are out of scope for this doc and don't go into `.env`.

> **Why split server and web?** The server-side calls (Places API New, Routes API) bill per request and must never be callable from a public origin — that's what the server-only key + Edge Function proxy guarantees. The web JS key only powers tile rendering and is safe to ship as long as it's referrer-locked.

---

## 2. Google Cloud Console — step by step

### 2.1 Create or select a project

Go to <https://console.cloud.google.com/> and either create a new project (`Tripvisor` is fine) or select an existing one. All steps below are scoped to the active project.

### 2.2 Enable the required APIs

You need three APIs enabled. Open each link with your project active and click **Enable**:

- **Places API (New)** — <https://console.cloud.google.com/apis/library/places.googleapis.com>
  > Note: the project uses the **New** Places API only — never the legacy Places API. They have different pricing, response shapes, and field-mask semantics.
- **Routes API** — <https://console.cloud.google.com/apis/library/routes.googleapis.com>
- **Maps JavaScript API** — <https://console.cloud.google.com/apis/library/maps-backend.googleapis.com>

### 2.3 Create API key A — server key

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Click **Create credentials** → **API key**. A new key is generated; copy it.
3. Click **Edit API key** to restrict it.
4. **Application restrictions** → **None** (Edge Function egress IPs vary on Supabase; for hosted production you may later switch to **IP addresses** if Supabase publishes their egress range). For local dev, **None** is fine.
5. **API restrictions** → **Restrict key** → select **Places API (New)** and **Routes API**. Do **not** check Maps JavaScript API on this key.
6. Save. Label this key **Tripvisor — server**.

### 2.4 Create API key B — web JS key

1. Back at <https://console.cloud.google.com/apis/credentials>, click **Create credentials** → **API key** again.
2. Click **Edit API key** on the new key.
3. **Application restrictions** → **Websites** (HTTP referrers). Add:
   - `http://localhost:8081/*` (Expo web dev server)
   - `http://localhost:19006/*` (legacy Expo web port — add it too if you've ever seen it in your browser bar)
   - `https://your-production-domain.example/*` — replace with the actual domain when you deploy
4. **API restrictions** → **Restrict key** → select **Maps JavaScript API** only. Do **not** check Places or Routes on this key.
5. Save. Label this key **Tripvisor — web JS**.

> **Pitfall**: forgetting `http://localhost:8081/*` (or whatever port `npm run web` actually serves) will produce `RefererNotAllowedMapError` in the browser console and a blank map. The port is printed in the terminal when Expo starts.

---

## 3. Where to put each key

### 3.1 Local development — Edge Functions

Create the file `supabase/functions/.env` (it is git-ignored). `supabase functions serve` reads this file automatically.

```env
# supabase/functions/.env — local Edge Function secrets
GOOGLE_MAPS_SERVER_KEY=AIzaSyB-your-server-key-here
```

A template lives at `supabase/functions/.env.example` — copy it:

```bash
cp supabase/functions/.env.example supabase/functions/.env
# then edit and paste your server key
```

After editing, **restart** `npx supabase functions serve` to pick up the new value.

### 3.2 Local development — web bundle

Edit the existing `.env` at the repo root:

```env
EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=AIzaSyB-your-web-js-key-here
```

After editing, **restart** `npm run web` — Metro inlines `EXPO_PUBLIC_*` values at bundle time and the dev server caches them.

### 3.3 Hosted (production) — Edge Functions

Set the secret on the linked Supabase project. Run from the repo root with the Supabase CLI authenticated:

```bash
npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=AIzaSyB-your-server-key-here
```

Verify with `npx supabase secrets list`.

### 3.4 Hosted (production) — web bundle

`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` must be available at build time for the static export. Set it in your deploy environment:

- **Cloudflare Pages**: Settings → Environment variables → add `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` for the production environment, then redeploy.
- **Vercel**: Project settings → Environment variables → same name.
- **EAS (web)**: pass via `eas.json` `env` block or the `--env` flag at build time.

> **Reminder**: production web key must include your live domain in the HTTP referrer list (Step 2.4) or the map will render the same `RefererNotAllowedMapError` in production.

---

## 4. Verification

### 4.1 Server key — Edge Function smoke

With `npx supabase start` and `npx supabase functions serve` running, hit `places-autocomplete` directly. Replace `<ANON_KEY>` with the value of `EXPO_PUBLIC_SUPABASE_ANON_KEY` from your `.env`, and substitute a real session token (any UUID v4 works for the smoke):

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/places-autocomplete \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"input":"Lisbon","sessionToken":"00000000-0000-4000-8000-000000000000"}'
```

Expected (key configured): a JSON body with a `suggestions` array of place predictions.

If you instead see:

```json
{"error":{"code":"server_misconfigured","message":"Google Maps server key is not configured. See docs/google-maps-setup.md."}}
```

the Edge Function did not pick up `GOOGLE_MAPS_SERVER_KEY`. Check `supabase/functions/.env` exists, has the key on a line by itself with no quoting, and restart `supabase functions serve`.

### 4.2 Web JS key — browser smoke

1. Run `npm run web` and open the printed URL (typically `http://localhost:8081`).
2. Sign in, open any trip, switch to the **Map** tab.
3. The Google map tiles should render with markers for any places already added. Open DevTools → Console — there should be no `Google Maps JavaScript API` warnings or `RefererNotAllowedMapError`.

If you see the **Map unavailable** card with a list of places: `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` is empty or unset. Edit `.env`, restart `npm run web`, and hard-reload the browser (the bundle is cached).

If you see a grey panel with a Google watermark and a referrer error in the console: the web key is set but its HTTP referrer list does not include your dev host. Re-check Step 2.4.

### 4.3 End-to-end add-place

With both keys configured:

1. Open any trip → **Add a place** → type `Lisbon` (or any city).
2. Suggestions appear within ~1 s.
3. Tap one — the detail panel renders with `displayName`, address, and the `Default visit duration` line.
4. Tap **Add to trip** — the trip detail page now lists the place. `optimize-trip` will fire automatically once you have at least 2 places.

---

## 5. Free-tier guidance

Google Maps Platform provides a recurring **$200/month credit**, which on this project's usage shape covers roughly:

- ~70,000 autocomplete sessions (with session token discipline)
- ~12,000 Place Details calls including reviews + photos
- Generous Distance Matrix + Routes calls for trip optimization

The codebase is already designed to stay well under this:

- **Autocomplete session tokens** — `useAutocompleteSessionToken()` mints one token per add-place mount and propagates it to the subsequent `place-details` call. This bills both calls as one session ($0 marginal for details).
- **Field masks** — every Edge Function sends `X-Goog-FieldMask` with only the fields the client needs. List views never request `reviews,photos`.
- **Distance Matrix caching** — results land in `trip_legs` keyed by `(from_place_id, to_place_id, transport_mode)` with a 30-day TTL (`computed_at`). Repeat optimizes for the same place set are free.
- **Client React Query cache** — `staleTime: 1h` on details and `gcTime: 24h` keep repeat reads off the network.

Setting **billing alerts** in the Cloud Console (Billing → Budgets & alerts) at $50, $100, $150 is recommended — even free-tier projects should be alerted to runaway usage.

---

## 6. Common pitfalls

1. **Empty `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`** — the Map tab silently degrades to the list-view fallback (`MapUnavailable`). Check the value and restart Metro.
2. **Forgot to enable an API** — Places API (New) and the legacy Places API are separate listings. Enable Places API **(New)** specifically, plus Routes API and Maps JavaScript API.
3. **Referrer list missing `localhost`** — the web map renders blank with a console error. Add `http://localhost:8081/*`.
4. **Server key with referrer restriction** — Edge Functions call Google with no `Referer` header, so any referrer restriction will reject every request. Server key must be **Application restrictions: None** (or IP-restricted, never referrer-restricted).
5. **Both keys with broad API access** — defence in depth: the server key should not have Maps JavaScript API enabled, and the web key should not have Places or Routes enabled. If either key leaks, the blast radius is bounded.
6. **Editing `.env` without restarting** — Metro bundles env values at startup. The Supabase functions runtime reads `supabase/functions/.env` at boot. Restart both after any change.
7. **Confusing root `.env` with `supabase/functions/.env`** — `EXPO_PUBLIC_*` go in the root `.env`. `GOOGLE_MAPS_SERVER_KEY` goes in `supabase/functions/.env`. These are read by different processes.
