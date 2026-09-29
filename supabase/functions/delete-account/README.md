# delete-account

Irreversibly deletes the caller's `auth.users` row, every `public.trips` row
they own (cascade FKs clean `trip_places`, `trip_legs`, `trip_days`,
`trip_shares`, `trip_documents`, the M5 memory tables, ...), their own memory
rows on other people's trips (cascade via `author_id`), and the Storage
objects of all of that. Used by the Settings screen's "Delete account" flow.

## Contract

| method      | auth     | body | response                              |
| ----------- | -------- | ---- | ------------------------------------- |
| `POST`      | required | none | `{ ok: true }`                        |
| `GET ?ping` | none     | none | `{ ok: true, fn: "delete-account" }`  |

## Order

1. Verify the bearer JWT via the anon client's `auth.getUser(token)`. Reject
   `401` if the JWT is missing or invalid.
2. Before anything is destroyed, read (service role, filtered by the verified
   user id):
   - the ids of every trip the caller **owns** (`trips.user_id`);
   - (M5) the ids of trips where the caller may have photos without owning
     them: `trip_photos.author_id` rows and every `trip_collaborators` row
     bound to the caller (any status).
   Any read failure → `500 db_error`, nothing destroyed, retryable.
3. `serviceClient.auth.admin.deleteUser(user.id)` — if this fails the user
   keeps both the auth row and the trip data and can retry.
4. `serviceClient.from('trips').delete().eq('user_id', user.id)` — normally a
   no-op sweep (step 3 cascaded). On failure the orphaned `public.*` data is
   unreachable via RLS but logged for operator cleanup (`500 db_error`).
5. Best-effort Storage cleanup (`storage-cleanup.ts`), recursive and
   paginated, batch-removed:
   - owned trips: everything under `<tripId>/` in every
     `TRIP_PREFIXED_BUCKETS` bucket (`trip-docs`, `trip-memories`);
   - other trips: only `<tripId>/<userId>/` in `AUTHOR_PREFIXED_BUCKETS`
     (`trip-memories`), never another member's folder.
   Runs after the auth delete so a failed step 3 never leaves a live account
   with missing bytes. Failures are logged (`stage: "storage_cleanup"`,
   `level: "error"`, counts + first errors + prefixes) and do **not** change
   the `{ ok: true }` response. A bucket that doesn't exist yet counts as empty.

Buckets: `trip-docs` (0024) and `trip-memories` (0036). Cover photos are a
Google place-id pointer (0018), not Storage objects; there are no avatars.

This is intentionally **not** the `delete_account_cascade()` RPC: that RPC
reads `auth.uid()` from the JWT context, which is gone after auth-delete.
The service-role direct delete is safe because we already verified the JWT.

## Error codes

| code                  | status | meaning                                           |
| --------------------- | ------ | ------------------------------------------------- |
| `not_authorized`      | 401    | Missing or invalid bearer JWT                     |
| `method_not_allowed`  | 405    | Non-POST to a non-ping route                      |
| `admin_error`         | 500    | `auth.admin.deleteUser` failed (user keeps data)  |
| `db_error`            | 500    | A pre-delete read failed (nothing deleted) or auth row deleted but `trips` cleanup failed |

## Files

- `handler.ts` — all logic (`export async function handler`).
- `index.ts` — `Deno.serve(handler)` only.
- `storage-cleanup.ts` — bucket lists + recursive prefix cleanup (also used by `delete-trip`).
- `index.test.ts` — `deno test --allow-env --allow-net=127.0.0.1 supabase/functions/delete-account/index.test.ts`

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
