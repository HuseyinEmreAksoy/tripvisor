/**
 * persistGuard.ts — defense-in-depth wrapper around Legend-State's
 * observablePersistSqlite (used by persistence.web.ts AND
 * persistence.native.ts).
 *
 * ── The invariant
 * A persisted table that is corrupt, unreadable or empty must NEVER be
 * combined with an incremental `changesSince: 'last-sync'` watermark. If
 * it were, the next pull would ask only for rows changed since the
 * watermark, and every older row would silently vanish from the store.
 * The server is the source of truth, so the fix is cheap: drop the
 * watermark and let the next pull be a FULL pull.
 *
 * ── Why a wrapper is needed
 * Upstream `ObservablePersistSqlite.getTable` catches read/parse errors,
 * logs "[legend-state] ObservablePersistSqlite failed to parse <table>",
 * and returns `undefined`. That looks the same as "nothing persisted".
 * Its `getMetadata` (the separate `<table>__m` key, which is small and
 * therefore parses fine) still returns the old `lastSync`. That is exactly
 * the web data-loss bug from 2026-09-29: the expo-sqlite 16.0.10
 * WorkerChannel truncated sync-read lengths to one byte, so every table
 * value over 255 bytes failed to parse. patches/expo-sqlite+16.0.10.patch
 * fixes the root cause. This guard makes the engine safe against any
 * future read failure (a new upstream bug, a truncated OPFS file, a value
 * above the 1 MiB web channel ceiling, and so on).
 *
 * Legend-State (3.0.0-beta.47 sync.js loadLocal) calls getTable(table)
 * and then getMetadata(table) synchronously. getMetadata also runs the
 * table check itself if it hasn't happened yet, so the guard does not
 * depend on that order.
 *
 * `pending` (the retrySync offline write queue) is kept. Only `lastSync`
 * is removed, so no unacked offline write is lost.
 *
 * ── Size ceiling (documented, not redesigned)
 * Each table is stored whole, as ONE JSON kv value. On web, a synchronous
 * read travels over expo-sqlite's 1 MiB SharedArrayBuffer result channel
 * (4 bytes of that are the length header, and JSON escaping adds more).
 * A value above the ceiling now fails loudly ("result too large for sync
 * channel", from our patch) instead of truncating silently. The guard
 * treats that as unreadable, so the table falls back to a full pull on
 * every cold start. It stays correct, but offline cold start for that
 * table stops working. Values over LARGE_VALUE_WARN_BYTES (512 KiB) leave
 * a telemetry breadcrumb, once per key per session, so we see heavy users
 * well before they reach the ceiling. Native reads over JSI have no such
 * ceiling.
 */

import type { ObservablePersistPlugin, PersistMetadata, PersistOptions } from '@legendapp/state/sync';
import { recordPersistValueLarge, recordPersistWatermarkReset } from './telemetry';

/** Minimal synchronous kv surface observablePersistSqlite uses. */
export interface SyncKvStorage {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): void;
}

const METADATA_SUFFIX = '__m';
/** expo-sqlite web sync channel: 1 MiB SAB minus the 4-byte length header. */
export const WEB_SYNC_READ_LIMIT_BYTES = 1024 * 1024 - 4;
export const LARGE_VALUE_WARN_BYTES = 512 * 1024;

type TableHealth = 'ok' | 'empty' | 'unreadable' | 'unparseable';

/** Table segment of `tier1/<userId>/<table>`. Keeps userIds out of telemetry. */
function tableLabel(key: string): string {
  const i = key.lastIndexOf('/');
  return i >= 0 ? key.slice(i + 1) : key;
}

/**
 * UTF-8 byte length, computed only near the threshold. string.length is a
 * lower bound (1 byte per UTF-16 unit at best) and 3 * length is an upper
 * bound, so most saves skip the encode.
 */
function utf8Bytes(value: string): number {
  if (value.length * 3 < LARGE_VALUE_WARN_BYTES) return value.length;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}

/** Wrap the raw kv store: measures every write for the size breadcrumb. */
export function guardStorage(storage: SyncKvStorage): SyncKvStorage {
  const warned = new Set<string>();
  return {
    getItemSync: (key) => storage.getItemSync(key),
    removeItemSync: (key) => storage.removeItemSync(key),
    setItemSync: (key, value) => {
      if (!key.endsWith(METADATA_SUFFIX) && !warned.has(key)) {
        const bytes = utf8Bytes(value);
        if (bytes > LARGE_VALUE_WARN_BYTES) {
          warned.add(key);
          recordPersistValueLarge(tableLabel(key), bytes, WEB_SYNC_READ_LIMIT_BYTES);
        }
      }
      storage.setItemSync(key, value);
    },
  };
}

function isEmptyTableValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'object' && Object.keys(value as object).length === 0)
  );
}

/**
 * Wrap an ObservablePersistPlugin so that a corrupt, unreadable or empty
 * persisted table never keeps its last-sync watermark. `storage` must be
 * the same kv store the inner plugin reads from. It is only probed when
 * the inner plugin reports "no value", to tell "absent" apart from
 * "failed to load".
 */
export function guardPersistPlugin(
  inner: ObservablePersistPlugin,
  storage: SyncKvStorage,
): ObservablePersistPlugin {
  const health = new Map<string, { status: TableHealth; detail?: string }>();

  const classify = (table: string, value: unknown): void => {
    if (!isEmptyTableValue(value)) {
      health.set(table, { status: 'ok' });
      return;
    }
    if (value !== undefined) {
      health.set(table, { status: 'empty' });
      return;
    }
    // The inner plugin returned undefined: either nothing is stored, or it
    // swallowed a read/parse error. Probe to find out which.
    let raw: string | null;
    try {
      raw = storage.getItemSync(table);
    } catch (e) {
      health.set(table, { status: 'unreadable', detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (raw === null || raw === '') {
      health.set(table, { status: 'empty' });
      return;
    }
    try {
      JSON.parse(raw);
      // Parses now, even though the inner plugin failed on it: a transient
      // read failure. Still treat it as unusable for this session, because
      // the store did NOT receive this value.
      health.set(table, { status: 'unreadable', detail: 'inner plugin returned no value' });
    } catch {
      health.set(table, { status: 'unparseable', detail: `${raw.length} chars` });
    }
  };

  const guarded: ObservablePersistPlugin = {
    getTable<T>(table: string, init: object, config: PersistOptions): T {
      const value = inner.getTable<T>(table, init, config);
      if (!table.endsWith(METADATA_SUFFIX)) classify(table, value);
      return value;
    },
    getMetadata(table: string, config: PersistOptions): PersistMetadata {
      // Order independence: run the table check if getTable hasn't yet.
      if (!health.has(table)) {
        classify(table, inner.getTable<unknown>(table, undefined as unknown as object, config));
      }
      // The interface says non-optional, but the sqlite plugin returns
      // undefined when the metadata key itself fails to parse.
      const metadata = inner.getMetadata(table, config) as PersistMetadata | undefined;
      const h = health.get(table);
      if (!metadata || metadata.lastSync === undefined || !h || h.status === 'ok') {
        return metadata as PersistMetadata;
      }

      const cleaned: PersistMetadata = { ...metadata };
      delete cleaned.lastSync;
      // Persist the removal, so a crash before the next pull can't bring the
      // watermark back. A failed setMetadata write is fine: the in-memory
      // metadata Legend-State keeps already lacks lastSync, so this
      // session's pull is full either way.
      try {
        void inner.setMetadata(table, cleaned, config);
      } catch {
        // best-effort
      }
      recordPersistWatermarkReset(
        tableLabel(table),
        h.status === 'empty' ? 'empty' : h.status,
        h.detail,
      );
      return cleaned;
    },
    set: (table, changes, config) => inner.set(table, changes, config),
    setMetadata: (table, metadata, config) => inner.setMetadata(table, metadata, config),
    deleteTable: (table, config) => {
      health.delete(table);
      return inner.deleteTable(table, config);
    },
    deleteMetadata: (table, config) => inner.deleteMetadata(table, config),
  };
  if (inner.initialize) guarded.initialize = inner.initialize.bind(inner);
  if (inner.loadTable) guarded.loadTable = inner.loadTable.bind(inner);
  return guarded;
}
