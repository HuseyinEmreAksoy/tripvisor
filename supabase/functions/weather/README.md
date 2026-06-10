# weather

Per-day forecast for a trip's anchor location, proxied from **Open-Meteo**
(free, **keyless** — no secret to configure). Powers the P2 forecast chips on
the itinerary timeline and the rainy-day → indoor-swap nudge (via gap-fill).

## Contract

```
POST /functions/v1/weather
{
  "lat": number,            // -90..90
  "lng": number,            // -180..180
  "startDate": "YYYY-MM-DD",
  "days": number            // int 1..16 (Open-Meteo's forecast horizon)
}
-> 200 {
  "days": [{
    "date": "YYYY-MM-DD",
    "weatherCode": int,        // WMO interpretation code (see below)
    "tMaxC": number,
    "tMinC": number,
    "precipProbMax": int|null  // max daily precipitation probability, %
  }]
}
```

Success responses carry `Cache-Control: private, max-age=3600` (forecast
models refresh ~hourly; the client hook mirrors this with `staleTime: 1h`).

Days whose core fields come back `null` from the model (possible at the far
edge of the horizon) are **omitted** — consumers must map by `date`, never by
array index against trip days.

`GET ?ping=1` → `{ ok: true, fn: "weather" }` (warmup / health).

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_input` | body failed Zod validation (bad coords / date / days) |
| 401 | `not_authenticated` | missing/invalid JWT (gateway-enforced; `verify_jwt` stays default-on) |
| 405 | `method_not_allowed` | non-POST |
| 502 | `upstream_error` | Open-Meteo non-2xx or malformed response — message includes Open-Meteo's `reason` when present (e.g. date beyond the 16-day horizon) |
| 504 | `upstream_timeout` | Open-Meteo exceeded the 8s timeout |

## Upstream call

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=..&longitude=..
  &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max
  &timezone=auto
  &start_date=..&end_date=..    // end = start + days - 1, computed in UTC
```

8s timeout via `fetchWithTimeout`; no retries server-side (the client query
retries transient failures). Nothing is persisted — the only caches are the
HTTP header above and the client React Query cache.

## Attribution — REQUIRED (CC-BY 4.0)

Open-Meteo data is licensed **CC-BY 4.0**: the text
**“Weather data by Open-Meteo.com”** (ideally linking to
<https://open-meteo.com/>) must be visible wherever a forecast renders.
This is the **UI wave's responsibility** — any screen consuming
`useDayWeather` must include the attribution line.

## Secrets

None. Open-Meteo's non-commercial free tier is keyless (~10k req/day — far
above hobby scale, and the client's 1h `staleTime` + 2-decimal coordinate
rounding keep call volume minimal).

## Example calls

```bash
# Happy path
curl -s -X POST "$SUPABASE_URL/functions/v1/weather" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"lat":41.01,"lng":28.98,"startDate":"2026-06-12","days":5}'

# Too many days -> 400 invalid_input
curl -s -X POST "$SUPABASE_URL/functions/v1/weather" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"lat":41.01,"lng":28.98,"startDate":"2026-06-12","days":30}'

# Start date beyond the forecast horizon -> 502 upstream_error (with reason)
curl -s -X POST "$SUPABASE_URL/functions/v1/weather" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"lat":41.01,"lng":28.98,"startDate":"2027-01-01","days":3}'

# Health
curl -s "$SUPABASE_URL/functions/v1/weather?ping=1" -H "Authorization: Bearer $ANON_KEY"
```

## Client integration

`src/api/weather.ts` — `useDayWeather({ lat, lng, startDate, days }, enabled)`
(query key uses coords rounded to 2 decimals; `staleTime` 1h, `gcTime` 6h) and
the pure `isRainy(day)` helper (WMO rain/drizzle/snow/shower/thunderstorm codes
or `precipProbMax >= 60`).
