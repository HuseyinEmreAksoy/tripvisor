// delete-account — irreversibly delete the caller's account and all their data.
//
// Contract:
//   POST                  (auth required)
//     -> { ok: true }
//   GET  ?ping
//     -> { ok: true, fn: "delete-account" }
//
// Order of operations (per Phase 7 plan, Step 7.6 risk note):
//   1. Verify the JWT via the anon client's `auth.getUser(token)`. Reject 401
//      if the JWT is missing or invalid.
//   2. Enumerate the ids of every trip the caller OWNS (`trips.user_id`,
//      tombstoned rows included) with the service-role client. Collaborator
//      trips are NOT included — their documents belong to the owner. This
//      must happen before step 3 because `trips.user_id` references
//      auth.users ON DELETE CASCADE: after step 3 the ids are gone. If this
//      read fails nothing has been destroyed yet → 500 `db_error`, retryable.
//   3. Call `serviceClient.auth.admin.deleteUser(user.id)`. If this fails,
//      the user keeps both their auth row AND their trip data — they can
//      retry. Returns 500.
//   4. Service-role `.delete()` on `public.trips` for user_id (normally a
//      no-op — the FK cascade in step 3 already removed them; kept as a
//      belt-and-braces sweep). Cascade FKs clean every child table,
//      including `trip_documents` metadata.
//   5. Best-effort Storage cleanup (see ./storage-cleanup.ts): remove every
//      object under `<tripId>/` in the `trip-docs` bucket for the ids from
//      step 2. Done AFTER the auth delete on purpose: deleting bytes first
//      and then failing step 3 would leave a live account whose documents
//      point at missing files (strictly worse than orphaned bytes). Orphaned
//      bytes are unreachable (the storage RLS keys on a trip that no longer
//      exists), so a cleanup failure is logged (`stage: 'storage_cleanup'`,
//      level error, with the failing keys) for operator follow-up and does
//      NOT change the response — the account deletion itself succeeded.
//   A step-4 failure still returns 500 `db_error` (after step 5 has run).
//
// Why not call the `delete_account_cascade()` RPC after auth-delete?
//   The RPC reads `auth.uid()` from the JWT context. Once we've deleted the
//   auth row, the JWT no longer maps to a real user (and the service-role
//   client has no JWT context anyway). We use a direct service-role
//   `.delete().eq('user_id', user.id)` instead, which is safe because:
//     - We already verified the JWT belonged to user.id.
//     - There's no RLS race: the auth.users row is already gone.
//     - The `public.trips` cascade FKs clean every child table.
//
// Security:
//   - JWT verification uses anon key (no RLS bypass) so a forged or expired
//     token is rejected before any destructive call.
//   - The Origin header must match ALLOWED_ORIGINS. Cross-origin browser
//     attempts without the right Origin are rejected at the CORS layer.
//   - Service-role key never leaves the function — it's a Deno.env secret.

import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { log, newRequestId } from '../_shared/logger.ts';
import { makeAdminClient } from '../_shared/supabase-admin.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  type BucketApi,
  cleanupTripStorage,
  type StorageCleanupReport,
  TRIP_PREFIXED_BUCKETS,
} from './storage-cleanup.ts';

const OWNED_TRIPS_PAGE = 1000;
/** Cap error strings in the log line so one bad bucket can't flood it. */
const MAX_LOGGED_ERRORS = 20;

function makeAnonClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('Supabase env vars missing');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m?.[1] ? m[1].trim() : null;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();
  const startedAt = Date.now();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'delete-account' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  // 1. Extract + verify JWT.
  const token = extractBearer(req);
  if (!token) {
    return errorResponse('not_authorized', 'Missing bearer token', 401, origin);
  }

  const anon = makeAnonClient();
  const { data: userData, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !userData?.user) {
    log({
      requestId,
      fn: 'delete-account',
      level: 'warn',
      stage: 'auth',
      err: authErr?.message ?? 'no user',
    });
    return errorResponse('not_authorized', 'Invalid or expired token', 401, origin);
  }
  const userId = userData.user.id;

  // Service-role justification: after the auth row is deleted there is no
  // JWT context for RLS, and Storage objects of the user's trips must be
  // removed regardless of per-object policies. Every query below is scoped to
  // the verified `userId` (or to trip ids read with that filter).
  const admin = makeAdminClient();

  // 2. Enumerate owned trip ids BEFORE the auth delete cascades them away.
  const ownedTripIds: string[] = [];
  for (let from = 0; ; from += OWNED_TRIPS_PAGE) {
    const { data: rows, error: listErr } = await admin
      .from('trips')
      .select('id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + OWNED_TRIPS_PAGE - 1);
    if (listErr) {
      log({
        requestId,
        fn: 'delete-account',
        level: 'error',
        stage: 'owned_trips_list',
        userId,
        err: listErr.message,
      });
      // Nothing destroyed yet — the user can simply retry.
      return errorResponse('db_error', 'Failed to read account data', 500, origin);
    }
    const page = (rows ?? []) as Array<{ id: string }>;
    for (const r of page) ownedTripIds.push(r.id);
    if (page.length < OWNED_TRIPS_PAGE) break;
  }

  // 3. Delete auth.users row (safer on partial failure — user keeps data).
  const { error: adminErr } = await admin.auth.admin.deleteUser(userId);
  if (adminErr) {
    log({
      requestId,
      fn: 'delete-account',
      level: 'error',
      stage: 'auth_delete',
      userId,
      err: adminErr.message,
    });
    return errorResponse('admin_error', 'Failed to delete account', 500, origin);
  }

  // 4. Delete public.* rows for this user (cascade FK cleans children).
  // Normally a no-op (trips.user_id cascades from auth.users) but kept as a
  // sweep. The service-role client has no RLS, so filter by user_id.
  const { error: dbErr } = await admin.from('trips').delete().eq('user_id', userId);
  if (dbErr) {
    // The auth row is gone but trip rows may remain. Log loudly so an
    // operator can clean orphans. The user can no longer reach this data
    // through RLS, so it's not a security leak — just disk waste.
    log({
      requestId,
      fn: 'delete-account',
      level: 'error',
      stage: 'trips_cleanup',
      userId,
      err: dbErr.message,
    });
  }

  // 5. Best-effort Storage cleanup for owned trips (never throws).
  const storageReports: StorageCleanupReport[] = [];
  for (const bucket of TRIP_PREFIXED_BUCKETS) {
    let report: StorageCleanupReport;
    try {
      const api = admin.storage.from(bucket) as unknown as BucketApi;
      report = await cleanupTripStorage(api, bucket, ownedTripIds);
    } catch (e) {
      report = {
        bucket,
        prefixes: ownedTripIds.length,
        found: 0,
        removed: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      };
    }
    storageReports.push(report);
    log({
      requestId,
      fn: 'delete-account',
      level: report.errors.length > 0 ? 'error' : 'info',
      stage: 'storage_cleanup',
      userId,
      bucket: report.bucket,
      trips: report.prefixes,
      objects_found: report.found,
      objects_removed: report.removed,
      error_count: report.errors.length,
      ...(report.errors.length > 0
        ? { errors: report.errors.slice(0, MAX_LOGGED_ERRORS), tripIds: ownedTripIds }
        : {}),
    });
  }

  if (dbErr) {
    return errorResponse('db_error', 'Account removed but data cleanup failed', 500, origin);
  }

  log({
    requestId,
    fn: 'delete-account',
    level: 'info',
    stage: 'done',
    userId,
    trips: ownedTripIds.length,
    objects_removed: storageReports.reduce((n, r) => n + r.removed, 0),
    storage_errors: storageReports.reduce((n, r) => n + r.errors.length, 0),
    duration_ms: Date.now() - startedAt,
  });

  return jsonResponse({ ok: true }, { origin });
}

Deno.serve(handler);
