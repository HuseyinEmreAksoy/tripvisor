# Running Tripvisor

A single Expo codebase ships to **iOS, Android, and Web**. This guide walks you through provisioning the backends, then running each platform.

> **TL;DR (web only, fastest path)**
> After prereqs + first-time setup below:
> ```
> npm run web
> ```
> Hits `http://localhost:8081` in your browser.

---

## 1. Prerequisites

Install once, reuse across platforms.

| Tool | Min version | Notes |
|---|---|---|
| **Node.js** | 20.x LTS | Use `nvm` / `volta` / `fnm` to pin |
| **Git** | any recent | |
| **Expo CLI** | bundled via `npx` | Don't install globally |
| **Supabase CLI** | 1.x | `npm i -g supabase` **or** use `npx supabase` |
| **Docker Desktop** | latest | Only if you want a local Supabase stack |
| **Xcode** | 15+ | iOS only, Mac required |
| **Android Studio** | Hedgehog+ | Android only, any OS |
| **EAS CLI** | latest | `npm i -g eas-cli` — for native builds |

Check versions:
```
node -v            # >= v20
npm -v             # >= 10
npx supabase --version
```

---

## 2. First-time setup

### 2.1 Clone & install

```
git clone https://github.com/HuseyinEmreAksoy/tripvisor.git
cd tripvisor
npm install
npx expo install --check    # aligns versions to the installed Expo SDK
```

### 2.2 Environment variables

Copy the template and fill it in:

```
cp .env.example .env
```

You'll fill in three client-side values:

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=<referer-restricted browser key>
EXPO_PUBLIC_SENTRY_DSN=          # optional — when set, unhandled errors stream to Sentry; leave blank to disable
EXPO_PUBLIC_APP_URL=             # optional. Web: defaults to window.location.origin.
                                 # Native: defaults to https://tripvisor.pages.dev; set it only if the web app lives elsewhere.
                                 # Share links are always https://<origin>/share/<token> (never the tripvisor:// scheme).
```

Server-only keys (`GOOGLE_MAPS_SERVER_KEY`, `ALLOWED_ORIGINS`) go into Supabase Edge Function secrets — see 2.4 below. Do **not** put them in `.env`.

### 2.3 Supabase

**Option A — hosted Supabase (recommended).**

1. Create a project at <https://supabase.com/dashboard>.
2. Copy `Project URL` and `anon` key into `.env`.
3. Link + push the schema:
   ```
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This applies `supabase/migrations/0001_init.sql` and `0002_rpcs.sql` (tables + RLS + the two Phase 3 RPCs).
4. Deploy the five Edge Functions:
   ```
   npx supabase functions deploy places-autocomplete
   npx supabase functions deploy place-details
   npx supabase functions deploy distance-matrix
   npx supabase functions deploy directions-polyline
   npx supabase functions deploy optimize-trip
   npx supabase functions deploy share-trip
   ```
5. Set server-side secrets:
   ```
   npx supabase secrets set \
     GOOGLE_MAPS_SERVER_KEY=<unrestricted-server-key> \
     ALLOWED_ORIGINS=http://localhost:8081,https://<your-deployed-web-host>
   ```
6. In the Supabase dashboard → **Authentication → URL Configuration**, add Redirect URLs for magic-link auth:
   - Native: `tripvisor://`
   - Local web: `http://localhost:8081`
   - Production web: `https://<your-deployed-web-host>`

**Option B — local Supabase (optional, for offline dev + RLS tests).**

```
npx supabase init
npx supabase start          # starts Postgres + Edge runtime in Docker
npx supabase db reset       # applies migrations
npx supabase functions serve
```

Local URLs print on startup (Postgres, Studio, anon key). Paste those into `.env` instead of the hosted ones.

### 2.4 Google Cloud Platform

1. Create a GCP project at <https://console.cloud.google.com/>.
2. Enable billing (the $200/mo free credit covers hobby use).
3. Enable these APIs:
   - **Places API (New)**
   - **Routes API**
   - **Maps SDK for iOS**
   - **Maps SDK for Android**
   - **Maps JavaScript API**
4. Create **two** API keys under **APIs & Services → Credentials**:

   | Key | Restriction | Where it lives |
   |---|---|---|
   | **Server key** | None (server-side only) | Supabase secrets as `GOOGLE_MAPS_SERVER_KEY`. **Never** commit. |
   | **Web key** | HTTP referer — allow-list `http://localhost:8081/*` and your deployed host | `.env` as `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`. Used for the web map + photo URLs. |

5. For native, add Maps SDK keys to `app.json`:
   ```json
   "ios": { "config": { "googleMapsApiKey": "<ios-sdk-key>" } },
   "android": { "config": { "googleMaps": { "apiKey": "<android-sdk-key>" } } }
   ```
   Restrict these by bundle id + SHA1 (Android) in GCP Console.

### 2.5 EAS (native builds only)

```
npm i -g eas-cli
eas login
eas build:configure    # writes eas.json once
```

---

## 3. Run on Web

Easiest platform — no device, no EAS build.

```
npm run web
```

Opens `http://localhost:8081`. Hot reload works. Press `w` to reopen the browser, `r` to reload.

To bundle a static export (e.g. to deploy to Cloudflare Pages):
```
npm run build:web
# output in dist/
```
Deploy `dist/` to any static host.

---

## 4. Run on iOS

**Requires macOS + Xcode.**

Tripvisor needs `expo-dev-client` because `react-native-maps` is a native module (Expo Go is not supported).

### Simulator

```
# First time: builds the dev client (~5-10 min)
npm run ios
```

Subsequent runs: `npm run start`, then press `i`.

### Physical device

```
eas build --profile development --platform ios
```

Wait for the build, install the resulting `.ipa` on your device via the QR code Expo shows, then:
```
npm run start
```
Scan the QR code in your device's camera.

### Over-the-air updates

Once the dev client is installed, push JS-only updates via:
```
eas update --branch development
```

---

## 5. Run on Android

Any OS with Android Studio + an emulator or USB-connected device.

### Emulator

```
# Start an emulator in Android Studio first, then:
npm run android
```

Subsequent runs: `npm run start`, press `a`.

### Physical device

1. Enable Developer Options + USB debugging on the device.
2. `adb devices` should list it.
3. ```
   eas build --profile development --platform android
   ```
   Install the resulting `.apk` on the device.
4. `npm run start`, scan QR from Expo Go camera or the dev client.

---

## 6. Tests

| Command | What it runs |
|---|---|
| `npm test` | Jest unit + component tests (`src/**/__tests__`) |
| `npx jest tests/rls.test.ts` | RLS two-user isolation test — requires local or hosted Supabase + service-role key in env |
| `npx jest tests/rpc.test.ts` | Phase 3 RPC ownership tests — same prereqs |
| `deno test --allow-env --allow-net supabase/functions/**/test.ts` | Edge Function integration tests |

### Sentry DSN-present coverage

`babel-preset-expo` inlines `EXPO_PUBLIC_*` env vars at build time, so the DSN-present branch of `initSentry()` is unreachable from a plain `npm test`. To exercise that branch locally, run:

```
EXPO_PUBLIC_SENTRY_DSN=any-value npm test
```

### Supabase integration tests

RLS / RPC tests look for these env vars (set them in your shell before running):
```
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_ANON_KEY=<anon>
export SUPABASE_SERVICE_ROLE_KEY=<service-role>    # required for user-creation helpers
```

---

## 7. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `Unable to resolve module react-native-maps` in web build | You imported the native-only component in shared code. Move to `Map.native.tsx` or use the `Map` barrel in `src/components/Map/`. |
| Blank map on web | Missing `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`, or key not HTTP-referer-restricted. Check browser console for `InvalidKey`. |
| `401 invalid_token` on Supabase calls | `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` mismatch in `.env`. Rerun `npm start -- --clear` to bust the Expo cache. |
| Magic-link email arrives but tapping the link doesn't open the app | Redirect URL isn't in Supabase Auth → URL Configuration allow-list, or `scheme` in `app.json` doesn't match. |
| Autocomplete returns empty | Places API (New) not enabled in GCP, or server key missing in Supabase secrets. `curl -X POST <function-url>?ping=1` to check the function boots. |
| `expo install --check` flags drift | Run `npx expo install --check --fix` to auto-align versions. |
| Reanimated animations silently do nothing | `react-native-reanimated/plugin` must be the **last** plugin in `babel.config.js`. |
| RLS test says "skipped" | Missing `SUPABASE_SERVICE_ROLE_KEY` env var — the test is gated on it to avoid accidentally hitting prod. |

---

## 8. What to do after first successful run

Smoke-test the golden path on each platform:

1. Sign up with a real email → click magic link
2. Create a trip: "Lisbon 3 days", 8 h / day, Drive
3. Add 5–10 places via autocomplete (mix museums, restaurants, viewpoints)
4. Wait ~1s — the optimizer should auto-run and the Itinerary tab should show days
5. Switch to the Map tab — color-coded pins + polylines per day
6. Long-press a place → change duration, move to a different day
7. Drag to reorder within a day
8. Open a place to see live Google reviews

Tick the **Platforms verified** boxes in `docs/features/*.md` after each platform passes.

---

## Reference

- Repo layout & conventions: [`CLAUDE.md`](./CLAUDE.md)
- Living roadmap + phase status: [`plan.md`](./plan.md)
- Stack & data flows: [`docs/architecture.md`](./docs/architecture.md)
- Feature specs: [`docs/features/`](./docs/features/)
- Review history: [`docs/reviews/`](./docs/reviews/)
