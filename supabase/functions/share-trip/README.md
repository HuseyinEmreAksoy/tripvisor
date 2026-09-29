# share-trip

Create, read, and revoke read-only share links for a Tripvisor trip.

## Contract

| op       | auth                  | body                              | response                                              |
| -------- | --------------------- | --------------------------------- | ----------------------------------------------------- |
| `create` | required, **owner**   | `{ tripId }`                      | `{ token }`                                           |
| `read`   | none                  | `{ token }`                       | `{ trip, places, legs, meta: { contractVersion: 2 } }` |
| `revoke` | required, **owner**   | `{ tripId, token? }`              | `{ revoked: number }`                                 |

`GET ?ping` returns `{ ok: true, fn: "share-trip" }` for warmup/monitoring.

## Security

- Tokens are 128 random bits (`crypto.getRandomValues(16)`), base64url encoded (~22 chars).
- Only a token **prefix** (first 8 chars) is ever logged.
- `trip_shares` has **no SELECT policy** — reads only go through this function using the service-role key. This prevents token enumeration even for authenticated users.
- `create` and `revoke` are **owner-only** (security audit #5, 2026-09-29). The caller is identified with `auth.getUser(jwt)`; the trip is read under the caller's JWT (not visible → `404`) and anything other than `trips.user_id === caller` → `403 not_owner`. Accepted viewers **and editors** are refused: publishing a trip to the internet is the owner's call. (Before the fix only RLS *visibility* was checked, so any collaborator could mint or revoke the owner's links.)
- The anonymous `read` returns only the allow-listed fields in [`public-fields.ts`](./public-fields.ts); the same lists build the PostgREST `select` and re-shape the rows, so the two cannot drift:
  - `trip`: `title, start_date, end_date, daily_hours_budget, transport_mode, timezone` — **no `id`, no `user_id`**.
  - `places[]`: `id, google_place_id, user_title, category, lat, lng, visit_duration_minutes, day_index, order_in_day` — **no `notes`** (notes are private by default; day notes were never included).
  - `legs[]`: `id, from_place_id, to_place_id, day_index, transport_mode, duration_seconds, distance_meters, polyline, computed_at` (30-day TTL, below).
  - Google-ToS-restricted fields (reviews, photos, rating, website, phone, opening_hours) are not stored server-side at all.
- DB error text is logged, never echoed to anonymous callers.

## Contract versions (`read`)

| version | change |
| ------- | ------ |
| 1 (no `meta`) | original payload incl. `trip.id` and `places[].notes` |
| 2 | audit #12: `trip.id` and `places[].notes` removed; `meta.contractVersion` added |

Removing fields would normally ship as a parallel version, but v2 is a data-exposure fix — keeping v1 alive would keep the leak alive. Every shipped consumer tolerates the missing fields (`SharedTimeline` guards `place.notes`, nothing reads `trip.id`, `functions/share/[token].ts` reads only title/dates/places count). The M5 per-trip public-link toggles will re-add notes only as an explicit owner opt-in, with another version bump.

## Error codes

| code                | status | meaning                                              |
| ------------------- | ------ | ---------------------------------------------------- |
| `invalid_input`     | 400    | Malformed body / failed Zod validation               |
| `not_authenticated` | 401    | create/revoke without a valid user JWT               |
| `not_owner`         | 403    | create/revoke by a collaborator (viewer or editor)   |
| `not_found`         | 404    | Token missing/revoked; trip not visible to caller    |
| `method_not_allowed`| 405    | Non-POST to a non-ping route                         |
| `db_error`          | 500    | Supabase query failure                               |
| `internal_error`    | 500    | Unexpected exception                                 |

## Revoke semantics

`op: revoke` is **idempotent**. A `200 OK` with `{ revoked: 0 }` is a successful, non-error response that means "no active shares matched the filter" — either the trip had no open shares, the supplied `token` was already revoked, or the token never belonged to this trip. Callers (including `src/api/share.ts`) MUST treat `{ revoked: 0 }` as success and not surface it as an error to the user.

Rationale: revoke is a "make sure this share is off" operation. Replaying the same revoke request — e.g. after a flaky network or an offline queue drain — should always succeed without error, even if the share was already revoked on a prior attempt. Only network / auth / ownership / DB failures return non-2xx.

If a future caller needs strict "token not found" semantics (for example, an admin audit tool that wants to distinguish "never existed" from "already revoked"), widen the API in a follow-up by adding a new op (e.g. `op: revoke_strict`) or an opt-in response field. Do **not** change the meaning of `{ revoked: 0 }` under the current op — existing clients rely on the idempotent contract.

## 30-day leg TTL

`op: read` filters `trip_legs` by `computed_at >= now() - 30 days` (see `LEG_TTL_MS` in `index.ts`). Legs derive from the Google Routes API and are bound by Google's 30-day ToS ceiling for derived content. Stale legs are silently omitted from the read response; the client renders missing segments as degraded until the trip owner re-optimizes and refreshes the legs cache.

## Client

See `src/api/share.ts` — exposes `useCreateShareLink`, `useSharedTrip`, `useRevokeShareLink`, and `ShareLinkError` (typed `.code` for create/revoke failures).

## Tests

`deno test --allow-env --allow-net supabase/functions/share-trip/test.ts`
