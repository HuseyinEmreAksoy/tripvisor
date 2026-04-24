# share-trip

Create, read, and revoke read-only share links for a Tripvisor trip.

## Contract

| op       | auth     | body                              | response                  |
| -------- | -------- | --------------------------------- | ------------------------- |
| `create` | required | `{ tripId }`                      | `{ token }`               |
| `read`   | none     | `{ token }`                       | `{ trip, places, legs }`  |
| `revoke` | required | `{ tripId, token? }`              | `{ revoked: number }`     |

`GET ?ping` returns `{ ok: true, fn: "share-trip" }` for warmup/monitoring.

## Security

- Tokens are 128 random bits (`crypto.getRandomValues(16)`), base64url encoded (~22 chars).
- Only a token **prefix** (first 8 chars) is ever logged.
- `trip_shares` has **no SELECT policy** — reads only go through this function using the service-role key. This prevents token enumeration even for authenticated users.
- The `read` path never returns `user_id` and never returns Google-ToS-restricted fields (reviews, photos, rating, website, phone, opening_hours) — those are not stored server-side at all. Only ToS-safe persistable fields (`google_place_id`, `user_title`, `category`, `lat`, `lng`, `visit_duration_minutes`, `day_index`, `order_in_day`, `notes`) are returned.
- `create` and `revoke` run under the caller's JWT so RLS on `trips` enforces ownership.

## Error codes

| code                | status | meaning                                     |
| ------------------- | ------ | ------------------------------------------- |
| `invalid_input`     | 400    | Malformed body / failed Zod validation      |
| `not_found`         | 404    | Token missing/revoked; trip not owned       |
| `method_not_allowed`| 405    | Non-POST to a non-ping route                |
| `db_error`          | 500    | Supabase query failure                      |
| `internal_error`    | 500    | Unexpected exception                        |

## Revoke semantics

`op: revoke` is **idempotent**. A `200 OK` with `{ revoked: 0 }` is a successful, non-error response that means "no active shares matched the filter" — either the trip had no open shares, the supplied `token` was already revoked, or the token never belonged to this trip. Callers (including `src/api/share.ts`) MUST treat `{ revoked: 0 }` as success and not surface it as an error to the user.

Rationale: revoke is a "make sure this share is off" operation. Replaying the same revoke request — e.g. after a flaky network or an offline queue drain — should always succeed without error, even if the share was already revoked on a prior attempt. Only network / auth / DB failures return non-2xx.

If a future caller needs strict "token not found" semantics (for example, an admin audit tool that wants to distinguish "never existed" from "already revoked"), widen the API in a follow-up by adding a new op (e.g. `op: revoke_strict`) or an opt-in response field. Do **not** change the meaning of `{ revoked: 0 }` under the current op — existing clients rely on the idempotent contract.

## 30-day leg TTL

`op: read` filters `trip_legs` by `computed_at >= now() - 30 days` (see `LEG_TTL_MS` in `index.ts`). Legs derive from the Google Routes API and are bound by Google's 30-day ToS ceiling for derived content. Stale legs are silently omitted from the read response; the client renders missing segments as degraded until the trip owner re-optimizes and refreshes the legs cache.

## Client

See `src/api/share.ts` — exposes `useCreateShareLink`, `useSharedTrip`, `useRevokeShareLink`.
