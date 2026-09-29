/**
 * blobStore.types.ts — durable byte storage for the photo upload queue
 * (M5 Y2.1). Holds ONLY re-encoded, metadata-stripped JPEGs (never an
 * original) until their upload finishes, so a queued photo survives an app
 * restart or a reload:
 *   - native: files under <documentDirectory>/tripvisor-photo-queue/
 *     (document dir, not cache: the OS may purge the cache while offline)
 *   - web: an IndexedDB object store (localStorage's ~5 MB could not hold
 *     20 pending photos)
 *   - fallback (IndexedDB blocked / tests): in-memory, session-only.
 * Keys are `<userId>/<photoId>` and `<userId>/<photoId>_t`.
 */

export interface PhotoBlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** Every stored key (orphan cleanup at queue start). */
  keys(): Promise<string[]>;
  /** A displayable URI for the stored image (file:// or blob:), or null. */
  previewUri(key: string): Promise<string | null>;
  /** false when bytes only live in memory (lost on restart). */
  readonly durable: boolean;
}

/** In-memory store: tests, and the degrade path when IndexedDB is unavailable. */
export function createMemoryBlobStore(): PhotoBlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    durable: false,
    async put(key, bytes) {
      map.set(key, bytes.slice());
    },
    async get(key) {
      const v = map.get(key);
      return v ? v.slice() : null;
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async previewUri() {
      return null;
    },
  };
}
