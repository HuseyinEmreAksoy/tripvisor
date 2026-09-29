// memories-sweep — the pure sweep loop (M5 Y2.1, 0038 §2d follow-up).
//
// Orphans = objects in the private `trip-memories` bucket with NO
// trip_photos row (rows purged by the hourly pending purge, hard-deleted
// rows, cascades), plus (0040) objects of long-tombstoned photos. SQL must
// not delete Storage objects (storage.protect_delete
// blocks it, and a SQL delete would only drop the metadata row and leave the
// file in the object store), so this function removes them through the
// Storage API instead. They keep counting against the author's byte quota
// and the project-wide 900 MiB guard until removed.
//
// Candidates come from rpc('trip_memories_sweep_candidates', {p_min_age,
// p_limit}) (0038, service-role EXECUTE only): objects older than p_min_age
// (default 1 h — protects a just-deleted row that a client retry re-inserts
// with the same id), oldest first, <= 1000 per call. Since 0040 the list also
// holds the objects of photos TOMBSTONED more than 7 days ago (a device that
// never came back online, or a revoked member who can no longer delete their
// files). Younger tombstones keep their objects (the undo window; the
// author's client normally removes them right away), and an un-delete after
// the sweep keeps the row deleted (0040 §2 trigger). Removing a name that no
// longer exists is not an error: the sweep is idempotent and safe to overlap.
//
// Pure w.r.t. I/O: everything goes through SweepDeps (handler.ts wires the
// service-role supabase-js client), so index.test.ts drives it with fakes.

export const SWEEP_BUCKET = 'trip-memories';
/** Storage `remove` accepts at most 1000 names per request (and the RPC caps p_limit at 1000). */
export const MAX_BATCH = 1000;
export const DEFAULT_BATCH = 1000;
export const DEFAULT_MAX_BATCHES = 5;
export const MAX_MAX_BATCHES = 20;
/** Never sweep objects younger than this (an in-flight upload's row may be about to exist). */
export const MIN_AGE_FLOOR_MINUTES = 60;
export const DEFAULT_MIN_AGE_MINUTES = 60;

export interface SweepCandidate {
  name: string;
  bytes: number;
  created_at: string;
}

export interface SweepDeps {
  /** rpc('trip_memories_sweep_candidates', { p_min_age, p_limit }) */
  candidates(minAge: string, limit: number): Promise<{ data: SweepCandidate[] | null; error: string | null }>;
  /** storage.from('trip-memories').remove(names) → the names Storage reports as deleted. */
  remove(names: string[]): Promise<{ removed: string[]; error: string | null }>;
}

export interface SweepOptions {
  minAgeMinutes: number;
  batchSize: number;
  maxBatches: number;
  dryRun: boolean;
}

export interface SweepReport {
  batches: number;
  candidates: number;
  removed: number;
  /** Bytes freed (sum of the removed candidates' metadata sizes). */
  bytes: number;
  /** true when the last batch was full and maxBatches stopped the loop (more to do next run). */
  more: boolean;
  errors: string[];
}

export function clampOptions(input: Partial<SweepOptions>): SweepOptions {
  const minAge = Math.max(MIN_AGE_FLOOR_MINUTES, Math.floor(input.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES));
  const batch = Math.min(MAX_BATCH, Math.max(1, Math.floor(input.batchSize ?? DEFAULT_BATCH)));
  const maxBatches = Math.min(MAX_MAX_BATCHES, Math.max(1, Math.floor(input.maxBatches ?? DEFAULT_MAX_BATCHES)));
  return { minAgeMinutes: minAge, batchSize: batch, maxBatches, dryRun: input.dryRun === true };
}

/**
 * Remove orphaned trip-memories objects in batches of <= 1000. Stops when a
 * batch comes back short (nothing older left), after maxBatches, on any
 * error, or when a batch removed nothing (no progress → never spin on the
 * same names). A dry run lists one batch and removes nothing.
 */
export async function runSweep(deps: SweepDeps, opts: SweepOptions): Promise<SweepReport> {
  const report: SweepReport = { batches: 0, candidates: 0, removed: 0, bytes: 0, more: false, errors: [] };
  const minAge = `${opts.minAgeMinutes} minutes`;
  for (let i = 0; i < opts.maxBatches; i++) {
    const { data, error } = await deps.candidates(minAge, opts.batchSize);
    if (error) {
      report.errors.push(`candidates: ${error}`);
      break;
    }
    const rows = (data ?? []).filter((r) => r && typeof r.name === 'string' && r.name.length > 0);
    report.batches++;
    report.candidates += rows.length;
    if (rows.length === 0) break;
    if (opts.dryRun) {
      report.more = rows.length >= opts.batchSize;
      break;
    }
    const names = rows.map((r) => r.name).slice(0, MAX_BATCH);
    const res = await deps.remove(names);
    if (res.error) {
      report.errors.push(`remove: ${res.error}`);
      break;
    }
    const gone = new Set(res.removed);
    report.removed += gone.size;
    for (const r of rows) if (gone.has(r.name) && Number.isFinite(r.bytes)) report.bytes += r.bytes;
    if (gone.size === 0) {
      report.errors.push('no_progress: remove() deleted nothing; stopping to avoid a loop');
      break;
    }
    if (rows.length < opts.batchSize) break;
    if (i === opts.maxBatches - 1) report.more = true;
  }
  return report;
}
