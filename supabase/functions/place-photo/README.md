# `place-photo` Edge Function

Phase 25 Step 25.4. Server-side proxy for Google Places API (New) photo media. Streams image bytes back to the caller without ever exposing the Google server key to the client.

## Why

Google's photo media endpoint embeds the API key directly in the URL (`/v1/{photoName}/media?key=<API_KEY>`). Returning that URL to the client (or even a redirect to it) leaks the server key into network traces, browser history, and the `<img>` referrer chain. This function fetches the bytes server-side and streams them back so the client only ever sees `${SUPABASE_URL}/functions/v1/place-photo?...`.

## Contract

```
GET /place-photo?photoName=<encoded>&maxWidthPx=<n>
```

| Param | Required | Description |
|---|---|---|
| `photoName` | yes | Google photo resource name, format `places/{placeId}/photos/{photoRef}`. Validated against a regex; arbitrary URLs are rejected so we are not a generic Google CDN proxy. |
| `maxWidthPx` | no | Default `400`. Clamped to `1..4800` (Google's documented bounds). |
| `ping` | no | Health check — any value triggers `{ ok: true, fn: 'place-photo' }` JSON. |

### Responses

| Status | Body | Notes |
|---|---|---|
| `200` | image bytes | `Content-Type: image/jpeg` (or upstream); `Cache-Control: public, max-age=21600` |
| `400` | `{ error: { code: 'invalid_input', message } }` | photoName missing/malformed OR maxWidthPx not an integer |
| `405` | `{ error: { code: 'method_not_allowed' } }` | non-GET request |
| `500` | `{ error: { code: 'server_misconfigured' } }` | `GOOGLE_MAPS_SERVER_KEY` missing on the Edge host |
| `502` | `{ error: { code: 'photo_not_found' \| 'google_places_disabled' \| 'google_key_restricted' \| 'google_places_forbidden' \| 'upstream_error' } }` | upstream Google failures |
| `504` | `{ error: { code: 'upstream_timeout' } }` | Google fetch exceeded `TIMEOUT_MS` (8s) |

## Auth model

`verify_jwt = false` (set in `supabase/config.toml`). The `<Image src>` element cannot set `Authorization` headers, and photo names are tied to public Google Place ids — there is nothing user-specific in the request. Key safety is preserved because the Google API key never leaves the function.

## Field mask coupling

`place-details` already returns `photos[].name` (the Google resource name) when callers include `'photos'` in their requested `fields`. The client builds the `place-photo` URL by URL-encoding that name (see `src/api/place-photos.ts`'s `usePlacePhotoUrl` hook).

## Caching

`Cache-Control: public, max-age=21600` (6h). Google's CDN URLs (the destination of the redirect we follow) typically expire within hours; 6h is a conservative ceiling that lets the browser / CDN cache without serving stale 404s for too long.

## Curl examples

Happy path:

```bash
curl -i "$SUPABASE_URL/functions/v1/place-photo?photoName=places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AciI...&maxWidthPx=400" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -o cover.jpg
# 200 OK, image/jpeg
```

Validation failure (malformed photoName):

```bash
curl -i "$SUPABASE_URL/functions/v1/place-photo?photoName=https://evil.example/x" \
  -H "apikey: $SUPABASE_ANON_KEY"
# 400 { "error": { "code": "invalid_input", ... } }
```

Server key missing:

```bash
# (with GOOGLE_MAPS_SERVER_KEY unset on the function host)
curl -i "$SUPABASE_URL/functions/v1/place-photo?photoName=places/.../photos/..."
# 500 { "error": { "code": "server_misconfigured", ... } }
```

Health check:

```bash
curl -i "$SUPABASE_URL/functions/v1/place-photo?ping=1"
# 200 { "ok": true, "fn": "place-photo" }
```
