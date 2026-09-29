# share-trip

Create, read, and revoke read-only share links for a Tripvisor trip, and let the owner choose what a link shows (M5 Y2.5).

Code: `index.ts` (entry, `Deno.serve`) → `handler.ts` (contract, security, ops) · `public-fields.ts` (public allow-lists, toggles, memories filter, contract versions) · `expense-summary.ts` (public expenses summary, pure).

## Contract

| op                | auth                | body                                                   | response                                                                 |
| ----------------- | ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `create`          | required, **owner** | `{ tripId, settings? }`                                | `{ token, createdAt, settings }` (v2 clients read `token` only)          |
| `current`         | required, **owner** | `{ tripId }`                                           | `{ share: { token, createdAt, settings } \| null, meta }`                |
| `update_settings` | required, **owner** | `{ tripId, token?, settings }`                         | `{ share: { token, createdAt, settings }, updated, meta }`               |
| `read`            | none                | `{ token }`                                            | `{ trip, places, legs, sections, expenses?, memories?, meta: { contractVersion: 3 } }` |
| `revoke`          | required, **owner** | `{ tripId, token? }`                                   | `{ revoked: number }`                                                    |

`settings` = `{ showItinerary?, showExpenses?, showMemories? }` (booleans; unknown keys are a 400). Defaults for a new link: itinerary **on**, expenses **off**, memories **off** (columns from migration 0037).

- `create`: keys left out of `settings` inherit from the trip's newest active link, else the defaults. If that read fails, no link is minted (fail closed).
- `current`: the trip's newest active (not revoked) link, so the owner's share card can show it again after a reload. `null` = no active link.
- `update_settings`: at least one toggle. Applies to **every** active link of the trip (the UI treats the toggles as per trip), or only to `token` when given. No active link → `404 no_active_link`.

`GET ?ping` returns `{ ok: true, fn: "share-trip" }` for warmup/monitoring.

## Security

- Tokens are 128 random bits (`crypto.getRandomValues(16)`), base64url encoded (~22 chars). Only a token **prefix** (first 8 chars) is ever logged.
- `trip_shares` has **no SELECT policy** — reads only go through this function using the service-role key. This prevents token enumeration even for authenticated users.
- Every op except `read` is **owner-only** (security audit #5, 2026-09-29). The caller is identified with `auth.getUser(jwt)`; the trip is read under the caller's JWT (not visible → `404`) and anything other than `trips.user_id === caller` → `403 not_owner`. Accepted viewers **and editors** are refused, and they never see the live token (`current` is the one place a token is re-revealed, owner only).
- The anonymous `read` returns only the allow-listed fields in [`public-fields.ts`](./public-fields.ts); the same lists build the PostgREST `select` and re-shape the rows, so the two cannot drift:
  - `trip`: `title, start_date, end_date, daily_hours_budget, transport_mode, timezone` — **no `id`, no `user_id`**.
  - `places[]`: `id, google_place_id, user_title, category, lat, lng, visit_duration_minutes, day_index, order_in_day` — **no `notes`**. Empty when the owner hid the itinerary.
  - `legs[]`: `id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters, polyline, computed_at` (30-day TTL, below). Empty when the itinerary is hidden.
  - `sections`: `{ itinerary, expenses, memories }` — the link's toggles.
  - `expenses` (only when `show_expenses`): a **summary** — `homeCurrency`, `count`, `totals {actual, estimated}` and `byCategory[]` in the home currency, `byCurrency[]` of the original amounts, `pending {count, actualByCurrency, estimatedByCurrency}`. Conversion follows the analytics MV (0038 §1): same currency ×1 → frozen `fx_rate` if `fx_home_currency` is the current home → `fx_rates` on `fx_date` → otherwise **pending** (never converted with a wrong rate, never counted 1:1). No line items, labels, days or ids.
  - `memories` (only when `show_memories`): `journal[] {id, dayIndex, body, createdAt}`, `reviews[] {id, placeId, placeName, rating, body, createdAt}`, `photos[] {id, dayIndex, placeId, caption, takenAt, width, height, thumbUrl, url}`, `photoUrlExpiresAt`, `truncated`. **Only** rows with `visibility = 'trip' AND deleted = false` (+ `status = 'ready'` for photos): the query filters them and `isPublicMemoryRow` re-checks every row, so `only_me` items are never public. No author ids or names. A review whose place was removed shows the 0038 `place_name_snapshot`. `placeId` only points into a visible itinerary. Caps: 200 journal entries, 300 reviews, 100 photos per read.
  - Photos are served through **1 h signed URLs** of the private `trip-memories` bucket, minted here with the service role (anonymous viewers have no Storage identity; the bucket stays private). Only paths of rows that passed the public predicate are signed. A signed URL necessarily contains the object path `<trip_id>/<author_id>/<photo_id>.jpg`. On the local stack the URLs are signed on the docker-internal `http://kong:8000`; `src/api/share.ts` re-bases them onto the app's Supabase URL.
  - Google-ToS-restricted fields (reviews, photos, rating, website, phone, opening_hours) are not stored server-side at all.
- DB error text is logged, never echoed to anonymous callers. A Storage signing failure hides the photos and keeps the rest of the page.

## Contract versions (`read`)

| version | change |
| ------- | ------ |
| 1 (no `meta`) | original payload incl. `trip.id` and `places[].notes` |
| 2 | audit #12: `trip.id` and `places[].notes` removed; `meta.contractVersion` added |
| 3 | M5 Y2.5, additive: `sections`, optional `expenses` and `memories`; `places`/`legs` stay arrays (empty when the itinerary is hidden) |

v2 removed fields without a parallel version because it was a data-exposure fix. v3 only adds keys, so v2 consumers keep working (`functions/share/[token].ts` reads title/dates/places count; `SharedTimeline` reads places/legs).

## Error codes

| code                | status | meaning                                                    |
| ------------------- | ------ | ---------------------------------------------------------- |
| `invalid_input`     | 400    | Malformed body / failed Zod validation                     |
| `not_authenticated` | 401    | owner op without a valid user JWT                          |
| `not_owner`         | 403    | owner op by a collaborator (viewer or editor)              |
| `not_found`         | 404    | Token missing/revoked; trip not visible to caller          |
| `no_active_link`    | 404    | `update_settings` on a trip without an active link         |
| `method_not_allowed`| 405    | Non-POST to a non-ping route                               |
| `db_error`          | 500    | Supabase query failure                                     |
| `internal_error`    | 500    | Unexpected exception                                       |

## Revoke semantics

`op: revoke` is **idempotent**. A `200 OK` with `{ revoked: 0 }` is a successful, non-error response that means "no active shares matched the filter" — either the trip had no open shares, the supplied `token` was already revoked, or the token never belonged to this trip. Callers (including `src/api/share.ts`) MUST treat `{ revoked: 0 }` as success and not surface it as an error to the user.

Rationale: revoke is a "make sure this share is off" operation. Replaying the same revoke request — e.g. after a flaky network or an offline queue drain — should always succeed without error, even if the share was already revoked on a prior attempt. Only network / auth / ownership / DB failures return non-2xx.

If a future caller needs strict "token not found" semantics (for example, an admin audit tool that wants to distinguish "never existed" from "already revoked"), widen the API in a follow-up by adding a new op (e.g. `op: revoke_strict`) or an opt-in response field. Do **not** change the meaning of `{ revoked: 0 }` under the current op — existing clients rely on the idempotent contract.

## 30-day leg TTL

`op: read` filters `trip_legs` by `computed_at >= now() - 30 days` (see `LEG_TTL_MS` in `handler.ts`). Legs derive from the Google Routes API and are bound by Google's 30-day ToS ceiling for derived content. Stale legs are silently omitted from the read response; the client renders missing segments as degraded until the trip owner re-optimizes and refreshes the legs cache.

## Client

See `src/api/share.ts` (types in `src/api/share.types.ts`) — `useCreateShareLink`, `useRevokeShareLink`, `useCurrentShareLink`, `useTripShareSettings`, `useUpdateShareSettings`, `useSharedTrip`, `ShareLinkError` (typed `.code`), `DEFAULT_SHARE_SETTINGS`.

## Tests

`deno test --allow-env --allow-net=127.0.0.1 supabase/functions/share-trip/test.ts` (the docker form is in `docs/v2/m5-handoff.md`).
