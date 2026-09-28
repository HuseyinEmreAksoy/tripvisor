# Build the Android APK (EAS `preview` profile)

This produces an installable `.apk` for testing on your own phone. The Play Store build (`production`, an `.aab`) uses the same steps with `--profile production`.

`eas-cli` isn't a project dependency, so every command below runs through `npx eas-cli@latest` (never `npm i -g`). If you already have `eas` on your PATH, drop the `npx eas-cli@latest` prefix.

## 1. One-time account setup

```sh
npx eas-cli@latest login          # an Expo account (free)
npx eas-cli@latest init           # from the repo root; creates the EAS project
```

`eas init` writes `extra.eas.projectId` and `owner` into **`app.json`**. That works because `app.config.ts` is a function that spreads `app.json`. Commit that change.

## 2. Cloud env vars (the G6 lesson)

`.env` is gitignored, so an EAS cloud build **never sees it**. Store the public client values in EAS for the `preview` environment. `eas.json` already selects `"environment": "preview"`.

```sh
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project-ref>.supabase.co" --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key from Supabase > Project Settings > API>" --visibility sensitive
```

Repeat with `--environment production` before the first Play build. Check the values with `npx eas-cli@latest env:list --environment preview`.

`eas.json` already sets the non-secret values in each profile's `env`:

| Var | preview | production |
|---|---|---|
| `EXPO_PUBLIC_SYNC_TIER1` | `1` (the offline engine is ON, and this APK test doubles as the native S1.3/S2 check) | unset (OFF until the APK test passes) |
| `EXPO_PUBLIC_MAP_PROVIDER` / `EXPO_PUBLIC_MAPLIBRE_STYLE_URL` | maplibre / OpenFreeMap | same |
| `SENTRY_DISABLE_AUTO_UPLOAD` | `true` | `true` (remove it once a `SENTRY_AUTH_TOKEN` secret and the Sentry org/project are configured) |

Never put `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_MAPS_SERVER_KEY` in EAS client env. They're server-only.

## 3. Android Maps key (optional for the first build)

Without a key, the APK still works: the trip map shows the **"Map unavailable" place list** instead of a blank or crashing Google map (`src/components/Map/nativeMapsConfig.ts`). To get the real map:

1. Google Cloud Console → APIs & Services → enable **Maps SDK for Android**.
2. Create an API key. Restrict it to **Android apps**, with package `com.tripvisor.app` plus the SHA-1 of the EAS keystore. Under API restrictions, allow only Maps SDK for Android.
3. Get the SHA-1: run `npx eas-cli@latest credentials -p android`, pick the `preview` build profile, and read the keystore's **SHA1 Fingerprint**. The keystore is created on the first build, so either do the first build without a key, or temporarily create the key without the app restriction and add the SHA-1 afterwards.
4. Store the key as a build-time (non-`EXPO_PUBLIC`) var:

   ```sh
   npx eas-cli@latest env:create --environment preview --name GOOGLE_MAPS_ANDROID_KEY --value "<key>" --visibility sensitive
   ```

   `app.config.ts` injects it into `android.config.googleMaps.apiKey` only when it's set, and flips `extra.nativeMaps.android` so the app uses the Google provider. Rebuild after adding it; a native key needs a new binary, not an OTA update.

This is a package-restricted native SDK key, not the server HTTP key, so the "no HTTP key in the client" rule still holds. `GOOGLE_MAPS_IOS_KEY` works the same way for the later iOS build. Without it, iOS falls back to Apple Maps.

## 4. Build and install

```sh
npx eas-cli@latest build -p android --profile preview
```

When the build finishes, EAS prints a URL and a QR code. Open it on the phone, download the `.apk`, and allow "install unknown apps" for your browser. Version codes are managed remotely (`cli.appVersionSource: "remote"`), and `production` auto-increments them.

**Local alternative (no EAS queue):** install JDK 17 and the Android SDK (`ANDROID_HOME`), put the env vars in your shell or `.env`, then run `npx expo run:android --variant release`.

## 5. Sanity checks before building

```sh
npx expo config --type public     # no REPLACE_* anywhere; extra.nativeMaps reflects your key
npx expo-doctor
```
