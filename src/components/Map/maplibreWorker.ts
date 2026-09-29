/**
 * maplibre-gl v6 worker location (web only).
 *
 * v6 ships ESM-only and loads its worker as a separate module
 * (`maplibre-gl-worker.mjs`, which imports `./maplibre-gl-shared.mjs`). Metro
 * bundles the main thread but not the worker, so `scripts/copy-maplibre-worker.mjs`
 * (npm postinstall) copies both files from node_modules/maplibre-gl/dist into
 * public/maplibre/, which the web export serves as-is. The result is a same-origin
 * module worker, so CSP needs only `worker-src 'self'` and COEP is satisfied
 * because public/_headers covers these files too.
 *
 * Kept free of maplibre imports so Jest can check the copy without loading the ESM package.
 */

/** Directory under public/ (and URL path) that holds the copied worker files. */
export const MAPLIBRE_WORKER_DIR = 'maplibre';

/** Files copied by scripts/copy-maplibre-worker.mjs. They must match node_modules byte for byte. */
export const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

/** Passed to react-maplibre's `workerUrl`, which calls maplibre's setWorkerUrl before creating the map. */
export const MAPLIBRE_WORKER_URL = `/${MAPLIBRE_WORKER_DIR}/${MAPLIBRE_WORKER_FILES[0]}`;
