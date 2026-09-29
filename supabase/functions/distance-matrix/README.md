# distance-matrix

Pairwise travel time / distance for N origins x M destinations. Used by
`optimize-trip` (matrix sub-blocks for k-means + 2-opt) and the client leg
cache (`trip_legs`, 30-day TTL).

## Contract (provider-independent numbers; `provider` names the backend since M5 Y2.3)

```
POST /functions/v1/distance-matrix
{
  "origins":      [{ "lat": number, "lng": number }],   // 1..25
  "destinations": [{ "lat": number, "lng": number }],   // 1..25
  "mode": "driving" | "walking" | "transit" | "bicycling"
}
-> 200 { "legs": [{ "fromIndex", "toIndex", "durationSeconds", "distanceMeters" }],
         "provider": "ors" | "google" }                    // M5 Y2.3, additive
```

- **M5 Y2.3:** `provider` names the backend that answered. `optimize-trip`
  stores it as `trip_legs.source` on the matrix-cache rows it writes (keyed by
  mode). Older callers ignore it; metering is unchanged.

Unreachable pairs are omitted from `legs` (Google `ROUTE_NOT_FOUND` / ORS
`null` cells — identical filtering on both paths).

`GET ?ping=1` -> `{ ok: true, fn: "distance-matrix" }` (warmup / health).

Errors: `400 invalid_input` · `405 method_not_allowed` · `500
server_misconfigured` (missing Google key) · `502 upstream_error` · `504
upstream_timeout`.

## Routing providers (v2 N5, D2 RESOLVED: ORS primary, Google auto-fallback)

Resolution order, evaluated per request (see `_shared/routing.ts`):

1. **`app_config` row** `key='routing_provider'` (`'ors' | 'google'`) — the
   redeploy-free kill-switch (migration 0022). Probed via PostgREST with a 1s
   timeout, errors swallowed, cached in-isolate for 60s.
2. **`ROUTING_PROVIDER`** Edge Function secret — deploy-time default.
3. **`'google'`** — hard default. With neither set, behavior is exactly
   pre-N5. Unknown values at any layer are treated as absent.

When the resolved provider is `ors`:

- **Endpoint:** `POST https://api.openrouteservice.org/v2/matrix/{profile}`
  with `Authorization: <ORS_API_KEY>`; body uses **[lng, lat]** coordinate
  order and `metrics: ['duration','distance']`.
- **Profiles:** `driving -> driving-car`, `walking -> foot-walking`,
  `bicycling -> cycling-regular`.
- **Transit caveat:** ORS has **no transit profile** — `mode: "transit"`
  always takes the Google path, logged as
  `{ provider_fallback: 'google', reason: 'transit_unsupported_by_ors' }`.
- **Failover:** on ANY ORS failure — missing `ORS_API_KEY`, HTTP 4xx/5xx
  (incl. 429 rate limits), 10s timeout, malformed response, or open breaker —
  the request falls through to the unchanged Google implementation
  automatically and logs `{ provider_fallback: 'google', reason }`. Clients
  never see an ORS-specific error.
- **Circuit breaker:** 3 consecutive ORS failures open the breaker for 5
  minutes (per-isolate, in-memory) so a down/limited ORS doesn't add 10s of
  latency to every optimize.
- Success logs include `provider: 'ors' | 'google'` and `provider_source:
  'app_config' | 'env' | 'default'`.

## Secrets

| Name | Required | Notes |
|---|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | **always** | Backs the default path AND the ORS failover — keep it set even when ORS is primary. |
| `ORS_API_KEY` | when ORS is primary | Free key: sign up at <https://openrouteservice.org> (free tier roughly 2k directions + 500 matrix requests/day, 40/min — generous for hobby scale). |
| `ROUTING_PROVIDER` | optional | `'ors' | 'google'` env default; the `app_config` row overrides it. |

Ops runbook (go live on ORS / kill-switch back): see
`supabase/migrations/README-v2.md`.

## Example calls

Auth (security audit 2026-09-29 #2): `$USER_JWT` must be a signed-in user's
access token. The public anon key alone gets `401 not_authenticated`. Every call
consumes the per-user daily routing quota (2000 billable elements per UTC day,
`DAILY_QUOTA` in `_shared/auth.ts`). When it is spent the call returns
`429 quota_exceeded` with `Retry-After`, and `503 quota_unavailable` if the
quota RPC is unreachable (the guard fails closed).

```bash
# Happy path (served by whichever provider is resolved; response identical)
curl -s -X POST "$SUPABASE_URL/functions/v1/distance-matrix" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origins":[{"lat":38.7,"lng":-9.14}],"destinations":[{"lat":38.71,"lng":-9.13}],"mode":"driving"}'

# Transit — ALWAYS Google, even with routing_provider=ors
curl -s -X POST "$SUPABASE_URL/functions/v1/distance-matrix" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origins":[{"lat":38.7,"lng":-9.14}],"destinations":[{"lat":38.71,"lng":-9.13}],"mode":"transit"}'

# Invalid input -> 400 invalid_input
curl -s -X POST "$SUPABASE_URL/functions/v1/distance-matrix" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origins":[],"destinations":[{"lat":0,"lng":0}],"mode":"driving"}'
```

## Tests

`deno test --allow-env --allow-net supabase/functions/distance-matrix/test.ts`
— run with `SUPABASE_URL` / `ROUTING_PROVIDER` / `ORS_API_KEY` **unset** so the
default-google path is exercised (the suite asserts the first mocked fetch is
the Google call).
