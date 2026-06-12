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
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  },
};

module.exports = config;
