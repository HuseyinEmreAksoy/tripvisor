# delete-trip

Owner-only hard delete of one trip **including its Storage objects** (security audit #13, 2026-09-29). Replaces the client's direct PostgREST `from('trips').delete()`, which cascaded every child table but left `trip-docs/<tripId>/…` orphaned forever.

## Contract

| method | auth | body | response |
| ------ | ---- | ---- | -------- |
| `POST` | required, **owner** | `{ tripId: uuid }` | `{ ok: true, tripId, deleted: boolean, storage: { objectsRemoved }, meta: { contractVersion: 1 } }` |
| `GET ?ping` | — | — | `{ ok: true, fn: "delete-trip" }` |

`deleted: false` means the row was already gone (deleted from another device between the owner check and the delete) — still a success.

## Order of operations

1. `auth.getUser(jwt)` → `401 not_authenticated`.
2. Trip read under the caller's JWT (RLS): not visible → `404 not_found`; visible but not owned (viewer/editor) → `403 not_owner`.
3. **Storage first:** remove everything under `<tripId>/` in every `TRIP_PREFIXED_BUCKETS` bucket (reuses `../delete-account/storage-cleanup.ts`). Any failure → `500 storage_cleanup_failed`, the trip is **not** deleted and the client can retry.
4. Delete the row under the caller's JWT (`trips_owner_delete`); FK cascades clean the children. If 0 rows were deleted but the row still exists → `500 db_error` (never a false success).
5. Best-effort Storage sweep for an upload that raced steps 3→4 (logged, never fails the response).

## Security

- Owner-only, same as the Danger-zone UI and the RLS delete policy.
- The trip read and delete run under the caller's JWT. The service role is used **only** for Storage, scoped to the `<tripId>/` prefix of a trip the caller was just proven to own (the post-delete sweep can't pass the caller's storage RLS any more, and cleanup must remove objects uploaded by any collaborator).
- `verify_jwt` = default (true); no `config.toml` entry.
- Structured JSON logs carry `requestId`, `userId`, `tripId`, `stage`, `duration_ms`.

## Error codes

| code | status | meaning |
| ---- | ------ | ------- |
| `invalid_input` | 400 | body is not `{ tripId: uuid }` |
| `not_authenticated` | 401 | missing / invalid / anon-key bearer |
| `not_owner` | 403 | caller is a collaborator, not the owner |
| `not_found` | 404 | trip missing or not visible (the client hook treats this as "already deleted") |
| `method_not_allowed` | 405 | non-POST, non-ping |
| `storage_cleanup_failed` | 500 | documents could not be removed; nothing else was deleted — retry |
| `db_error` | 500 | trip read / delete failed |
| `internal_error` | 500 | unexpected exception |

## Files

- `handler.ts` — `createHandler(deps)`; all logic, no I/O of its own.
- `deps.ts` — supabase-js wiring (`supabaseDeps()`).
- `index.ts` — `Deno.serve(createHandler(supabaseDeps()))`.
- `index.test.ts` — `deno test --allow-env --allow-net=127.0.0.1 supabase/functions/delete-trip/index.test.ts`

## Client

`src/api/trips.ts` → `useDeleteTrip()` (signature unchanged: `mutate(tripId)`), typed failures as `DeleteTripError`.
