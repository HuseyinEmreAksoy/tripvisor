# directions-polyline

Encoded polyline + total duration/distance for an ordered waypoint sequence
(origin -> intermediates -> destination). Waypoint order is NEVER re-optimized
here — the optimizer (or the user's manual order) already decided it.

## Contract (provider-independent numbers; `provider` names the backend since M5 Y2.3)

```
POST /functions/v1/directions-polyline
{
  "origin":        { "lat": number, "lng": number },
  "destination":   { "lat": number, "lng": number },
  "intermediates": [{ "lat": number, "lng": number }],   // 0..23 (25 waypoints total)
  "mode": "driving" | "walking" | "transit" | "bicycling",
  "perLeg": boolean                                    // M5 Y2.3, optional
}
-> 200 {
  "polyline": string | null,
  "durationSeconds": number,
  "distanceMeters": number,
  // v2 P1.2 — OPTIONAL, transit only, omitted when empty:
  "transitSteps": [{
    "polyline": string | null,            // polyline5; never null today (geometry-less steps are skipped)
    "travelMode": "WALK" | "TRANSIT",
    "lineName": string | null,            // nameShort ("M2") preferred over name; null for WALK
    "vehicleType": string | null          // Google enum verbatim (SUBWAY, BUS, TRAM, ...); null for WALK
  }],
  // M5 Y2.3 — additive:
  "provider": "ors" | "google",
  "legs": [{ "polyline": string | null, "durationSeconds": number, "distanceMeters": number }],  // perLeg only
  "noRoute": true                         // transit-no-route 200 fallback only
}
```

- `polyline` is **polyline5** (Google encoding, precision 1e5) — decoded
  client-side by `src/components/Map/polyline.ts`. Both providers return this
  exact encoding (ORS JSON `routes[0].geometry` is the same algorithm; we
  never send `elevation: true`, which would switch ORS to a 3D encoding).
- `mode: "transit"` returns top-level `polyline: null` (back-compat: clients
  not reading `transitSteps` keep drawing dashed straight segments + a Google
  Maps deep link); duration/distance still populated.
- **v2 P1.2 — `transitSteps` (ADDITIVE):** for `mode: "transit"`, the Google
  FieldMask is extended to `routes.legs.steps.polyline.encodedPolyline,
  routes.legs.steps.travelMode, routes.legs.steps.transitDetails.transitLine.
  {nameShort,name,vehicle.type}` (and drops `routes.polyline.encodedPolyline`
  — it would be wasted: the top-level polyline is null by contract). The
  response then carries one `transitSteps` entry per step with geometry, in
  route order. Steps without a polyline are skipped; any non-`TRANSIT`
  travelMode collapses to `WALK`. The field is **omitted** (never `[]`) when
  there is nothing to render — including the transit-no-route fallback.
  `optimize-trip` persists this array verbatim into `trip_legs.transit_steps`
  (jsonb, migration 0023), which the nightly 30-day TTL purge covers because
  it deletes whole rows. Non-transit modes never include the field and their
  FieldMask is unchanged.

- **M5 Y2.3 — per-leg split (ADDITIVE):** with `perLeg: true` (non-transit),
  the response adds `legs`, one entry per waypoint pair (waypoints - 1),
  so `optimize-trip` can route a run of same-mode legs in ONE call and still
  store one `trip_legs` row per leg. Google: the FieldMask gains
  `routes.legs.{duration,distanceMeters,polyline.encodedPolyline}` (only
  with intermediates). ORS: `segments[i]` give the numbers and `way_points`
  slice the geometry (decode -> slice -> re-encode in integer E5, so the
  characters are exactly the provider's). An inconsistent split is omitted,
  never guessed; the caller then asks one leg per call. Quota units are
  unchanged. `provider` is always present (`optimize-trip` records it as
  `trip_legs.source`); `noRoute: true` marks the transit-no-route fallback.

`GET ?ping=1` -> `{ ok: true, fn: "directions-polyline" }` (warmup / health).

Errors: `400 invalid_input` · `404 no_route` · `405 method_not_allowed` ·
`500 server_misconfigured` (missing Google key) · `502 upstream_error` ·
`504 upstream_timeout`.

## Routing providers (v2 N5, D2 RESOLVED: ORS primary, Google auto-fallback)

Resolution order, evaluated per request (see `_shared/routing.ts`):

1. **`app_config` row** `key='routing_provider'` (`'ors' | 'google'`) — the
   redeploy-free kill-switch (migration 0022). Probed via PostgREST with a 1s
   timeout, errors swallowed, cached in-isolate for 60s.
2. **`ROUTING_PROVIDER`** Edge Function secret — deploy-time default.
3. **`'google'`** — hard default. With neither set, behavior is exactly
   pre-N5. Unknown values at any layer are treated as absent.

When the resolved provider is `ors`:

- **Endpoint:** `POST https://api.openrouteservice.org/v2/directions/{profile}`
  with `Authorization: <ORS_API_KEY>`; body is
  `{ "coordinates": [[lng,lat], ...] }` — note **[lng, lat]** order. ORS
  routes waypoints strictly in the given order (parity with
  `optimizeWaypointOrder: false`).
- **Profiles:** `driving -> driving-car`, `walking -> foot-walking`,
  `bicycling -> cycling-regular`.
- **Transit caveat:** ORS has **no transit profile** — `mode: "transit"`
  always takes the Google path (polyline-null behavior preserved), logged as
  `{ provider_fallback: 'google', reason: 'transit_unsupported_by_ors' }`.
- **Failover:** on ANY ORS failure — missing `ORS_API_KEY`, HTTP 4xx/5xx
  (ORS reports "no route" as 404), 10s timeout, malformed response, or open
  breaker — the request falls through to the unchanged Google implementation
  automatically and logs `{ provider_fallback: 'google', reason }`. A
  genuinely unroutable leg therefore still surfaces as Google's `404
  no_route`, exactly as before N5.
- **Circuit breaker:** 3 consecutive ORS failures open the breaker for 5
  minutes (per-isolate, in-memory).
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
curl -s -X POST "$SUPABASE_URL/functions/v1/directions-polyline" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origin":{"lat":38.7,"lng":-9.14},"destination":{"lat":38.72,"lng":-9.13},"intermediates":[{"lat":38.71,"lng":-9.14}],"mode":"walking"}'

# Transit — ALWAYS Google; top-level polyline is null by contract.
# v2 P1.2: response additionally carries "transitSteps" (per-step polylines +
# line metadata) when the route has renderable steps.
curl -s -X POST "$SUPABASE_URL/functions/v1/directions-polyline" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origin":{"lat":38.7,"lng":-9.14},"destination":{"lat":38.72,"lng":-9.13},"mode":"transit"}'

# Missing destination -> 400 invalid_input
curl -s -X POST "$SUPABASE_URL/functions/v1/directions-polyline" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"origin":{"lat":38.7,"lng":-9.14},"mode":"driving"}'
```

## Tests

`deno test --allow-env --allow-net supabase/functions/directions-polyline/test.ts`
— run with `SUPABASE_URL` / `ROUTING_PROVIDER` / `ORS_API_KEY` **unset** so the
default-google path is exercised (the suite asserts the first mocked fetch is
the Google call).
