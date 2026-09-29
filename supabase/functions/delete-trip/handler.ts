// delete-trip — owner-only hard delete of ONE trip, Storage included.
//
// Why this exists (security audit #13, 2026-09-29): the client used to
// hard-delete via PostgREST (`from('trips').delete()`). Postgres cascades
// clean every child table (incl. `trip_documents` metadata) but never reach
// Storage, so every uploaded document of a deleted trip stayed in the
// `trip-docs` bucket forever — unreachable through RLS (the storage policies
// key on `user_can_access_trip(<first path segment>)`, and the trip is gone)
// but still personal data we keep and still billed disk.
//
// Contract:
//   POST { tripId: uuid }                         (auth required, OWNER only)
//     -> { ok: true, tripId, deleted: boolean,
//          storage: { objectsRemoved: number },
//          meta: { contractVersion: 1 } }
//   GET  ?ping
//     -> { ok: true, fn: "delete-trip" }
//
// Order of operations:
//   1. Verify the JWT with `auth.getUser` → 401 `not_authenticated`.
//   2. Read the trip UNDER THE CALLER'S JWT (RLS): not visible → 404
//      `not_found`; visible but `user_id !== caller` (a collaborator) → 403
//      `not_owner`. Nothing destructive has happened yet.
//   3. Storage pass 1: remove every object under `<tripId>/` in each
//      TRIP_PREFIXED_BUCKETS bucket (delete-account/storage-cleanup.ts, the
//      same helper account deletion uses). ANY failure → 500
//      `storage_cleanup_failed` and the trip is NOT deleted, so the client
//      can simply retry. (Deleting the row first would make a Storage failure
//      permanent: once the trip row is gone nobody can retry through the
//      app, and the bytes are orphaned — the exact bug being fixed.)
//      Trade-off: on a partial failure some documents of the still-existing
//      trip may already have lost their bytes. The user is deleting the trip
//      anyway, and a retry finishes the job.
//   4. Delete the trip row UNDER THE CALLER'S JWT (RLS `trips_owner_delete`
//      is the authority; FK cascades clean all children). 0 rows deleted
//      (a concurrent delete from another device) is still success.
//   5. Storage pass 2 (best-effort sweep): closes the race where a
//      collaborator uploaded a document between pass 1 and the row delete —
//      its metadata row cascaded away with the trip, its bytes would be
//      orphaned. After step 4 no new upload can land (the storage INSERT
//      policy needs a live trip). Failures are logged (level error, with the
//      keys) for operator follow-up and do not change the response.
//
// Security:
//   - Owner-only by design (same rule as the Danger-zone UI and RLS).
//   - Service-role use is limited to Storage (deps.ts): the sweep in step 5
//     runs after the trip row is gone, when the caller's own storage RLS can
//     no longer see the objects, and the cleanup must remove every object
//     regardless of which collaborator uploaded it. Every Storage call is
//     scoped to the `<tripId>/` prefix of a trip the caller was just proven
//     to own. The DB read and delete run under the caller's JWT.
//   - verify_jwt stays at the default (true): no config.toml entry.
//
// Error codes: invalid_input 400 · not_authenticated 401 · not_owner 403 ·
//   not_found 404 · method_not_allowed 405 · db_error 500 ·
//   storage_cleanup_failed 500 · internal_error 500.
//
// Pure w.r.t. I/O: every side effect goes through `DeleteTripDeps`, so the
// Deno tests drive the whole flow with in-memory fakes (see index.test.ts);
// deps.ts holds the supabase-js wiring.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
import {
  type BucketApi,
  cleanupTripStorage,
  type StorageCleanupReport,
  TRIP_PREFIXED_BUCKETS,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from '../delete-account/storage-cleanup.ts';

export const DELETE_TRIP_CONTRACT_VERSION = 1 as const;

/** Cap error strings in one log line so one bad bucket can't flood it. */
const MAX_LOGGED_ERRORS = 20;

const BodySchema = z.object({ tripId: z.string().uuid() });

export interface TripOwnerRow {
  id: string;
  user_id: string;
}

/** Every side effect of the handler. deps.ts wires these to supabase-js. */
export interface DeleteTripDeps {
  /** GoTrue-verified caller id for the request's bearer JWT, or null. */
  authenticate(req: Request): Promise<string | null>;
  /** RLS-scoped (caller JWT) trip lookup. */
  loadTrip(req: Request, tripId: string): Promise<{ row: TripOwnerRow | null; error: string | null }>;
  /** RLS-scoped (caller JWT) delete; `deleted` = rows removed. */
  deleteTrip(req: Request, tripId: string): Promise<{ deleted: number; error: string | null }>;
  /** Service-role Storage bucket API (see the security note above). */
  bucket(name: string): BucketApi;
}

async function cleanupAll(deps: DeleteTripDeps, tripId: string): Promise<StorageCleanupReport[]> {
  const reports: StorageCleanupReport[] = [];
  for (const bucket of TRIP_PREFIXED_BUCKETS) {
    try {
      reports.push(await cleanupTripStorage(deps.bucket(bucket), bucket, [tripId]));
    } catch (e) {
      // cleanupTripStorage never throws; this guards deps.bucket() itself.
      reports.push({
        bucket,
        prefixes: 1,
        found: 0,
        removed: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  }
  return reports;
}

const errorCount = (rs: StorageCleanupReport[]) => rs.reduce((n, r) => n + r.errors.length, 0);
const removedCount = (rs: StorageCleanupReport[]) => rs.reduce((n, r) => n + r.removed, 0);
const foundCount = (rs: StorageCleanupReport[]) => rs.reduce((n, r) => n + r.found, 0);
const loggedErrors = (rs: StorageCleanupReport[]) =>
  rs.flatMap((r) => r.errors.map((e) => `${r.bucket}: ${e}`)).slice(0, MAX_LOGGED_ERRORS);

export function createHandler(deps: DeleteTripDeps): (req: Request) => Promise<Response> {
  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const requestId = newRequestId();
    const startedAt = Date.now();

    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    if (url.searchParams.has('ping')) {
      return jsonResponse({ ok: true, fn: 'delete-trip' }, { origin });
    }
    if (req.method !== 'POST') {
      return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return errorResponse('invalid_input', 'Invalid JSON', 400, origin);
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(
        'invalid_input',
        parsed.error.issues.map((i: { message: string }) => i.message).join('; '),
        400,
        origin,
      );
    }
    const tripId: string = parsed.data.tripId;

    let userId: string | null = null;
    try {
      // 1. Caller identity.
      userId = await deps.authenticate(req);
      if (!userId) {
        return errorResponse('not_authenticated', 'Missing or invalid bearer token', 401, origin);
      }

      // 2. Owner gate (RLS read under the caller's JWT).
      const { row, error: loadErr } = await deps.loadTrip(req, tripId);
      if (loadErr) {
        log({ requestId, fn: 'delete-trip', level: 'error', stage: 'load', userId, tripId, err: loadErr });
        return errorResponse('db_error', 'Failed to load trip', 500, origin);
      }
      if (!row) {
        return errorResponse('not_found', 'Trip not found or forbidden', 404, origin);
      }
      if (row.user_id !== userId) {
        log({ requestId, fn: 'delete-trip', level: 'warn', stage: 'owner_gate', result: 'not_owner', userId, tripId });
        return errorResponse('not_owner', 'Only the trip owner can delete this trip', 403, origin);
      }

      // 3. Storage pass 1 — must fully succeed before the row goes.
      const pass1 = await cleanupAll(deps, tripId);
      if (errorCount(pass1) > 0) {
        log({
          requestId,
          fn: 'delete-trip',
          level: 'error',
          stage: 'storage_cleanup',
          userId,
          tripId,
          objects_found: foundCount(pass1),
          objects_removed: removedCount(pass1),
          errors: loggedErrors(pass1),
        });
        return errorResponse(
          'storage_cleanup_failed',
          "Couldn't remove this trip's documents. Nothing else was deleted — try again.",
          500,
          origin,
        );
      }

      // 4. Delete the row (cascade) under the caller's JWT.
      const { deleted, error: delErr } = await deps.deleteTrip(req, tripId);
      if (delErr) {
        log({ requestId, fn: 'delete-trip', level: 'error', stage: 'delete', userId, tripId, err: delErr });
        return errorResponse('db_error', 'Failed to delete trip', 500, origin);
      }
      if (deleted === 0) {
        // Expected only when another device deleted it in between. Make sure
        // the row is really gone rather than silently refused (e.g. a future
        // policy/trigger), so we never report success for a live trip.
        const recheck = await deps.loadTrip(req, tripId);
        if (recheck.error || recheck.row) {
          log({
            requestId,
            fn: 'delete-trip',
            level: 'error',
            stage: 'delete',
            userId,
            tripId,
            result: recheck.row ? 'delete_refused' : 'recheck_failed',
            err: recheck.error,
          });
          return errorResponse('db_error', 'Failed to delete trip', 500, origin);
        }
        log({ requestId, fn: 'delete-trip', level: 'warn', stage: 'delete', userId, tripId, result: 'already_gone' });
      }

      // 5. Best-effort sweep for uploads that raced step 3 → 4.
      const pass2 = await cleanupAll(deps, tripId);
      if (errorCount(pass2) > 0 || foundCount(pass2) > 0) {
        log({
          requestId,
          fn: 'delete-trip',
          level: errorCount(pass2) > 0 ? 'error' : 'warn',
          stage: 'storage_sweep',
          userId,
          tripId,
          objects_found: foundCount(pass2),
          objects_removed: removedCount(pass2),
          ...(errorCount(pass2) > 0 ? { errors: loggedErrors(pass2) } : {}),
        });
      }

      const objectsRemoved = removedCount(pass1) + removedCount(pass2);
      log({
        requestId,
        fn: 'delete-trip',
        level: 'info',
        stage: 'done',
        userId,
        tripId,
        deleted,
        objects_removed: objectsRemoved,
        duration_ms: Date.now() - startedAt,
      });

      return jsonResponse(
        {
          ok: true,
          tripId,
          deleted: deleted > 0,
          storage: { objectsRemoved },
          meta: { contractVersion: DELETE_TRIP_CONTRACT_VERSION },
        },
        { origin },
      );
    } catch (err) {
      log({
        requestId,
        fn: 'delete-trip',
        level: 'error',
        stage: 'unexpected',
        userId,
        tripId,
        err: String(err),
        duration_ms: Date.now() - startedAt,
      });
      return errorResponse('internal_error', 'delete-trip failed', 500, origin);
    }
  };
}
