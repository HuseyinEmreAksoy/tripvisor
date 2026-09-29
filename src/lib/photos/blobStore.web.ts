/**
 * blobStore.web.ts — upload-queue bytes in IndexedDB (M5 Y2.1). See
 * blobStore.types.ts. Degrades to memory (session-only queue) when
 * IndexedDB is unavailable (private mode quirks, SSR, tests); `durable`
 * tells the caller which one it got.
 */

import { createMemoryBlobStore, type PhotoBlobStore } from './blobStore.types';

const DB_NAME = 'tripvisor-photo-queue';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    req.onblocked = () => reject(new Error('indexedDB.open blocked'));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

export function createPhotoBlobStore(): PhotoBlobStore {
  if (typeof indexedDB === 'undefined') return createMemoryBlobStore();
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => (dbPromise ??= openDb());
  const previews = new Map<string, string>();

  const dropPreview = (key: string) => {
    const url = previews.get(key);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      previews.delete(key);
    }
  };

  return {
    durable: true,
    async put(key, bytes) {
      // Store a standalone copy (structured clone of the exact bytes).
      const copy = bytes.slice();
      await run(await db(), 'readwrite', (s) => s.put(copy, key));
    },
    async get(key) {
      const v = await run<unknown>(await db(), 'readonly', (s) => s.get(key));
      if (v instanceof Uint8Array) return v;
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      return null;
    },
    async remove(key) {
      dropPreview(key);
      await run(await db(), 'readwrite', (s) => s.delete(key));
    },
    async keys() {
      const all = await run<IDBValidKey[]>(await db(), 'readonly', (s) => s.getAllKeys());
      return all.filter((k): k is string => typeof k === 'string');
    },
    async previewUri(key) {
      const cached = previews.get(key);
      if (cached) return cached;
      const bytes = await this.get(key);
      if (!bytes || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
      previews.set(key, url);
      return url;
    },
  };
}
