# delete-account

Irreversibly deletes the caller's `auth.users` row and every `public.trips` row
they own (cascade FKs clean `trip_places`, `trip_legs`, `trip_days`,
`trip_shares`). Used by the Settings screen's "Delete account" flow.

## Contract

| method      | auth     | body | response                              |
| ----------- | -------- | ---- | ------------------------------------- |
| `POST`      | required | none | `{ ok: true }`                        |
| `GET ?ping` | none     | none | `{ ok: true, fn: "delete-account" }`  |

## Order

1. Verify the bearer JWT via the anon client's `auth.getUser(token)`. Reject
   `401` if the JWT is missing or invalid.
2. `serviceClient.auth.admin.deleteUser(user.id)` — auth row first. If this
   fails the user keeps both the auth row and the trip data and can retry.
3. `serviceClient.from('trips').delete().eq('user_id', user.id)` — cascade
   FKs handle every child table. If this fails, the auth row is already
   gone; the orphaned `public.*` data is unreachable via RLS but logged for
   operator cleanup.

This is intentionally **not** the `delete_account_cascade()` RPC: that RPC
reads `auth.uid()` from the JWT context, which is gone after auth-delete.
The service-role direct delete is safe because we already verified the JWT.

## Error codes

| code                  | status | meaning                                           |
| --------------------- | ------ | ------------------------------------------------- |
| `not_authorized`      | 401    | Missing or invalid bearer JWT                     |
| `method_not_allowed`  | 405    | Non-POST to a non-ping route                      |
| `admin_error`         | 500    | `auth.admin.deleteUser` failed (user keeps data)  |
| `db_error`            | 500    | Auth row deleted but `trips` cleanup failed       |

## Example

```bash
curl -X POST "$SUPABASE_URL/functions/v1/delete-account" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json"
```

```bash
curl "$SUPABASE_URL/functions/v1/delete-account?ping"
# {"ok":true,"fn":"delete-account"}
```

## Required secrets

| name                        | scope            |
| --------------------------- | ---------------- |
| `SUPABASE_URL`              | Edge env (auto)  |
| `SUPABASE_ANON_KEY`         | Edge env (auto)  |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge secret      |
| `ALLOWED_ORIGINS`           | Edge secret      |
