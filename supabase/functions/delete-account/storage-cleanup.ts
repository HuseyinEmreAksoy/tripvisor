// delete-account — Storage cleanup for trips the caller OWNS.
//
// Why this exists: deleting the auth.users row cascades `public.trips` (and
// from there `trip_documents` metadata), but Postgres cascades never reach
// Storage. Without this, every uploaded document of a deleted account would
// stay in the `trip-docs` bucket forever (unreachable via RLS — the policies
// key on `user_can_access_trip(<first path segment>)` and the trip is gone —
// but still billed disk and still personal data we promised to erase).
//
// Buckets cleaned (grep `storage.buckets` in supabase/migrations):
//   - `trip-docs` (0024) — object key convention `<trip_id>/<ts>_<filename>`
//     (see src/api/trip-documents.ts `storagePath`). We list recursively
//     anyway so any nested sub-folder a future writer adds is also removed.
// No other bucket exists: cover photos are a Google place-id pointer (0018,
// bytes proxied live by `place-photo`), and there are no avatar uploads.
//
// Pure w.r.t. its inputs: takes a minimal Storage-bucket interface so the
// Deno test can drive it with a fake instead of the full supabase-js client.

/** Buckets whose object keys are prefixed with `<trip_id>/`. */
export const TRIP_PREFIXED_BUCKETS = ['trip-docs'] as const;

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
      errors.push(`list ${prefix}@${offset}: ${error.message}`);
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
 * Best-effort: remove every object under `<tripId>/` in `bucket` for each
 * trip id. Never throws — failures land in `report.errors` so the caller can
 * log them and still complete the (already irreversible) account deletion.
 */
export async function cleanupTripStorage(
  api: BucketApi,
  bucket: string,
  tripIds: readonly string[],
): Promise<StorageCleanupReport> {
  const report: StorageCleanupReport = {
    bucket,
    prefixes: tripIds.length,
    found: 0,
    removed: 0,
    errors: [],
  };
  for (const tripId of tripIds) {
    let keys: string[];
    try {
      keys = await listAllKeys(api, tripId, report.errors);
    } catch (e) {
      report.errors.push(`list ${tripId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    report.found += keys.length;
    for (let i = 0; i < keys.length; i += REMOVE_BATCH_SIZE) {
      const batch = keys.slice(i, i + REMOVE_BATCH_SIZE);
      try {
        const { error } = await api.remove(batch);
        if (error) {
          report.errors.push(`remove ${tripId}[${i}..${i + batch.length}]: ${error.message}`);
        } else {
          report.removed += batch.length;
        }
      } catch (e) {
        report.errors.push(
          `remove ${tripId}[${i}..${i + batch.length}]: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  return report;
}
