// export-account — return a flat JSON dump of the caller's own data.
//
// Contract:
//   POST                  (auth required)
//     -> {
//          ok: true,
//          export: {
//            user_id: Uuid,
//            exported_at: ISO8601,
//            trips: Trip[],                    owned trips
//            trip_places: TripPlace[],         of owned trips (tombstones excluded)
//            trip_legs: TripLeg[],             of owned trips
//            trip_days: TripDay[],             of owned trips
//            // M5 (additive; older clients ignore them):
//            trip_journal_entries: Row[],      AUTHORED by the caller, any trip
//            trip_place_reviews: Row[],        AUTHORED by the caller, any trip
//            trip_photos: Row[],               AUTHORED by the caller, any trip;
//                                              metadata + storage_path /
//                                              thumb_path (bucket `trip-memories`),
//                                              no bytes, no signed URLs
//            user_preferences: Row | null
//          }
//        }
//   GET  ?ping
//     -> { ok: true, fn: "export-account" }
//
// Modeled on `delete-account`. See ADR-0009 (export) and ADR-0014 (memories:
// "export covers the new tables, metadata only").
//
// Security / cross-tenant guard:
//   - The user id used for filtering comes EXCLUSIVELY from
//     `anon.auth.getUser(token).data.user.id`. The function does NOT accept any
//     user identifier from the request body or query string. This is the
//     guarantee that prevents cross-tenant reads via the service-role admin
//     client.
//   - Memories are filtered by `author_id = <caller>`, NOT by the owned-trip
//     set: memories are private by default, so the owner of a trip must never
//     receive another member's items (not even shared ones) in their export,
//     and a member's own memories on someone else's trip ARE their data.
//   - Soft-deleted rows (`deleted = true`) are excluded everywhere they exist:
//     tombstones are user-deleted content kept only for offline convergence.
//   - JWT verification uses the anon key (no RLS bypass) so a forged or expired
//     token is rejected before any read.
//   - The Origin header must match ALLOWED_ORIGINS — same surface as
//     `delete-account`.
//
// Strict read-only: no writes, no `.delete()`, no `auth.admin.*`.
//
// Bounding (per ADR-0009): the export is materialized in memory and returned
// in one JSON response. Memory rows are small (photo rows are metadata only;
// at most a few hundred per user under the 0036 caps).
//
// index.ts only wires `Deno.serve(handler)`, so tests import this module
// without starting a server.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { makeAdminClient } from '../_shared/supabase-admin.ts';
// @ts-ignore -- Deno URL import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/** Tables exported by author (M5 memories, migration 0036). */
export const AUTHORED_MEMORY_TABLES = ['trip_journal_entries', 'trip_place_reviews', 'trip_photos'] as const;

function makeAnonClient() {
  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
  const url = Deno.env.get('SUPABASE_URL');
  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
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

interface ReadResult {
  table: string;
  data: unknown[] | null;
  error: { message: string } | null;
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
  const userId: string = userData.user.id;

  log({ requestId, fn: 'export-account', level: 'info', stage: 'auth', userId });

  // Service-role justification: the export spans rows on trips the caller
  // does not own (their own memories) and must not depend on per-row
  // visibility. Every query is filtered by the verified userId (directly or
  // through the owned-trip ids read with that filter).
  const admin = makeAdminClient();

  // 2. Trips owned by this user. Deterministic ordering so consecutive
  // exports for the same data produce byte-identical JSON.
  const { data: trips, error: tripsErr } = await admin
    .from('trips')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: true });

  if (tripsErr) {
    log({ requestId, fn: 'export-account', level: 'error', stage: 'read_trips', userId, err: tripsErr.message });
    return errorResponse('db_error', 'Failed to read trips', 500, origin);
  }

  const tripsRows = (trips ?? []) as Array<{ id: string }>;
  log({ requestId, fn: 'export-account', level: 'info', stage: 'read_trips', userId, count: tripsRows.length });

  // 3. Children of OWNED trips (trip_id in <owned trip ids>), and the
  // caller's AUTHORED memories + preferences (author_id / user_id = caller).
  // With zero owned trips the trip-child reads are skipped (an empty
  // `in ()` is wasteful and ambiguous; [] is the correct answer).
  const tripIds = tripsRows.map((t) => t.id);

  const reads: Array<PromiseLike<ReadResult>> = [];
  const read = (table: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
    reads.push(
      Promise.resolve(q).then((r) => ({
        table,
        data: (r.data ?? null) as unknown[] | null,
        error: r.error,
      })),
    );

  if (tripIds.length > 0) {
    read(
      'trip_places',
      admin
        .from('trip_places')
        .select('*')
        .in('trip_id', tripIds)
        // v2 S2.8.1: tombstones (0027) are user-deleted content kept only for
        // offline convergence; exporting them would resurrect removed places.
        .eq('deleted', false)
        .order('id', { ascending: true }),
    );
    read('trip_legs', admin.from('trip_legs').select('*').in('trip_id', tripIds).order('id', { ascending: true }));
    read('trip_days', admin.from('trip_days').select('*').in('trip_id', tripIds).order('id', { ascending: true }));
  }
  for (const table of AUTHORED_MEMORY_TABLES) {
    read(
      table,
      admin
        .from(table)
        .select('*')
        .eq('author_id', userId)
        .eq('deleted', false)
        .order('id', { ascending: true }),
    );
  }
  read('user_preferences', admin.from('user_preferences').select('*').eq('user_id', userId).limit(1));

  const results = await Promise.all(reads);
  const failed = results.find((r) => r.error);
  if (failed) {
    log({
      requestId,
      fn: 'export-account',
      level: 'error',
      stage: 'read_children',
      userId,
      table: failed.table,
      err: failed.error?.message,
    });
    return errorResponse('db_error', `Failed to read ${failed.table}`, 500, origin);
  }
  const rows = (table: string): unknown[] => results.find((r) => r.table === table)?.data ?? [];

  const exportBody = {
    user_id: userId,
    exported_at: new Date().toISOString(),
    trips: tripsRows,
    trip_places: rows('trip_places'),
    trip_legs: rows('trip_legs'),
    trip_days: rows('trip_days'),
    trip_journal_entries: rows('trip_journal_entries'),
    trip_place_reviews: rows('trip_place_reviews'),
    trip_photos: rows('trip_photos'),
    user_preferences: rows('user_preferences')[0] ?? null,
  };

  log({
    requestId,
    fn: 'export-account',
    level: 'info',
    stage: 'done',
    userId,
    trips: tripsRows.length,
    trip_places: exportBody.trip_places.length,
    trip_legs: exportBody.trip_legs.length,
    trip_days: exportBody.trip_days.length,
    trip_journal_entries: exportBody.trip_journal_entries.length,
    trip_place_reviews: exportBody.trip_place_reviews.length,
    trip_photos: exportBody.trip_photos.length,
  });

  return jsonResponse({ ok: true, export: exportBody }, { origin });
}
