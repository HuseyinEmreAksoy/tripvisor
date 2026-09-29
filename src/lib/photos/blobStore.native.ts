/**
 * blobStore.native.ts — upload-queue bytes as files in the app's DOCUMENT
 * directory (expo-file-system v19 File/Directory API). See blobStore.types.ts.
 */

import { Directory, File, Paths } from 'expo-file-system';
import type { PhotoBlobStore } from './blobStore.types';

const DIR_NAME = 'tripvisor-photo-queue';

/** `<userId>/<photoId>[_t]` → a flat, filesystem-safe name. */
function fileName(key: string): string {
  return `${key.replace(/[^A-Za-z0-9_-]/g, '__')}.jpg`;
}

function keyFromFileName(name: string): string | null {
  if (!name.endsWith('.jpg')) return null;
  return name.slice(0, -4).replace(/__/g, '/');
}

export function createPhotoBlobStore(): PhotoBlobStore {
  let dir: Directory | null = null;
  const ensureDir = (): Directory => {
    if (!dir) {
      dir = new Directory(Paths.document, DIR_NAME);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    }
    return dir;
  };
  const fileFor = (key: string): File => new File(ensureDir(), fileName(key));

  return {
    durable: true,
    async put(key, bytes) {
      const f = fileFor(key);
      if (f.exists) f.delete();
      f.create();
      f.write(bytes);
    },
    async get(key) {
      const f = fileFor(key);
      if (!f.exists) return null;
      return f.bytes();
    },
    async remove(key) {
      const f = fileFor(key);
      if (f.exists) f.delete();
    },
    async keys() {
      const d = ensureDir();
      const out: string[] = [];
      for (const entry of d.list()) {
        if (entry instanceof File) {
          const k = keyFromFileName(entry.name);
          if (k) out.push(k);
        }
      }
      return out;
    },
    async previewUri(key) {
      const f = fileFor(key);
      return f.exists ? f.uri : null;
    },
  };
}
