# Architecture

## Platforms & deploy

- **Native (iOS + Android)**: Expo SDK 52+ + React Native 0.76 via **EAS Build** + **EAS Update** (OTA). Requires `expo-dev-client` — **Expo Go not supported** due to `react-native-maps`.
- **Web**: `expo export --platform web` → static bundle → **Cloudflare Pages** or Vercel.
- **One codebase**: `app/` (Expo Router) + `src/` (shared). Platform-specific files use `.native.tsx` / `.web.tsx`.

## Backend

- Supabase project: Postgres + Auth + Edge Functions.
- Tables: `trips`, `trip_days`, `trip_places`, `trip_legs`, `trip_expenses`, `trip_collaborators`, `trip_accommodations`. See `supabase/migrations/`.
- **RLS on every table**; child tables scoped via `user_can_access_trip()` helper (Phase 21) — previously scoped directly via `trips.user_id`.

## Data model additions (Phase 24)

### `trip_place_reactions` table (migration `0017_trip_place_reactions.sql`)

Stores each collaborator's thumbs-up / thumbs-down opinion on a `trip_places` row. One row per `(trip_place_id, user_id)` pair — collaborators each have their own row, enabling per-user reaction history and future cross-collaborator views.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_place_id` | `uuid fk trip_places` | cascade on delete |
| `user_id` | `uuid fk auth.users` | cascade on delete |
| `reaction` | `text` | CHECK IN (`liked`, `disliked`) |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | maintained by `set_updated_at` trigger (reused from migration 0001) |

**Unique constraint**: `(trip_place_id, user_id)` — a user has at most one active reaction per place.

**Indexes**: `(trip_place_id)` to speed up per-place lookups.

**RLS policies**:
- **SELECT**: `user_can_access_trip(trip_places.trip_id, auth.uid(), 'viewer')` via a JOIN through `trip_places`. Any viewer-or-better collaborator sees all reactions on places within that trip (including other collaborators' reactions).
- **INSERT / UPDATE / DELETE**: `user_id = auth.uid()` AND the user can access the parent trip at viewer level. Users can only write their own reaction rows.

**Multi-user opinion model**: Unlike a `trip_places.my_reaction` column approach, the dedicated table supports collaborator-aware reactions out of the box. Each collaborator's reaction is independent. Deleting a reaction is modeled as `DELETE` (not a null update), surfaced client-side by passing `reaction: null` to `useSetTripPlaceReaction` which triggers the DELETE path.

**Client API** (`src/api/trip-place-reactions.ts`):
- `TripPlaceReaction` type + `TripPlaceReactionType = 'liked' | 'disliked'` union.
- `useTripPlaceReaction(tripPlaceId, userId)` — single-row query for one user's reaction on one place.
- `useTripReactions(tripId)` — all reactions for all places in a trip (used for Settings tab catalogs).
- `useAllUserReactions()` — all reactions for the current user across all trips (used by analytics aggregation).
- `useSetTripPlaceReaction()` — upsert mutation via `onConflict: 'trip_place_id,user_id'`; `null` reaction triggers DELETE; optimistic update + rollback on error.
- Query keys in `src/api/_keys.ts` as `tripPlaceReactionsKeys` factory (`all`, `forTripPlace(id)`, `forTrip(id)`, `mine()`).

### `src/api/trip-expenses.ts` — `useAllUserExpenses()` (Phase 24 addition)

New hook added alongside the existing trip-expenses API: `useAllUserExpenses()` runs a single SELECT against `trip_expenses` (RLS-scoped to `auth.uid()` via the parent `trips.user_id`) and returns all expense rows across all trips. Used by the analytics screen for cross-trip spend aggregations.

## Data model additions (Phase 23)

### `trips.route_render_mode`

New column `route_render_mode text NOT NULL DEFAULT 'optimized' CHECK (route_render_mode IN ('optimized', 'manual'))` added in migration `0016_trips_route_render_mode.sql`. Controls whether the map polylines are drawn from the optimizer's output ('optimized') or from the user's manual `order_in_day` ('manual'). Editor collaborators are allowed to change this column (in addition to `total_budget`) per the `enforce_trips_column_restrictions` trigger — see "Editor-budget RLS" below.

### `trips.transport_mode` widened

The `transport_mode` CHECK constraint in migration `0016_trips_route_render_mode.sql` now includes `'bicycling'` alongside the existing `'driving'`, `'walking'`, and `'transit'` values. The `TransportMode` type in `src/api/types.ts` reflects: `'driving' | 'walking' | 'transit' | 'bicycling'`.

## Data model additions (Phase 20)

### `trips.total_budget`

New nullable column `total_budget numeric` added in migration `0010_trip_budget_categories.sql`. Represents the user's overall financial budget for the trip (not per-km). No unit enforcement — currency is inherited from `trips.currency`. The existing `cost_per_km` column is retained for backwards compatibility but deprecated via `COMMENT ON COLUMN`.

### `trip_expenses` table

Tracks categorized estimated and actual expenses for a trip.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | default `gen_random_uuid()` |
| `trip_id` | `uuid fk trips` | cascade on delete |
| `category` | `text` | CHECK IN (`accommodation`, `food`, `transport`, `shopping`, `activities`, `other`) |
| `kind` | `text` | CHECK IN (`estimated`, `actual`) |
| `amount` | `numeric` | CHECK `amount >= 0` |
| `label` | `text null` | optional user description |
| `day_index` | `int null` | links to a specific trip day; null means trip-level |
| `created_at` | `timestamptz` | default `now()` |

**RLS**: four policies (select / insert / update / delete) all scoped via `trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())`.

**Client API** (`src/api/trip-expenses.ts`): Zod schema + types; `useTripExpenses(tripId)`, `useCreateTripExpense()`, `useUpdateTripExpense()`, `useDeleteTripExpense()`, `useTripExpenseRollup(tripId)` (derived — no extra network request; returns `{ byCategory, totalEstimated, totalActual, budget, remaining, hasBudget }`). `useUpdateTripBudget(tripId)` in `src/api/trips.ts`. Query keys live in the shared `src/api/_keys.ts` leaf module.

**UI**: shipped Phase 21 — `BudgetCard`, `BudgetEditSheet`, `CategoryBreakdown`, `ExpenseList`, `ExpenseEditSheet` in `src/components/budget/`. Integrated into trip detail Settings tab. Role-gated via `canEditTrip` from `useTripRole`.

## Data model additions (Phase 21)

### SQL helper — `public.user_can_access_trip(p_trip_id uuid, p_user_id uuid, p_min_role text)`

`language sql stable security definer`. Returns `true` if the caller owns the trip (`trips.user_id = p_user_id`) OR has an `accepted` collaborator row on the trip with a role that satisfies `p_min_role` (editor satisfies viewer; viewer does not satisfy editor). Used in every RLS policy on trip-child tables so policies stay DRY and performant.

`security definer` is required because `authenticated` lacks SELECT on `auth.users` directly. The function is `stable` (no writes, same result within a transaction) to allow Postgres to cache calls within a statement.

### SQL helper — `public.current_user_email()`

`language sql stable security definer`. Returns the email of the currently authenticated user from `auth.users`. Required because `authenticated` role lacks direct SELECT on `auth.users`.

### RLS policy pattern (Phase 21)

All trip-child tables (`trip_days`, `trip_places`, `trip_legs`, `trip_expenses`) use:

- **SELECT**: `user_can_access_trip(trip_id, auth.uid(), 'viewer')`
- **INSERT / UPDATE / DELETE**: `user_can_access_trip(trip_id, auth.uid(), 'editor')`

`trips` table retains owner-only INSERT/UPDATE/DELETE. `trip_collaborators` SELECT is limited to: owner sees all rows for their trips; collaborator sees only their own row.

### `trip_collaborators` table (migration `0011_trip_collaborators.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_id` | `uuid fk trips` | cascade on delete |
| `invitee_email` | `text not null` | email invite was sent to |
| `user_id` | `uuid null fk auth.users` | null until invitee accepts |
| `role` | `text` | CHECK IN (`viewer`, `editor`) |
| `status` | `text` | CHECK IN (`pending`, `accepted`, `declined`, `revoked`) |
| `invite_token` | `text unique` | base64url 32-byte token; generated by `set_invite_token` trigger if not supplied |
| `created_at` | `timestamptz` | `now()` |
| `accepted_at` | `timestamptz null` | set when status flips to `accepted` |
| `revoked_at` | `timestamptz null` | set when status flips to `revoked` |

**Indexes**: `(invitee_email)`, `(trip_id, invitee_email) UNIQUE`, `(user_id, status) WHERE user_id IS NOT NULL`.

**Triggers**: `set_invite_token` (BEFORE INSERT — generates token if not provided), `set_timestamps` (BEFORE UPDATE — maintains `accepted_at` / `revoked_at`).

**RLS**: SELECT — owner sees all rows on their trips; collaborator sees own row only. INSERT/UPDATE/DELETE owner-only (collaborator uses the `manage-collaborators` Edge Function to accept/decline via service-role path).

### `trip_accommodations` table (migrations `0012_trip_accommodations.sql` + `0013_trip_accommodations_rls_collab.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_id` | `uuid fk trips` | cascade on delete |
| `name` | `text not null` | hotel / property name |
| `google_place_id` | `text null` | optional Google place anchor |
| `address` | `text null` | free-text fallback or resolved address |
| `lat` | `numeric null` | required when `google_place_id` is not null |
| `lng` | `numeric null` | required when `google_place_id` is not null |
| `check_in_date` | `date not null` | |
| `check_out_date` | `date not null` | CHECK `check_out_date > check_in_date` |
| `notes` | `text null` | free text |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | maintained by `set_updated_at` trigger |

**CHECK constraints**: `check_out_date > check_in_date`; `(google_place_id IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL)`.

**Index**: `(trip_id, check_in_date)`.

**RLS** (after migration 0013): SELECT delegates to `user_can_access_trip(..., 'viewer')`; INSERT/UPDATE/DELETE delegates to `user_can_access_trip(..., 'editor')`.

**Client API** (`src/api/trip-accommodations.ts`): Zod schema + types; `useTripAccommodations(tripId)`, `useCreateTripAccommodation()`, `useUpdateTripAccommodation()`, `useDeleteTripAccommodation()`. All mutations use optimistic updates with rollback. Query keys in `src/api/_keys.ts` (`tripAccommodationsKeys`).

### RLS special case — `trip_shares`

`trip_shares` deliberately has **no SELECT policy**. Share tokens must never be readable by any client JWT after creation; the only read path is the admin-client Edge Function (`share-trip/index.ts`). This design has two non-obvious consequences that must be preserved:

- **`INSERT ... RETURNING` under a user JWT fails with `42501`** even though the row is written. Postgres evaluates the `RETURNING` clause against SELECT policies; since none exist, it cannot read the row back. The correct pattern is `.insert(data)` without `.select()`. The `create` operation in the Edge Function uses the admin client to avoid this.
- **`UPDATE` under a user JWT silently no-ops** (row count 0, no error). The row is invisible to the caller's SELECT policy, so Postgres treats it as non-existent for the update. All production writes to `trip_shares` — create, revoke — must go through the admin client. Ownership must be proven separately via a user-JWT SELECT on `trips` before the admin client acts.

These constraints are documented via `COMMENT ON POLICY` in `supabase/migrations/0009_share_insert_policy_note.sql`.

## Collaboration model (Phase 21)

### Role taxonomy

| Role | Can read trip + child tables | Can write child tables | Can write `trips` row | Can manage collaborators |
|---|---|---|---|---|
| `owner` | yes | yes | yes (all columns) | yes |
| `editor` | yes | yes | `total_budget` and `route_render_mode` only | no |
| `viewer` | yes | no | no | no |
| none | no | no | no | no |

"Write child tables" covers `trip_places`, `trip_days`, `trip_legs`, `trip_expenses`, `trip_accommodations` INSERT/UPDATE/DELETE. `trips` UPDATE is owner-only except for `total_budget` and `route_render_mode` — see "Editor-budget RLS" below.

### Editor-budget RLS (Phase 22 + Phase 23 update)

Migration `0015_trips_editor_budget_rls.sql` (note: originally planned as `0014` but that slot was already taken) adds:

- **Policy `trips_editor_budget_update`**: permissive UPDATE policy on `trips` scoped to non-owner editors via `user_can_access_trip(id, auth.uid(), 'editor')`.
- **Trigger `enforce_trips_column_restrictions`** (BEFORE UPDATE on `trips`, `security definer`): if `auth.uid() = OLD.user_id` (owner), returns NEW unmodified. Otherwise raises `42501 insufficient_privilege` if any column other than the allowed-diff list differs between OLD and NEW.

**Phase 23 update** (`0016_trips_route_render_mode.sql`): `route_render_mode` was added to the trigger's editor-allowed-diff list alongside `total_budget` and `updated_at`. The `useUpdateRouteRenderMode` client hook omits the owner-only `user_id` filter so editors can call it directly.

**Maintenance contract**: any new column added to `trips` in a future migration MUST be evaluated and either added to the trigger's allowed-diff list or left out (the default is denied for non-owners). The trigger header comment records this contract. The current editor-allowed columns are: `total_budget`, `route_render_mode`, `updated_at`.

### Invite-accept flow

1. Owner enters an invitee email on the `collaborators` screen (`app/(app)/trip/[id]/collaborators.tsx`).
2. Client calls `manage-collaborators` Edge Function with action `invite`. The function inserts a `trip_collaborators` row (`status = pending`) and sends an email with a tokenized link (`/invite/[token]`).
3. Invitee follows the link, lands on `app/invite/[token].tsx`. If unauthenticated, they are redirected to `/login?redirect=/invite/[token]`.
4. After sign-in, the page shows the trip name and role. Invitee presses **Accept** or **Decline** — explicit action required (auto-bind on click is rejected).
5. On Accept: `manage-collaborators` `accept` action binds `user_id = auth.uid()` and flips `status = accepted`. RLS grants the collaborator access immediately.
6. On Decline: status flips to `declined`; no access granted.
7. Owner can revoke at any time via the `revoke` action; status flips to `revoked`; RLS denies access immediately.

### `manage-collaborators` Edge Function — action contract

`supabase/functions/manage-collaborators/index.ts`. All requests are POST with `{ action, ...payload }`.

| Action | Caller | Payload | Success response |
|---|---|---|---|
| `invite` | owner | `{ tripId, inviteeEmail, role }` | `{ ok: true, emailSent: boolean, error_code?: 'email_failed' }` |
| `accept` | invitee | `{ token }` | `{ ok: true }` |
| `decline` | invitee | `{ token }` | `{ ok: true }` |
| `revoke` | owner | `{ collaboratorId }` | `{ ok: true }` |
| `list` | owner | `{ tripId }` | `{ collaborators: TripCollaborator[] }` |
| `update` | owner | `{ collaboratorId, role }` | `{ ok: true }` |

`update` (added Phase 22): owner-only; `role` must be `'viewer'` or `'editor'` (Zod enum — `'owner'` is rejected). Idempotent.
Error codes: `email_mismatch` (403), `invite_expired` (410 — 7-day TTL), `invite_not_found` (404), `already_accepted` (409), `invite_revoked` (410), `forbidden` (403 — non-owner attempted owner action), `invalid_input` (400), `not_authenticated` (401), `not_owner` (403 — specifically for `update` action), `collaborator_not_found` (404 — for `update` action). Email send is best-effort: failure returns `{ ok: true, emailSent: false, error_code: 'email_failed' }`.

### Client API — `src/api/trip-collaborators.ts`

Zod schema + `TripCollaborator`, `Role`, `Status` types. `CollaboratorError extends EdgeFunctionError`. Hooks:

- `useTripCollaborators(tripId)` — lists collaborators (owner only)
- `useCollaboratedTrips()` — **DEPRECATED** (Phase 22). Use `useTrips()` and filter by `isOwner === false`. Implementation retained until all call sites are migrated (Phase 23+ cleanup).
- `useInviteCollaborator()` — mutation: invite by email
- `useAcceptCollaboratorInvite(token?)` — mutation: accept via token; invalidates `tripsKeys.all` on success
- `useDeclineCollaboratorInvite(token?)` — mutation: decline via token; invalidates `tripsKeys.all` on success
- `useRevokeCollaborator()` — mutation: revoke by collaborator id; invalidates `tripsKeys.all` on success
- `useUpdateCollaborator()` — (added Phase 22) mutation: `{ collaboratorId, tripId, role }`; owner-only; optimistic update + rollback; invalidates `tripCollaboratorsKeys.forTrip(tripId)` on success

### Client API additions (Phase 23)

**`src/api/routes.ts`**:
- `useOptimizeTrip()` mutation now accepts optional `mode?: 'optimized' | 'manual'`. When `mode: 'manual'`, the Edge Function skips k-means + 2-opt and recomputes `trip_legs` from existing `(day_index, order_in_day)`.

**`src/api/trips.ts`**:
- `useUpdateRouteRenderMode(tripId)` — new mutation that updates `trips.route_render_mode`. Deliberately omits the owner-only `user_id` filter so editor collaborators can call it. Optimistically updates the TanStack Query cache and synchronously triggers `useOptimizeTrip({ tripId, mode })` for instant polyline refresh.

**`src/api/types.ts`**:
- `RouteRenderMode = 'optimized' | 'manual'` — new union type.
- `Trip.route_render_mode: RouteRenderMode` — non-optional, returned by all trip queries.
- `UpdateTripPatch.route_render_mode` — available in the trip update payload.
- `TransportMode` widened: `'driving' | 'walking' | 'transit' | 'bicycling'`.

### Client API — `src/api/trips.ts` — `useTrips()` (Phase 22 rewrite)

`useTrips()` now returns a UNION of owned trips and accepted-collaborator trips by relying on the `trips_collab_select` RLS policy (which already covers both sets). A secondary lightweight query against `trip_collaborators` (filtered by `user_id = auth.uid()` + `status = 'accepted'`) is joined client-side to tag each row with `{ isOwner: boolean, collaboratorRole: 'viewer' | 'editor' | null }`. These are derived fields — not stored in the `trips` table. The `Trip` type in `src/api/types.ts` has been extended with optional `isOwner?: boolean` and `collaboratorRole?: TripCollaboratorRole | null`. Sort order: owners first by `created_at desc`, then collaborators by `created_at desc`, with `id.localeCompare` as a stable tiebreaker for React Native list keys.

### `useTripRole` hook — `src/hooks/useTripRole.ts`

Returns `{ role: 'owner' | 'editor' | 'viewer' | null, canEditTrip: boolean, isOwner: boolean }`. Owner check is local (no network — compares `trips.user_id` to `auth.uid()`). Collaborator role is read via `useTripCollaborators` filtered to the current user's accepted row.

## Duration formatting (Phase 23)

`src/lib/formatDuration.ts` exports:
- `formatDuration(minutes: number): string` — converts minutes to a human-readable string (e.g. `"1h 20m"`, `"45m"`).
- `formatDurationSeconds(seconds: number): string` — same output from a seconds input.

Used in `DaySummaryCard`, `PlaceRow`, and `TripCostRollup` to display visit and travel durations in a mode-agnostic format (avoids "Drive Xm" terminology; uses "Travel Xm" instead).

## Currency formatting

`src/lib/formatCurrency.ts` exports `formatCurrency(amount: number, currency?: string | null): string`. Uses `Intl.NumberFormat` with `style: 'currency'` — fully locale-agnostic; supports any IETF currency code. Falls back to `${CUR} ${amount.toFixed(2)}` for invalid or unrecognized codes; defaults to `'USD'` when `currency` is null or undefined.

All five budget components (`BudgetCard`, `BudgetEditSheet`, `CategoryBreakdown`, `ExpenseList`, `ExpenseEditSheet`) accept a `currency?: string | null` prop and call `formatCurrency()`. Amount input fields display the currency code/symbol as a read-only prefix label; the input value remains a plain number. `trip.currency` is threaded down from the SettingsTab in `app/(app)/trip/[id]/index.tsx`.

## Edge Function error envelopes

All Edge Functions return errors in the shape `{ error: { code: string, message: string } }` with an appropriate HTTP status.

### `EdgeFunctionError` hierarchy (Phase 20)

`src/api/_errors.ts` defines a shared base class:

```ts
class EdgeFunctionError extends Error {
  constructor(public code: string, public message: string, public status: number) { ... }
}
```

Concrete subclasses:

- **`OptimizeError`** (`src/api/routes.ts`) — extends `EdgeFunctionError`; known codes: `already_optimizing`, `too_many_places`, `matrix_failed`, `not_found`, `rpc_failed`, `db_error`, `invalid_input`, `method_not_allowed`.
- **`PlacesError`** (`src/api/places.ts`) — extends `EdgeFunctionError`; includes the special code `server_misconfigured` returned when `GOOGLE_MAPS_SERVER_KEY` is absent from Edge Function secrets.
- **`CollaboratorError`** (`src/api/trip-collaborators.ts`) — extends `EdgeFunctionError`; known codes: `email_mismatch`, `invite_expired`, `invite_not_found`, `already_accepted`, `invite_revoked`, `forbidden`, `email_failed`.

### `server_misconfigured` envelope

When `GOOGLE_MAPS_SERVER_KEY` is not set, the Edge Functions `places-autocomplete`, `place-details`, `distance-matrix`, and `directions-polyline` all return:

```json
{ "error": { "code": "server_misconfigured", "message": "Google Maps server key is not configured. See docs/google-maps-setup.md." } }
```

The client (`src/api/places.ts`) parses this into a `PlacesError` instance. `app/(app)/trip/[id]/add.tsx` renders a setup banner when this code is detected.

## Web layout breakpoints (Phase 20)

`src/hooks/useBreakpoint.ts` returns the current breakpoint based on window width:

| Name | Threshold | Screens using it |
|---|---|---|
| `mobile` | < 768 px | default (single-column) |
| `tablet` | 768–1023 px | tablet-optimised spacing |
| `desktop` | ≥ 1024 px | two-column auth; 2-col trips grid; trip detail 60/40 split |
| `desktopWide` | ≥ 1440 px | trips list 3-col grid |

Screens with desktop-specific layouts:
- `app/(auth)/login.tsx` + `app/(auth)/signup.tsx` — two-column (imagery left, form right) at ≥1024 px.
- `app/(app)/trips.tsx` — 2-col grid at ≥1024 px; 3-col at ≥1440 px.
- `app/(app)/trip/[id]/index.tsx` — side-by-side map + itinerary (~60/40) at ≥1024 px; collapses to two tabs on mobile.
- `app/(app)/trip/[id]/add.tsx` — 720 px max-width centered on desktop.

## Third-party APIs

- **Google Maps Platform** — Places API (New), Routes API, Maps SDK (native), Maps JS (web).
- **Client-side key** (bundled): Maps SDK only. Restricted by bundle id + SHA1 (native) or HTTP referer (web).
- **Server-side key** (Supabase secret): everything else — Places HTTP, Routes HTTP. Never ships to client.

For the full two-key setup guide (Cloud Console steps, where each key lives, verification curl commands, and free-tier guidance) see `docs/google-maps-setup.md`. The project deliberately separates the server key (API-restricted to Places + Routes, no referrer restriction) from the web JS key (restricted to Maps JavaScript API + HTTP referrer) so each leaked key has bounded blast radius.

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
  App->>EF: optimize-trip { tripId, mode? } (debounced 500ms)
  alt mode === 'optimized' (default)
    EF->>R: computeRouteMatrix (NxN, cached in trip_legs)
    EF->>EF: k-means + 2-opt (Deno)
    EF->>App: writes day_index, order_in_day on trip_places
  else mode === 'manual'
    EF->>EF: reads existing (day_index, order_in_day) — no optimizer
  end
  loop for each day
    EF->>R: computeRoutes (ordered waypoints, optimize:false)
    R-->>EF: polyline (null for transit mode)
    EF->>App: stores polyline in trip_legs
  end
  App->>App: re-renders map + itinerary
```

### Edge Function updates (Phase 23)

**`optimize-trip`**: accepts `{ tripId, mode?: 'optimized' | 'manual' }`. Manual branch skips clustering/2-opt and recomputes `trip_legs` from existing `(day_index, order_in_day)`. Row-mutex preserved in both modes. Both modes pass `trip.transport_mode` to downstream functions.

**`directions-polyline`**: when `mode === 'transit'`, returns `polyline: null` (still returns `duration_seconds` + `distance_meters` from Routes API transit response). Other modes unchanged. Bicycling is now mapped to the `BICYCLE` Routes API travel mode enum.

**`directions-polyline` (Phase 24 note)**: the function was confirmed in Phase 24 to accept raw `{ origin: {lat, lng}, destination: {lat, lng}, intermediates?: [{lat, lng}], mode }` — no `placeId` required for origin or destination. No contract change was made; this is documented because the use-my-location virtual leg relies on this raw-coordinate path to compute a polyline from the user's GPS fix to the first place in a day.

**`distance-matrix`**: bicycling enum (`BICYCLE`) added alongside `DRIVE`, `WALK`, `TRANSIT`.

## Transit rendering

Phase 23 introduces a v1 transit rendering contract:

- `directions-polyline` returns `polyline: null` for transit legs. The DB row stores `duration_seconds` / `distance_meters` from the Routes API transit estimate (which is realistic), but the polyline field is null.
- The client synthesizes dashed straight-line polylines for transit by reading the ordered `trip_places` for each day and building `[fromLatLng, toLatLng]` point pairs directly — no polyline decode needed.
- `Map.web.tsx` renders dashed lines via the Google Maps JS `icons` array (dot pattern, `repeat: '20px'`). `Map.native.tsx` uses `lineDashPattern={[6,6]}` on the `react-native-maps` Polyline.
- `MapPolyline` type in `src/components/Map/types.ts` has optional `isDashed: boolean`, `from: LatLng`, `to: LatLng` fields.
- Each per-place itinerary connector in transit mode includes a "Plan transit on Google Maps" deep link: `https://www.google.com/maps/dir/?api=1&origin={lat},{lng}&destination={lat},{lng}&travelmode=transit` opened via `expo-linking`.
- Full transit polyline rendering (multi-leg step list, vehicle icons, transfer points) is explicitly deferred to a later phase.

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

## Analytics (Phase 24)

### Screen

`app/(app)/analytics.tsx` — a top-level screen reachable from the trips list header ("Insights" button). Uses `useBreakpoint` for desktop-aware layout (single-column on mobile/tablet, two-column chart grid at >= 1024 px).

### Charts (four sections)

1. **Spending per trip** (bar chart) — X = trip title (truncated), Y = sum of `kind='actual'` expenses per trip. Uses `useAllUserExpenses()` fan-out.
2. **Spending by category** (donut / pie chart) — all trips summed by `category` enum. Six slices: accommodation, food, transport, shopping, activities, other.
3. **Liked vs. disliked per trip** (grouped bar) — X = trip title, two series (liked count, disliked count); only trips where the user has >= 1 reaction.
4. **Spending over time** (line chart) — X = `trip.start_date`, Y = total actual spend; only rendered when >= 3 trips have a `start_date` set. Hidden with an explanatory placeholder otherwise.

Below the charts: two textual catalogs — "Most liked places overall" (top 5) and "Places you didn't like overall" (top 5), using `useAllUserReactions()`.

### Chart implementation

Charts are hand-rolled SVG using `react-native-svg` (already in the dependency tree via `react-native-maps`). `victory-native@41` was evaluated and rejected at install time: it requires `@shopify/react-native-skia >= 1.2.3`, which in turn requires React 19; the project is on React 18. The three chart components live at:
- `src/components/charts/BarChart.tsx`
- `src/components/charts/PieChart.tsx`
- `src/components/charts/LineChart.tsx`

If the project upgrades to React 19 in a future phase, these can be replaced by `victory-native` with no data-model change.

### ToS note

Analytics aggregates only user-authored data (expense amounts, reaction values). No Google Place fields (rating, reviews, photos, opening hours) are fetched or persisted by the analytics screen. "Powered by Google" attribution is not required on this screen.

## Location services (Phase 24)

### `src/hooks/useCurrentLocation.ts`

Cross-platform hook that exposes a lazy geolocation fetch. Does NOT auto-request on mount — the consumer must call `request()` explicitly.

**Status machine**: `idle -> requesting -> granted | denied | unavailable`

**Web branch**: `navigator.geolocation.getCurrentPosition` with a 10 s timeout.

**Native branch**: `expo-location` via `require()` inside a `try/catch`. On success: `Location.requestForegroundPermissionsAsync()` then `Location.getCurrentPositionAsync({ accuracy: Balanced })`. The `require()` is lazy and wrapped in try/catch so the hook remains importable on web without the native module.

Returns `{ status, position: { lat, lng } | null, request: () => Promise<void>, error: string | null }`.

Coordinates are **never persisted** — not to the DB, not to AsyncStorage. The hook caches the most recent fix in module-level memory for the session so toggling the use-my-location switch off then back on within the session reuses the cached fix without re-requesting permission.

### `src/hooks/useTripUseMyLocation.ts`

Per-trip AsyncStorage-backed boolean toggle. AsyncStorage key: `tripvisor:useMyLocation:<tripId>`. Returns `{ enabled, setEnabled }`. Hydrates async; emits `false` until hydrated to prevent flicker. Orphan keys (from deleted trips) are harmless and ignored.

### Virtual leg semantics

When the "Start route from my location" toggle is ON in MapTab:
- `useCurrentLocation().request()` is called if status is `idle`.
- On `granted`, a synthetic `MapPolyline` is computed by calling the `directions-polyline` Edge Function with `origin = { lat, lng }` (the user's GPS fix) and `destination` = the first place of the active day.
- The result is a geodesic straight-line leg (or routed polyline if the Edge Function returns one). It is rendered with the same day-color as live legs.
- This leg is **never written to `trip_legs`** or any other DB table.
- On permission `denied` or `unavailable`: inline error copy is shown; toggle reverts to OFF.

**Privacy note**: the user's lat/lng leaves the device in a call to the `directions-polyline` Edge Function (proxied through Supabase Edge Function, never sent to Google directly from the client). This is documented in `docs/features/location-routing.md`.

### Android / iOS permissions (`app.json`)

- Android: `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` added to `expo.android.permissions`.
- iOS: `NSLocationWhenInUseUsageDescription` widened to "Tripvisor uses your location to suggest nearby places and to start trip routes from where you are."

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
