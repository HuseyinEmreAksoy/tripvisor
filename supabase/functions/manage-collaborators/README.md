# manage-collaborators

Invite, accept, decline, revoke, and list trip collaborators (Phase 21 Step 21.5/21.6).

## Contract

| action     | auth     | body                                    | response                                                   |
| ---------- | -------- | --------------------------------------- | ---------------------------------------------------------- |
| `invite`   | required | `{ tripId, inviteeEmail, role? }`       | `{ ok, collaboratorId, status, role, emailSent, inviteUrl }` |
| `accept`   | required | `{ token }`                             | `{ ok, tripId, role }`                                     |
| `decline`  | required | `{ token }`                             | `{ ok, tripId }`                                           |
| `revoke`   | required | `{ collaboratorId }`                    | `{ ok, collaboratorId, status: 'revoked' }`                |
| `list`     | required | `{ tripId }`                            | `{ ok, collaborators: TripCollaborator[] }`                |

`GET ?ping` returns `{ ok: true, fn: "manage-collaborators" }` for warmup/monitoring.

## Authorization model

- **invite / revoke / list** — owner-gated. Caller must own the referenced trip; checked via a user-JWT `SELECT` on `trips`.
- **accept / decline** — invitee-gated. Caller's authenticated email MUST match `invitee_email` (case-insensitive). Email mismatch returns `email_mismatch` (403); this is the URL-stealing guard.

The function uses `makeUserClient(req)` for owner checks (so RLS proves ownership) and `makeAdminClient()` for the writes (sidesteps the INSERT-RETURNING quirk on `trip_collaborators` and keeps accept/revoke writes atomic).

## Error codes

| code               | status | meaning                                                       |
| ------------------ | ------ | ------------------------------------------------------------- |
| `invalid_input`    | 400    | Body failed Zod validation                                    |
| `method_not_allowed` | 405  | Non-POST to non-ping path                                     |
| `not_authenticated`| 401    | Missing or invalid bearer token                               |
| `not_owner`        | 403    | Caller does not own the referenced trip                       |
| `email_mismatch`   | 403    | Caller's auth email does not match invitee_email              |
| `invite_not_found` | 404    | Token / collaborator id does not match any row                |
| `already_invited`  | 409    | A row already exists for (trip_id, invitee_email)             |
| `already_accepted` | 409    | Cannot decline an already-accepted invite (owner must revoke) |
| `invite_revoked`   | 410    | Invite was revoked or declined                                |
| `invite_expired`   | 410    | Pending invite older than 7 days                              |
| `email_failed`     | 200    | Returned with `ok:true, emailSent:false` (best-effort)        |
| `db_error`         | 500    | Postgres failure                                              |
| `internal_error`   | 500    | Unexpected exception                                          |

## Email delivery (best-effort)

`invite` calls `supabase.auth.admin.inviteUserByEmail` with `redirectTo` set to the invite URL. If the invitee already has a Supabase auth account, the call may fail — we surface that as `emailSent: false` along with the inviteUrl in the response so the owner can copy / paste the link as a fallback. Email failures NEVER roll back the row.

A future iteration may add an SMTP-based custom email containing the token URL directly. For MVP, the response carries `inviteUrl` so the UI can offer "copy invite link".

## Pending invite TTL

Pending invites expire after 7 days (`INVITE_TTL_MS`). On accept, the function checks `now() - created_at > 7d`; if so, returns `invite_expired` (410). Accepted/declined/revoked rows are unaffected — the TTL only applies while a row is `pending`.

## Idempotency

- `accept` on an already-accepted row returns `{ ok: true, alreadyAccepted: true }` without rewriting.
- `decline` on an already-declined row returns `{ ok: true, alreadyDeclined: true }`.
- `revoke` on an already-revoked row returns `{ ok: true, alreadyRevoked: true }`.

## Client

See `src/api/trip-collaborators.ts` — exposes `useTripCollaborators`, `useInviteCollaborator`, `useAcceptCollaboratorInvite`, `useDeclineCollaboratorInvite`, `useRevokeCollaborator`, `useCollaboratedTrips`.

## Migrations

Depends on `0011_trip_collaborators.sql` for the `trip_collaborators` table, the `user_can_access_trip` helper, and the rewritten RLS on `trip_places` / `trip_days` / `trip_legs` / `trip_expenses` / `trips`.
