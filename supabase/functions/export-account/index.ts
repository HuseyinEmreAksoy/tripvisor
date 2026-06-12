// export-account — return a flat JSON dump of the caller's owned data.
//
// Contract:
//   POST                  (auth required)
//     -> {
//          ok: true,
//          export: {
//            user_id: Uuid,
//            exported_at: ISO8601,
//            trips: Trip[],
//            trip_places: TripPlace[],
//            trip_legs: TripLeg[],
//            trip_days: TripDay[]
//          }
//        }
//   GET  ?ping
//     -> { ok: true, fn: "export-account" }
//
// Modeled on `delete-account/index.ts`. See ADR-0009.
//
// Security / cross-tenant guard:
//   - The user id used for filtering comes EXCLUSIVELY from
//     `anon.auth.getUser(token).data.user.id`. The function does NOT accept any
//     user identifier from the request body or query string. This is the
//     guarantee that prevents cross-tenant reads via the service-role admin
//     client.
//   - JWT verification uses the anon key (no RLS bypass) so a forged or expired
//     token is rejected before any read.
//   - The Origin header must match ALLOWED_ORIGINS — same surface as
//     `delete-account`.
//
// Strict read-only:
//   - No writes, no `.delete()`, no `auth.admin.*`. The function only reads.
//
// Bounding (per ADR-0009):
//   - The entire export is materialized in memory and returned in a single
//     JSON response. A heavy user has <100 trips with <1KB each — well under
//     the 256MB Edge Function ceiling. Streaming is a follow-up if anyone hits
//     the wall.

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
    return jsonResponse({ ok: true, fn: 'export-account' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  // 1. Extract + verify JWT. The userId comes exclusively from the verified
  // token — never from the request body — to prevent cross-tenant reads.
  const token = extractBearer(req);
  if (!token) {
    return errorResponse('not_authorized', 'Missing bearer token', 401, origin);
  }

  const anon = makeAnonClient();
  const { data: userData, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !userData?.user) {
    log({
      requestId,
      fn: 'export-account',
      level: 'warn',
      stage: 'auth',
      err: authErr?.message ?? 'no user',
    });
    return errorResponse('not_authorized', 'Invalid or expired token', 401, origin);
  }
  const userId = userData.user.id;

  log({
    requestId,
    fn: 'export-account',
    level: 'info',
    stage: 'auth',
    userId,
  });

  const admin = makeAdminClient();

  // 2. Read trips owned by this user. Deterministic ordering so consecutive
  // exports for the same data produce byte-identical JSON.
  const { data: trips, error: tripsErr } = await admin
    .from('trips')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: true });

  if (tripsErr) {
    log({
      requestId,
      fn: 'export-account',
      level: 'error',
      stage: 'read_trips',
      userId,
      err: tripsErr.message,
    });
    return errorResponse('db_error', 'Failed to read trips', 500, origin);
  }

  const tripsRows = trips ?? [];

  log({
    requestId,
    fn: 'export-account',
    level: 'info',
    stage: 'read_trips',
    userId,
    count: tripsRows.length,
  });

  // 3. Read child tables filtered by `trip_id in (<owned trip ids>)`. Routing
  // every child read through the JWT-derived trip set is the cross-tenant
  // guard for the children. If the user owns zero trips, we skip the queries
  // entirely (Postgres `in (...)` with an empty list is wasteful and slightly
  // ambiguous; an empty array is the correct answer).
  const tripIds = tripsRows.map((t: { id: string }) => t.id);

  let tripPlaces: unknown[] = [];
  let tripLegs: unknown[] = [];
  let tripDays: unknown[] = [];

  if (tripIds.length > 0) {
    const [placesRes, legsRes, daysRes] = await Promise.all([
      admin
        .from('trip_places')
        .select('*')
        .in('trip_id', tripIds)
        // v2 S2.8.1: soft-delete tombstones (migration 0027) are
        // user-deleted content kept only so offline replicas converge on
        // the deletion — exporting them would resurrect places the user
        // already removed.
        .eq('deleted', false)
        .order('id', { ascending: true }),
      admin
        .from('trip_legs')
        .select('*')
        .in('trip_id', tripIds)
        .order('id', { ascending: true }),
      admin
        .from('trip_days')
        .select('*')
        .in('trip_id', tripIds)
        .order('id', { ascending: true }),
    ]);

    if (placesRes.error) {
      log({
        requestId,
        fn: 'export-account',
        level: 'error',
        stage: 'read_children',
        userId,
        table: 'trip_places',
        err: placesRes.error.message,
      });
      return errorResponse('db_error', 'Failed to read trip_places', 500, origin);
    }
    if (legsRes.error) {
      log({
        requestId,
        fn: 'export-account',
        level: 'error',
        stage: 'read_children',
        userId,
        table: 'trip_legs',
        err: legsRes.error.message,
      });
      return errorResponse('db_error', 'Failed to read trip_legs', 500, origin);
    }
    if (daysRes.error) {
      log({
        requestId,
        fn: 'export-account',
        level: 'error',
        stage: 'read_children',
        userId,
        table: 'trip_days',
        err: daysRes.error.message,
      });
      return errorResponse('db_error', 'Failed to read trip_days', 500, origin);
    }

    tripPlaces = placesRes.data ?? [];
    tripLegs = legsRes.data ?? [];
    tripDays = daysRes.data ?? [];
  }

  log({
    requestId,
    fn: 'export-account',
    level: 'info',
    stage: 'read_children',
    userId,
    count: tripPlaces.length + tripLegs.length + tripDays.length,
    trip_places: tripPlaces.length,
    trip_legs: tripLegs.length,
    trip_days: tripDays.length,
  });

  const body = {
    ok: true,
    export: {
      user_id: userId,
      exported_at: new Date().toISOString(),
      trips: tripsRows,
      trip_places: tripPlaces,
      trip_legs: tripLegs,
      trip_days: tripDays,
    },
  };

  log({
    requestId,
    fn: 'export-account',
    level: 'info',
    stage: 'done',
    userId,
    count: tripsRows.length + tripPlaces.length + tripLegs.length + tripDays.length,
  });

  return jsonResponse(body, { origin });
}

Deno.serve(handler);
