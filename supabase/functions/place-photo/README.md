# `place-photo` Edge Function

Phase 25 Step 25.4, hardened by security audit 2026-09-29 #3. This is the server-side proxy for Google Places API (New) photo media. It streams the image bytes back to the caller, so the Google server key never reaches the client.

## Why

Google's photo media endpoint puts the API key directly in the URL (`/v1/{photoName}/media?key=<API_KEY>`). If we returned that URL to the client, or even redirected to it, the key would leak into network traces, browser history and the `<img>` referrer chain. This function fetches the bytes server-side and streams them back.

## Security model

`verify_jwt = false` is required for the GET, because an `<Image src>` cannot send an Authorization header. Before the audit this made the function a **public, unlimited, billed proxy**. An arbitrary `maxWidthPx` from 1 to 4800 also defeated every cache. The fixes:

- **Signed URLs.** Every GET must carry `exp` and `sig`, where `sig = base64url(HMAC-SHA256(PHOTO_URL_SECRET, "<photoName>|<w>|<exp>"))`.
  - Only authenticated paths mint signatures. `place-details` embeds `photos[].signature`, and the metered `POST place-photo` below is the fallback.
  - `exp` is at most 24h out. It is bucketed to 12h windows, so a photo keeps the same URL, and therefore the same cache entry, for about 12h across refetches and users.
- **Width allowlist.** Only 200, 400, 800 and 1600 are served. Requests snap UP to the next allowed width, so each photo has at most four cache variants.
- **Replay cap.** Each isolate keeps a fixed-window rate limit: 20 fetches per signature and 300 per client IP, per 10 minutes. Going over returns `429 rate_limited`.
- **The key stays server-side.** It never leaves the function.

Pure signing logic lives in `_shared/photo-signature.ts`. Caller auth and quota live in `_shared/auth.ts`.

## Contract

### `GET /place-photo?photoName=…&maxWidthPx=…&exp=…&sig=…` (public, signature-gated)

| Status | Body | Notes |
|---|---|---|
| `200` | image bytes | Upstream `Content-Type`, with `Cache-Control: public, max-age=21600` |
| `400` | `invalid_input` | `photoName` is missing or not `places/<id>/photos/<ref>` |
| `403` | `invalid_signature` \| `signature_expired` | Missing, tampered, wrong-width or expired signature. The client re-signs. |
| `429` | `rate_limited` | Per-signature or per-IP window exceeded. Sent with `Retry-After`. |
| `500` | `server_misconfigured` | `GOOGLE_MAPS_SERVER_KEY` or `PHOTO_URL_SECRET` is unset. The function fails closed. |
| `502` | `photo_not_found` (404) \| `google_places_*` \| `upstream_error` | Google rejected the request or failed |
| `504` | `upstream_timeout` | Google took longer than 8s |

### `POST /place-photo` (authenticated fallback signer)

```json
{ "photos": [{ "name": "places/…/photos/…", "maxWidthPx": 600 }] }
```

The request takes 1 to 20 photos. It returns `{ "photos": [{ "name", "maxWidthPx": 800, "exp", "sig" }] }` and consumes `DAILY_QUOTA.photo_sign` (300 names per user per UTC day).

| Status | Code |
|---|---|
| `400` | `invalid_input` |
| `401` | `not_authenticated` |
| `429` | `quota_exceeded` |
| `503` | `quota_unavailable` |
| `500` | `server_misconfigured` |

## Client

`src/api/place-photos.ts` provides `usePlacePhotoUrl(photoName, { maxWidthPx }) → { url }`. Its signature is the same as before the audit.

1. It builds the signed URL synchronously from the signatures that `usePlaceDetails` registered.
2. Otherwise it batches one `POST place-photo` for all rows missing a signature.

`url` is `null` until a signature is available. Callers render their placeholder in that case.

## Secrets

`PHOTO_URL_SECRET` is a random value of at least 32 bytes (`openssl rand -base64 32`). Set it for the hosted project with `npx supabase secrets set PHOTO_URL_SECRET=…`. Locally it lives in `supabase/.env`.

Rotating the secret invalidates every URL already issued. Clients pick up new signatures on their next `place-details` fetch, or when the fallback signer runs.

## Curl examples

```bash
# Fallback signer (needs a signed-in user's access token)
curl -s -X POST "$SUPABASE_URL/functions/v1/place-photo" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"photos":[{"name":"places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AciI...","maxWidthPx":400}]}'
# -> {"photos":[{"name":"…","maxWidthPx":400,"exp":1790726400,"sig":"…"}]}

# Fetch bytes with the signed tuple
curl -i "$SUPABASE_URL/functions/v1/place-photo?photoName=places/…/photos/…&maxWidthPx=400&exp=1790726400&sig=…&apikey=$ANON_KEY" -o cover.jpg

# Unsigned -> 403 invalid_signature
curl -i "$SUPABASE_URL/functions/v1/place-photo?photoName=places/…/photos/…&maxWidthPx=400&apikey=$ANON_KEY"

# Health check
curl -i "$SUPABASE_URL/functions/v1/place-photo?ping=1"
```

## Tests

- `deno test --allow-env --allow-net supabase/functions/place-photo/test.ts`
- `node --experimental-strip-types --test supabase/functions/_shared/photo-signature.test.mjs`. This file also runs under `deno test`.
