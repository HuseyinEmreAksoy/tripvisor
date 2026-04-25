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
//   2. Call `serviceClient.auth.admin.deleteUser(user.id)` FIRST. If this
//      fails, the user keeps both their auth row AND their trip data — they
//      can retry. Returns 500.
//   3. Once the auth row is gone, the JWT is no longer valid for RLS, so we
//      use the service-role client to delete from `public.trips` directly
//      (cascade FKs clean trip_places, trip_legs, trip_days, trip_shares).
//      A failure here leaves orphaned data the user can no longer access via
//      RLS — log loudly and return 500 so the operator can clean it up. The
//      auth.users row is already gone, so it's safe.
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
  return m ? m[1].trim() : null;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

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

  const admin = makeAdminClient();

  // 2. Delete auth.users row FIRST (safer on partial failure — user keeps data).
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

  // 3. Delete public.* rows for this user (cascade FK cleans children).
  // The JWT context is gone after auth-delete, but the service-role client
  // has no RLS, so we filter by user_id explicitly.
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
    return errorResponse('db_error', 'Account removed but data cleanup failed', 500, origin);
  }

  log({
    requestId,
    fn: 'delete-account',
    level: 'info',
    stage: 'done',
    userId,
  });

  return jsonResponse({ ok: true }, { origin });
}

Deno.serve(handler);
