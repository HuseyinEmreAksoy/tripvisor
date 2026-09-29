// delete-account — Storage cleanup helpers (also used by delete-trip).
//
// Why this exists: deleting the auth.users row cascades `public.trips` (and
// from there `trip_documents` / `trip_photos` metadata), but Postgres
// cascades never reach Storage. Without this, every uploaded file of a
// deleted account or trip would stay in Storage forever (unreachable via
// RLS, but still billed disk and still personal data we promised to erase).
//
// Buckets cleaned (grep `storage.buckets` in supabase/migrations):
//   - `trip-docs` (0024): key `<trip_id>/<ts>_<filename>`
//     (src/api/trip-documents.ts `storagePath`).
//   - `trip-memories` (0036): key `<trip_id>/<author_id>/<photo_id>(_t).jpg`.
//     A user's photos can live on trips they do NOT own (any member may add
//     memories), so account deletion also removes `<trip_id>/<user_id>/` on
//     those trips (AUTHOR_PREFIXED_BUCKETS), never other authors' folders.
// We list recursively so any nested sub-folder a future writer adds is also
// removed. Cover photos are a Google place-id pointer (0018, bytes proxied
// live by `place-photo`), and there are no avatar uploads.
//
// A bucket that does not exist yet (Edge Functions deployed before the
// migration that creates it) is treated as empty, so a mis-ordered deploy
// can never block a trip or account deletion.
//
// Pure w.r.t. its inputs: takes a minimal Storage-bucket interface so the
// Deno tests can drive it with a fake instead of the full supabase-js client.

/** Buckets whose object keys are prefixed with `<trip_id>/`. delete-trip
 * and delete-account wipe the WHOLE `<trip_id>/` prefix of trips being
 * deleted in every one of these. */
export const TRIP_PREFIXED_BUCKETS = ['trip-docs', 'trip-memories'] as const;

/** Buckets whose keys are `<trip_id>/<author_id>/…`: an author's objects on
 * trips they don't own. delete-account removes only `<trip_id>/<user_id>/`
 * there (see `authorPrefix`). */
export const AUTHOR_PREFIXED_BUCKETS = ['trip-memories'] as const;

/** `<tripId>/<userId>`: one author's folder inside a trip prefix. */
export function authorPrefix(tripId: string, userId: string): string {
  return `${tripId}/${userId}`;
}

/** storage-api answers "Bucket not found" on some versions (others: 200 []). */
export function isMissingBucketError(error: { message: string } | null | undefined): boolean {
  return !!error && /bucket not found/i.test(error.message);
}

/** Page size for `list` (Storage caps a page at 1000; smaller keeps memory flat). */
export const LIST_PAGE_SIZE = 100;
/** Max keys per `remove` call. */
export const REMOVE_BATCH_SIZE = 100;
/** Guard against a pathological/looping listing — stop descending past this. */
export const MAX_FOLDER_DEPTH = 8;

/** Subset of supabase-js `StorageFileApi` we rely on. */
export interface BucketApi {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy?: { column: string; order: string } },
  ): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface StorageCleanupReport {
  bucket: string;
  prefixes: number;
  found: number;
  removed: number;
  errors: string[];
}

/**
 * Recursively collect every object key under `prefix` (no trailing slash).
 * Storage `list` is one level deep: entries with `id === null` are folders.
 */
export async function listAllKeys(
  api: BucketApi,
  prefix: string,
  errors: string[],
  depth = 0,
): Promise<string[]> {
  const keys: string[] = [];
  if (depth > MAX_FOLDER_DEPTH) {
    errors.push(`max depth exceeded at ${prefix}`);
    return keys;
  }
  let offset = 0;
  for (;;) {
    const { data, error } = await api.list(prefix, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      // A bucket that doesn't exist holds no objects: nothing to clean.
      if (!isMissingBucketError(error)) errors.push(`list ${prefix}@${offset}: ${error.message}`);
      break;
    }
    const page = data ?? [];
    for (const entry of page) {
      // Supabase returns a `.emptyFolderPlaceholder` object for empty folders;
      // it is a real object and must be removed too, so no special-casing.
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        keys.push(...(await listAllKeys(api, full, errors, depth + 1)));
      } else {
        keys.push(full);
      }
    }
    if (page.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return keys;
}

/**
 * Best-effort: remove every object under each `prefix/` (no trailing slash)
 * in `bucket`. Never throws — failures land in `report.errors` so the caller
 * can log them and decide (delete-trip aborts, delete-account continues).
 */
export async function cleanupStoragePrefixes(
  api: BucketApi,
  bucket: string,
  prefixes: readonly string[],
): Promise<StorageCleanupReport> {
  const report: StorageCleanupReport = {
    bucket,
    prefixes: prefixes.length,
    found: 0,
    removed: 0,
    errors: [],
  };
  for (const prefix of prefixes) {
    let keys: string[];
    try {
      keys = await listAllKeys(api, prefix, report.errors);
    } catch (e) {
      report.errors.push(`list ${prefix}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    report.found += keys.length;
    for (let i = 0; i < keys.length; i += REMOVE_BATCH_SIZE) {
      const batch = keys.slice(i, i + REMOVE_BATCH_SIZE);
      try {
        const { error } = await api.remove(batch);
        if (error) {
          report.errors.push(`remove ${prefix}[${i}..${i + batch.length}]: ${error.message}`);
        } else {
          report.removed += batch.length;
        }
      } catch (e) {
        report.errors.push(
          `remove ${prefix}[${i}..${i + batch.length}]: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return report;
}

/**
 * Best-effort: remove every object under `<tripId>/` in `bucket` for each
 * trip id (all authors). Same contract as `cleanupStoragePrefixes`.
 */
export function cleanupTripStorage(
  api: BucketApi,
  bucket: string,
  tripIds: readonly string[],
): Promise<StorageCleanupReport> {
  return cleanupStoragePrefixes(api, bucket, tripIds);
}
