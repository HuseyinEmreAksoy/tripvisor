# Architecture

## Platforms & deploy

- **Native (iOS + Android)**: Expo SDK 52+ + React Native 0.76 via **EAS Build** + **EAS Update** (OTA). Requires `expo-dev-client` — **Expo Go not supported** due to `react-native-maps`.
- **Web**: `expo export --platform web` → static bundle → **Cloudflare Pages** or Vercel.
- **One codebase**: `app/` (Expo Router) + `src/` (shared). Platform-specific files use `.native.tsx` / `.web.tsx`.

## Backend

- Supabase project: Postgres + Auth + Edge Functions.
- Tables: `trips`, `trip_days`, `trip_places`, `trip_legs`. See `supabase/migrations/0001_init.sql`.
- **RLS on every table**; child tables scoped via `trips.user_id`.

### RLS special case — `trip_shares`

`trip_shares` deliberately has **no SELECT policy**. Share tokens must never be readable by any client JWT after creation; the only read path is the admin-client Edge Function (`share-trip/index.ts`). This design has two non-obvious consequences that must be preserved:

- **`INSERT ... RETURNING` under a user JWT fails with `42501`** even though the row is written. Postgres evaluates the `RETURNING` clause against SELECT policies; since none exist, it cannot read the row back. The correct pattern is `.insert(data)` without `.select()`. The `create` operation in the Edge Function uses the admin client to avoid this.
- **`UPDATE` under a user JWT silently no-ops** (row count 0, no error). The row is invisible to the caller's SELECT policy, so Postgres treats it as non-existent for the update. All production writes to `trip_shares` — create, revoke — must go through the admin client. Ownership must be proven separately via a user-JWT SELECT on `trips` before the admin client acts.

These constraints are documented via `COMMENT ON POLICY` in `supabase/migrations/0009_share_insert_policy_note.sql`.

## Third-party APIs

- **Google Maps Platform** — Places API (New), Routes API, Maps SDK (native), Maps JS (web).
- **Client-side key** (bundled): Maps SDK only. Restricted by bundle id + SHA1 (native) or HTTP referer (web).
- **Server-side key** (Supabase secret): everything else — Places HTTP, Routes HTTP. Never ships to client.

## Auth

- Supabase magic-link email auth.
- Session stored via `expo-secure-store` (native) / `localStorage` (web), both wired into `@supabase/supabase-js`.

## Data flow — adding a place

```mermaid
sequenceDiagram
  participant User
  participant App
  participant EF as Edge Function
  participant G as Google Places API
  User->>App: types in search box
  App->>EF: places-autocomplete { input, sessionToken }
  EF->>G: :autocomplete
  G-->>EF: suggestions
  EF-->>App: suggestions
  User->>App: taps suggestion
  App->>EF: place-details { placeId, sessionToken, fields }
  EF->>G: :get (X-Goog-FieldMask)
  G-->>EF: details
  EF-->>App: details
  App->>App: saves lat/lng + place_id to trip_places (Supabase)
  App->>App: holds reviews/photos only in React Query cache
```

## Data flow — optimize route

```mermaid
sequenceDiagram
  participant App
  participant EF as optimize-trip
  participant R as Routes API
  App->>EF: optimize-trip { tripId } (debounced 500ms)
  EF->>R: computeRouteMatrix (NxN, cached in trip_legs)
  EF->>EF: k-means + 2-opt (Deno)
  EF->>App: writes day_index, order_in_day on trip_places
  loop for each day
    EF->>R: computeRoutes (ordered waypoints, optimize:false)
    R-->>EF: polyline
    EF->>App: stores polyline in trip_legs
  end
  App->>App: re-renders map + itinerary
```

## Caching (Google ToS)

- **Persistable forever**: `google_place_id`, `lat`, `lng`, user-authored fields.
- **Not persisted server-side**: rating, reviews, photos, opening hours, phone, website, attributions.
- **Client cache only** (TanStack Query): `staleTime: 1h`, `gcTime: 24h`, persisted via AsyncStorage for offline view.
- **`trip_legs`**: 30-day TTL; re-fetch if `computed_at` older.

## Attribution (required)

- Place detail screens: "Powered by Google" footer whenever Place fields render.
- Each review: author name + relative time + profile photo per Google spec.
- Photos: render `attributions[]` beneath.
- Map: Google logo not obscured (native + web).

## Optimizer contract

`src/lib/optimizer/kmeans-2opt.ts` exports:

```ts
type Place = { id: string; lat: number; lng: number; visitMinutes: number };
type Leg = { fromId: string; toId: string; durationSeconds: number };
type Day = { dayIndex: number; orderedPlaceIds: string[]; totalMinutes: number };

function optimize(params: {
  places: Place[];
  legs: Leg[];                      // NxN travel matrix
  dailyBudgetMinutes: number;
  anchorPlaceId?: string;
  dayStartEnd?: Record<number, { startId?: string; endId?: string }>;
}): Day[]
```

Shared by the `optimize-trip` Edge Function. Keep it pure — no I/O.

## Environment variables

### Client (bundled, safe to expose)

```
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>
EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=<referer-restricted-web-key>
```

### Server (Supabase Edge Function secrets, never bundled)

```
GOOGLE_MAPS_SERVER_KEY=<unrestricted-server-key>
ALLOWED_ORIGINS=https://tripvisor.pages.dev,https://tripvisor.app,http://localhost:8081
```

`ALLOWED_ORIGINS` fails closed. If unset, Edge Functions accept no cross-origin browser traffic — set it explicitly for every environment.

### Google Places photos — referer restriction REQUIRED

Photo URLs are built client-side on the place-details screen using
`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` as the query param. That key **must** be
referer-restricted in Google Cloud Console (HTTPS allow-list for the
deployed web host, plus `localhost` for dev). Without the restriction the
key can be extracted from network traffic and reused to burn quota.

Native Maps SDK keys live in `app.json` under `ios.config.googleMapsApiKey` and `android.config.googleMaps.apiKey` — those are embedded in the binary and restricted by bundle id.
