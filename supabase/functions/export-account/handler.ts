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
//            // Children of OWNED trips (trip_id in <owned trips>), tombstones
//            // (deleted = true) excluded where the table has them:
//            trip_places: TripPlace[],
//            trip_legs: TripLeg[],
//            trip_days: TripDay[],
//            // Wave-1 review #7 (additive; older clients ignore them):
//            trip_expenses: Row[],             incl. amount, currency, fx_rate,
//                                              fx_date, fx_home_currency
//            trip_accommodations: Row[],
//            trip_packing_items: Row[],
//            trip_documents: Row[],            metadata + storage_path (bucket
//                                              `trip-docs`); no file bytes
//            trip_shares: Row[],               share links WITHOUT the token
//                                              (write-once reveal, 0003) and
//                                              with the public-link toggles
//            trip_collaborators: Row[],        who the trips are shared with
//                                              (invitee email, role, status);
//                                              no invite token, no user id
//            // AUTHORED by the caller, on any trip (never other members' rows):
//            trip_journal_entries: Row[],
//            trip_place_reviews: Row[],
//            trip_photos: Row[],               metadata + storage_path /
//                                              thumb_path (bucket
//                                              `trip-memories`); no bytes, no
//                                              signed URLs
//            trip_place_comments: Row[],
//            trip_place_reactions: Row[],
//            user_preferences: Row | null,
//            files: { note, buckets }          how to read the *_path fields
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
//   - Authored content (memories, comments, reactions) is filtered by the
//     author column = <caller>, NOT by the owned-trip set: memories are
//     private by default and comments/reactions are each member's own words,
//     so a trip owner never receives another member's items (not even shared
//     ones), and a member's own items on someone else's trip ARE their data.
//   - Trip-level data (places, days, expenses, stays, packing, documents,
//     share links, collaborators) comes from OWNED trips only. Those tables
//     have no author column; a member's edits on someone else's trip belong
//     to that trip's owner's export.
//   - Soft-deleted rows (`deleted = true`) are excluded everywhere they exist:
//     tombstones are user-deleted content kept only for offline convergence.
//   - Secrets are never exported: share-link tokens (0003 reveals them once,
//     on create) and invite tokens are left out by explicit column lists.
//     Other members' auth user ids are left out of trip_collaborators.
//   - File bytes are never embedded and no signed URLs are minted: an export
//     file outlives any short-lived URL and gets stored and forwarded in
//     places a live URL should not go. `files` explains the paths instead.
//   - JWT verification uses the anon key (no RLS bypass) so a forged or expired
//     token is rejected before any read.
//   - The Origin header must match ALLOWED_ORIGINS — same surface as
//     `delete-account`.
//
// Strict read-only: no writes, no `.delete()`, no `auth.admin.*`.
//
// Bounding (per ADR-0009): the export is materialized in memory and returned
// in one JSON response. Every table is read in pages of EXPORT_PAGE_ROWS
// (PostgREST's max_rows would otherwise silently truncate at 1000 rows), and
// owned-trip filters go out TRIP_ID_CHUNK ids at a time (URL length); a
// table over MAX_EXPORT_ROWS_PER_TABLE fails the export (500) rather than
// returning a partial one. Rows are small (photo/document rows are metadata;
// the 0036 caps keep memories to a few hundred per user).
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

interface OwnedTripTable {
  table: string;
  /** Has a `deleted` tombstone column (0027): only live rows are exported. */
  tombstones: boolean;
  /**
   * Explicit column list where `*` would leak a secret or another person's
   * id. NOTE: columns added to these tables later are NOT exported until
   * listed here (deliberately: new columns are reviewed first).
   */
  columns?: string;
}

/** Children of the caller's OWNED trips (`trip_id in <owned trip ids>`). */
export const OWNED_TRIP_TABLES: readonly OwnedTripTable[] = [
  { table: 'trip_places', tombstones: true },
  { table: 'trip_legs', tombstones: false },
  { table: 'trip_days', tombstones: true },
  { table: 'trip_expenses', tombstones: true },
  { table: 'trip_accommodations', tombstones: true },
  { table: 'trip_packing_items', tombstones: true },
  { table: 'trip_documents', tombstones: false },
  {
    table: 'trip_shares',
    tombstones: false,
    // Not `token`: 0003 reveals a share token once, on create, never again.
    columns: 'id, trip_id, created_at, revoked_at, show_itinerary, show_expenses, show_memories',
  },
  {
    table: 'trip_collaborators',
    tombstones: false,
    // Not `invite_token` (a bearer secret) nor the member's auth `user_id`.
    columns: 'id, trip_id, invitee_email, role, status, created_at, accepted_at, revoked_at',
  },
];

/** Rows the caller AUTHORED on any trip, keyed by the table's author column. */
export const AUTHORED_TABLES: ReadonlyArray<{ table: string; author: 'author_id' | 'user_id' }> = [
  { table: 'trip_journal_entries', author: 'author_id' },
  { table: 'trip_place_reviews', author: 'author_id' },
  { table: 'trip_photos', author: 'author_id' },
  { table: 'trip_place_comments', author: 'author_id' },
  { table: 'trip_place_reactions', author: 'user_id' },
];

/** Explains the object paths in the export (no bytes, no signed URLs). */
export const EXPORT_FILES_NOTE = {
  note:
    'Photo and document files are not included in this export and no download links are created. ' +
    'Each storage_path / thumb_path is the file\'s location in Tripvisor\'s private storage (bucket below); ' +
    'open the trip in the app to view or download the files.',
  buckets: {
    trip_photos: { bucket: 'trip-memories', path_fields: ['storage_path', 'thumb_path'] },
    trip_documents: { bucket: 'trip-docs', path_fields: ['storage_path'] },
  },
} as const;

/** = PostgREST max_rows (supabase/config.toml; also the hosted default). */
export const EXPORT_PAGE_ROWS = 1000;
/** A table larger than this fails the export instead of truncating it. */
export const MAX_EXPORT_ROWS_PER_TABLE = 100_000;
/**
 * Owned-trip ids per `trip_id=in.(...)` filter: 100 uuids is ~3.7 KB of URL,
 * well under the ~8 KB proxies accept, so a user with hundreds of trips still
 * gets an export instead of a 414.
 */
export const TRIP_ID_CHUNK = 100;

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

type PageResult = { data: unknown; error: { message: string } | null };
/** A filtered, ordered query that can still take `.range()`. */
type PagedQuery = { range(from: number, to: number): PromiseLike<PageResult> };

/**
 * Read every row of one query in pages (stable because every query orders by
 * `id`). Stops at the first short page; fails (instead of truncating) past
 * MAX_EXPORT_ROWS_PER_TABLE.
 */
export async function readAllPages(table: string, build: () => PagedQuery): Promise<ReadResult> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_ROWS) {
    const { data, error } = await build().range(from, from + EXPORT_PAGE_ROWS - 1);
    if (error) return { table, data: null, error };
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_ROWS) return { table, data: rows, error: null };
    if (rows.length >= MAX_EXPORT_ROWS_PER_TABLE) {
      return { table, data: null, error: { message: `more than ${MAX_EXPORT_ROWS_PER_TABLE} rows` } };
    }
  }
}

const byId = (a: unknown, b: unknown): number => {
  const x = String((a as { id?: unknown }).id);
  const y = String((b as { id?: unknown }).id);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * readAllPages over `tripIds` in chunks of TRIP_ID_CHUNK (sequential, to keep
 * concurrency flat). Several chunks are re-sorted by id so the output stays
 * deterministic (lower-case uuid text sorts like Postgres uuid order).
 */
export async function readForTrips(
  table: string,
  tripIds: readonly string[],
  build: (ids: string[]) => PagedQuery,
): Promise<ReadResult> {
  const rows: unknown[] = [];
  for (let i = 0; i < tripIds.length; i += TRIP_ID_CHUNK) {
    const ids = tripIds.slice(i, i + TRIP_ID_CHUNK);
    const part = await readAllPages(table, () => build(ids));
    if (part.error) return part;
    rows.push(...(part.data ?? []));
    if (rows.length > MAX_EXPORT_ROWS_PER_TABLE) {
      return { table, data: null, error: { message: `more than ${MAX_EXPORT_ROWS_PER_TABLE} rows` } };
    }
  }
  if (tripIds.length > TRIP_ID_CHUNK) rows.sort(byId);
  return { table, data: rows, error: null };
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
  // does not own (their own memories, comments and reactions), reads
  // trip_shares (no SELECT policy at all, 0003), and must not depend on
  // per-row visibility. Every query is filtered by the verified userId
  // (directly or through the owned-trip ids read with that filter).
  const admin = makeAdminClient();

  // 2. Trips owned by this user. Deterministic ordering so consecutive
  // exports for the same data produce byte-identical JSON.
  const tripsRead = await readAllPages('trips', () =>
    admin.from('trips').select('*').eq('user_id', userId).order('id', { ascending: true }),
  );

  if (tripsRead.error) {
    log({ requestId, fn: 'export-account', level: 'error', stage: 'read_trips', userId, err: tripsRead.error.message });
    return errorResponse('db_error', 'Failed to read trips', 500, origin);
  }

  const tripsRows = (tripsRead.data ?? []) as Array<{ id: string }>;
  log({ requestId, fn: 'export-account', level: 'info', stage: 'read_trips', userId, count: tripsRows.length });

  // 3. Children of OWNED trips (trip_id in <owned trip ids>), and the
  // caller's AUTHORED rows + preferences (author column = caller).
  // With zero owned trips the trip-child reads are skipped (an empty
  // `in ()` is wasteful and ambiguous; [] is the correct answer).
  const tripIds = tripsRows.map((t) => t.id);

  const reads: Array<Promise<ReadResult>> = [];
  if (tripIds.length > 0) {
    for (const spec of OWNED_TRIP_TABLES) {
      reads.push(
        readForTrips(spec.table, tripIds, (ids) => {
          let q = admin.from(spec.table).select(spec.columns ?? '*').in('trip_id', ids);
          // v2 S2.8.1: tombstones (0027) are user-deleted content kept only
          // for offline convergence; exporting them would resurrect it.
          if (spec.tombstones) q = q.eq('deleted', false);
          return q.order('id', { ascending: true });
        }),
      );
    }
  }
  for (const spec of AUTHORED_TABLES) {
    reads.push(
      readAllPages(spec.table, () =>
        admin
          .from(spec.table)
          .select('*')
          .eq(spec.author, userId)
          .eq('deleted', false)
          .order('id', { ascending: true }),
      ),
    );
  }
  reads.push(
    Promise.resolve(admin.from('user_preferences').select('*').eq('user_id', userId).limit(1)).then(
      (r: PageResult): ReadResult => ({
        table: 'user_preferences',
        data: Array.isArray(r.data) ? r.data : null,
        error: r.error,
      }),
    ),
  );

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
    trip_expenses: rows('trip_expenses'),
    trip_accommodations: rows('trip_accommodations'),
    trip_packing_items: rows('trip_packing_items'),
    trip_documents: rows('trip_documents'),
    trip_shares: rows('trip_shares'),
    trip_collaborators: rows('trip_collaborators'),
    trip_journal_entries: rows('trip_journal_entries'),
    trip_place_reviews: rows('trip_place_reviews'),
    trip_photos: rows('trip_photos'),
    trip_place_comments: rows('trip_place_comments'),
    trip_place_reactions: rows('trip_place_reactions'),
    user_preferences: rows('user_preferences')[0] ?? null,
    files: EXPORT_FILES_NOTE,
  };

  const counts: Record<string, number> = { trips: tripsRows.length };
  for (const spec of [...OWNED_TRIP_TABLES, ...AUTHORED_TABLES]) counts[spec.table] = rows(spec.table).length;
  log({ requestId, fn: 'export-account', level: 'info', stage: 'done', userId, ...counts });

  return jsonResponse({ ok: true, export: exportBody }, { origin });
}
