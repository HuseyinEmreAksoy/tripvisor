/**
 * Metro config — required for expo-sqlite on web (v2 S2, risk R5).
 *
 * expo-sqlite's web implementation ships wa-sqlite as a .wasm binary
 * (expo-sqlite/web/worker.ts → ./wa-sqlite/wa-sqlite.wasm). Metro only
 * resolves extensions it knows about; without `wasm` in assetExts,
 * `expo export --platform web` fails at that import. Registering it as an
 * asset makes Metro copy the binary and hand expo-sqlite a URL to fetch.
 *
 * The dev-server middleware adds COOP/COEP so SharedArrayBuffer exists in
 * local dev — expo-sqlite's synchronous web API needs cross-origin
 * isolation (see src/sync/persistence.web.ts). COEP is `credentialless`,
 * not `require-corp`: map tiles, fonts, and other cross-origin subresources
 * keep loading without CORP headers. Production (Cloudflare Pages) gets the
 * SAME pair via `public/_headers` (S2.8.10) — `expo export --platform web`
 * copies public/ verbatim into dist/, and Pages applies the rules on deploy.
 * The Pages `_headers` format has no comment syntax (non-indented lines are
 * parsed as URL patterns), so this block is the rationale for both files.
 * Safari has no `credentialless` support and stays on the in-memory degrade
 * path per the R5 contract — surfaced honestly by the sync-status sheet.
 *
 * The same middleware answers HEAD requests for page paths itself (dev
 * server only). With `web.output: "static"`, `expo start` server-renders
 * EVERY page request on the fly: it serializes the whole client bundle to
 * collect its script tags, then evaluates a fresh copy of the ~4k-module SSR
 * bundle (`λ render.js`). @react-native-community/netinfo's web reachability
 * probe is `fetch('/', { method: 'HEAD' })` from every open tab: every 60 s
 * while reachable, every 5 s after a failure, each aborted after 15 s. Once a
 * render takes > 15 s (cold cache, a rebuild, a busy machine) the probes stop
 * completing, every tab drops to the 5 s cadence, and the aborted renders keep
 * running and pile up until Node runs out of heap ("Premature close" spam,
 * then "JavaScript heap out of memory" — reproduced with only idle tabs open:
 * 102 probes, 0 answered, 4 GB heap exhausted in under 3 minutes). A HEAD
 * response has no body, so rendering the page for it is pure waste: answer
 * it with 200 straight away. GET renders, bundles, assets and public/ files
 * are untouched. Production is a static Pages deploy, where HEAD / is already
 * a cheap file lookup.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

/** Page routes are extension-less (`/`, `/trips`, `/trip/abc`); files, bundles and assets are not. */
function isPagePath(url) {
  const pathname = String(url || '/').split(/[?#]/, 1)[0];
  return !pathname.slice(pathname.lastIndexOf('/') + 1).includes('.');
}

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    if (req.method === 'HEAD' && isPagePath(req.url)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    return middleware(req, res, next);
  },
};

module.exports = config;
