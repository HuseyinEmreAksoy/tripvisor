#!/usr/bin/env node
/**
 * Copies maplibre-gl's worker module (+ the shared chunk it imports) into
 * public/maplibre/ so the web build serves it same-origin. Runs on
 * `postinstall`, so a maplibre-gl upgrade refreshes the copy automatically.
 *
 * Why: maplibre-gl v6 is ESM-only and no longer inlines its worker as a
 * blob. The worker is a separate module (`maplibre-gl-worker.mjs`, which
 * imports `./maplibre-gl-shared.mjs`). Metro bundles the main thread but not
 * the worker, so MapLibreMap.web.tsx points `workerUrl` at this copy. The
 * worker and the bundled main thread must come from the SAME maplibre-gl
 * version; src/components/Map/__tests__/maplibreWorker.test.ts fails if the
 * copy drifts from node_modules.
 *
 * Same-origin module worker => CSP `worker-src 'self'` and COEP-compatible
 * (public/_headers applies COEP to these files too).
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'maplibre-gl', 'dist');
const outDir = join(root, 'public', 'maplibre');
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

for (const file of FILES) {
  if (!existsSync(join(srcDir, file))) {
    console.error(
      `[copy-maplibre-worker] ${file} not found in node_modules/maplibre-gl/dist. ` +
        'The web map needs maplibre-gl >= 6 (ESM build with a separate worker).',
    );
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(srcDir, file), join(outDir, file));
}
console.log(`[copy-maplibre-worker] copied ${FILES.join(', ')} -> public/maplibre/`);
