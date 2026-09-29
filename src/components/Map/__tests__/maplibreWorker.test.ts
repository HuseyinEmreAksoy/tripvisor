/**
 * maplibre-gl v6 self-hosted worker: guards the copy in public/maplibre/.
 *
 * The main thread comes from Metro's bundle of node_modules/maplibre-gl; the
 * worker comes from public/maplibre/ (see ../maplibreWorker.ts). If the two
 * come from different maplibre versions, the worker protocol can break without
 * any error. These checks fail if the copy drifts, if the postinstall hook that
 * refreshes it is removed, or if maplibre-gl falls back into the
 * GHSA-jrc7-96c5-q579 range (DOM.sanitize XSS, <= 6.4.0).
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  MAPLIBRE_WORKER_DIR,
  MAPLIBRE_WORKER_FILES,
  MAPLIBRE_WORKER_URL,
} from '../maplibreWorker';

const ROOT = path.resolve(__dirname, '../../../..');
const PUBLIC_DIR = path.join(ROOT, 'public', MAPLIBRE_WORKER_DIR);
const DIST_DIR = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const COPY_HINT = 'run `node scripts/copy-maplibre-worker.mjs` (npm postinstall does this)';

function parseVersion(v: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = (v.split('-')[0] ?? '').split('.').map(Number);
  return [major, minor, patch];
}

describe('maplibre-gl v6 worker (web)', () => {
  it('points workerUrl at the copied worker module under public/', () => {
    expect(MAPLIBRE_WORKER_URL).toBe('/maplibre/maplibre-gl-worker.mjs');
    expect(existsSync(path.join(ROOT, 'public', ...MAPLIBRE_WORKER_URL.split('/').filter(Boolean)))).toBe(true);
  });

  it.each([...MAPLIBRE_WORKER_FILES])('public/maplibre/%s is byte-identical to node_modules/maplibre-gl/dist', (file: string) => {
    const copied = path.join(PUBLIC_DIR, file);
    if (!existsSync(copied)) throw new Error(`public/maplibre/${file} is missing: ${COPY_HINT}`);
    const same = readFileSync(copied).equals(readFileSync(path.join(DIST_DIR, file)));
    if (!same) throw new Error(`public/maplibre/${file} differs from the installed maplibre-gl: ${COPY_HINT}`);
  });

  it('every relative import of the copied modules resolves inside public/maplibre/', () => {
    const imported = MAPLIBRE_WORKER_FILES.flatMap((file) => {
      const src = readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
      return [...src.matchAll(/(?:from|import)\s*["'`](\.\/[^"'`]+)["'`]/g)].map((m) => (m[1] ?? '').slice(2));
    });
    // The worker imports the shared chunk; a new chunk must be added to the copy list.
    expect(imported).toContain(MAPLIBRE_WORKER_FILES[1]);
    for (const file of imported) {
      expect([...MAPLIBRE_WORKER_FILES]).toContain(file);
    }
  });

  it('npm postinstall keeps the copy in sync', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.postinstall).toContain('node scripts/copy-maplibre-worker.mjs');
  });

  it('installed maplibre-gl is outside the GHSA-jrc7-96c5-q579 range (<= 6.4.0)', () => {
    const { version } = JSON.parse(
      readFileSync(path.join(ROOT, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'),
    ) as { version: string };
    const [major, minor, patch] = parseVersion(version);
    const fixed = major > 6 || (major === 6 && (minor > 4 || (minor === 4 && patch >= 1)));
    expect({ version, fixed }).toEqual({ version, fixed: true });
  });
});
