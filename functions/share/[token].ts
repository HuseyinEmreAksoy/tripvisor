/**
 * Cloudflare Pages Function — /share/<token> link previews for crawlers.
 *
 * The static export prerenders /share/[token] without trip data, so plain-HTML
 * unfurlers (WhatsApp, Facebook, Slack's bot, X, LinkedIn) only ever saw the
 * site-wide baseline tags. This function serves the exported shell and uses
 * HTMLRewriter to swap in per-trip <title>, description, og:* and twitter:*
 * values, read from the public `share-trip` Edge Function with the light
 * `op: "meta"` (share-trip contract v4: title, dates and place count only; no
 * memories, no photo signing, its own per-link rate limit). The full
 * `op: "read"` is left to the page itself (`useSharedTrip`), so an unfurl
 * never spends the link's read budget.
 *
 * FAIL OPEN: any error, timeout, missing env or unknown/revoked token returns
 * the unmodified shell, so the page itself always works.
 *
 * Pages env vars (Settings → Environment variables, Production + Preview):
 *   SUPABASE_URL       e.g. https://<project-ref>.supabase.co
 *   SUPABASE_ANON_KEY  the public anon key (same value as EXPO_PUBLIC_SUPABASE_ANON_KEY)
 *
 * Notes on Pages semantics:
 * - `_redirects` and `_headers` are NOT applied to responses from a Function
 *   route, so this file fetches the `share/[token].html` shell itself and
 *   re-applies every header from public/_headers (COOP/COEP + security
 *   headers incl. CSP, see SECURITY_HEADERS).
 * - Built by wrangler, never by Metro (Expo Router only scans app/). Runtime
 *   types are declared locally so the app's `tsc` needs no Workers typings.
 */
import { buildShareOgMeta, escapeHtml, type OgTrip } from '../../src/components/share/ogMeta';

// ── Minimal Workers / Pages typings (the app tsconfig has no workers-types) ──

interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  ASSETS: AssetFetcher;
}

interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

interface RewriterElement {
  replace(content: string, options?: { html?: boolean }): void;
}

declare class HTMLRewriter {
  on(selector: string, handlers: { element?(element: RewriterElement): void }): HTMLRewriter;
  transform(response: Response): Response;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TRIP_FETCH_TIMEOUT_MS = 2500;
const SHELL_PATHS = ['/share/[token]', '/share/[token].html'];

/** Fetch the exported share shell from static assets, following same-origin redirects. */
async function fetchShell(context: PagesContext): Promise<Response | null> {
  const base = new URL(context.request.url);
  for (const path of SHELL_PATHS) {
    let url = new URL(path, base);
    for (let hop = 0; hop < 3; hop += 1) {
      const res = await context.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', redirect: 'manual' }));
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) return res;
      break;
    }
  }
  return null;
}

/** share-trip `op: "meta"` answer (contract v4). */
interface SharedTripMeta {
  trip?: OgTrip | null;
  placeCount?: number | null;
}

/**
 * Title / dates / place count of a live link, or null (unknown or revoked
 * token, rate limited, server too old for `meta`, timeout, missing env): the
 * caller then serves the untouched shell.
 */
async function fetchShareMeta(env: Env, token: string): Promise<SharedTripMeta | null> {
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/share-trip`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ op: 'meta', token }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SharedTripMeta;
  } finally {
    clearTimeout(timer);
  }
}

function metaTag(attr: 'name' | 'property', key: string, content: string): string {
  // data-rh keeps the tag owned by expo-router's Head manager after hydration.
  return `<meta data-rh="true" ${attr}="${key}" content="${escapeHtml(content)}"/>`;
}

/**
 * Content-Security-Policy, one directive per entry. The `/*` rule in
 * public/_headers must carry the same string (Jest parity test:
 * src/components/share/__tests__/securityHeaders.test.ts).
 *
 * - script-src: our bundles only. `'wasm-unsafe-eval'` lets expo-sqlite
 *   compile wa-sqlite. The one inline script Expo's static export emits
 *   (`globalThis.__EXPO_ROUTER_HYDRATE__=true;`, identical on every page) is
 *   allowed by hash, so no `'unsafe-inline'` and no `'unsafe-eval'`.
 * - style-src `'unsafe-inline'`: React Native Web injects <style> tags at
 *   runtime and the export has inline style attributes.
 * - img-src https:: Supabase storage and place-photo URLs, OSM/Wikipedia
 *   imagery. Images can't run script.
 * - connect-src: Supabase REST/Auth/Functions/Storage plus Realtime (wss),
 *   the OpenFreeMap style, tiles, sprites and glyphs (all on
 *   tiles.openfreemap.org), and Sentry ingest (US, DE, legacy). `blob:`/`data:`
 *   allow fetch() of locally created files (picked photos, exports). Open-Meteo
 *   is not listed because weather goes through the `weather` Edge Function.
 * - worker-src: `'self'` for maplibre-gl v6's module worker
 *   (/maplibre/*.mjs); `blob:` for Expo's worker wrapper (expo-sqlite), which
 *   uses a blob: URL when crossOriginIsolated.
 * - NOT allowed: the legacy Google Maps JS web provider. Its documented CSP
 *   needs `'unsafe-eval'` and `'unsafe-inline'` scripts. Flipping
 *   app_config.map_provider_web to 'google' means extending this policy on
 *   purpose, in both places.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://tiles.openfreemap.org https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Mirrors the `/*` rule in public/_headers, which Pages does not apply to
 * Function responses. COOP/COEP keep the page cross-origin isolated for
 * expo-sqlite.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
};

function withHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function onRequestGet(context: PagesContext): Promise<Response> {
  let shell: Response | null = null;
  try {
    const raw = context.params.token;
    const token = Array.isArray(raw) ? raw[0] : raw;

    const [shellRes, shared] = await Promise.all([
      fetchShell(context),
      token && TOKEN_RE.test(token)
        ? fetchShareMeta(context.env, token).catch(() => null)
        : Promise.resolve(null),
    ]);
    shell = shellRes;
    if (!shell) return withHeaders(await context.next());
    if (!shared?.trip) return withHeaders(shell);

    const placeCount =
      typeof shared.placeCount === 'number' && Number.isInteger(shared.placeCount) && shared.placeCount > 0
        ? shared.placeCount
        : 0;
    const meta = buildShareOgMeta(shared.trip, placeCount);
    const pageUrl = new URL(context.request.url);
    const canonical = `${pageUrl.origin}${pageUrl.pathname}`;

    const replaceWith = (html: string) => ({
      element(el: RewriterElement) {
        el.replace(html, { html: true });
      },
    });

    const rewritten = new HTMLRewriter()
      .on('title', replaceWith(`<title data-rh="true">${escapeHtml(meta.title)}</title>`))
      .on('meta[name="description"]', replaceWith(metaTag('name', 'description', meta.description)))
      .on('meta[property="og:type"]', replaceWith(metaTag('property', 'og:type', 'article')))
      .on('meta[property="og:title"]', replaceWith(metaTag('property', 'og:title', meta.title)))
      .on('meta[property="og:description"]', replaceWith(metaTag('property', 'og:description', meta.description)))
      .on('meta[property="og:url"]', replaceWith(metaTag('property', 'og:url', canonical)))
      .on('meta[name="twitter:title"]', replaceWith(metaTag('name', 'twitter:title', meta.title)))
      .on('meta[name="twitter:description"]', replaceWith(metaTag('name', 'twitter:description', meta.description)))
      .transform(shell.clone());

    const headers = new Headers(rewritten.headers);
    headers.delete('content-length');
    // Trip titles change and links get revoked — keep edge/browser caches short.
    headers.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    return withHeaders(new Response(rewritten.body, { status: 200, headers }));
  } catch {
    // Fail open: the untouched shell (or whatever Pages would have served).
    try {
      return withHeaders(shell ?? (await context.next()));
    } catch {
      return context.next();
    }
  }
}

// Some unfurlers probe with HEAD first; without this, HEAD would fall through
// to static assets, where `_redirects` does not apply to a Function route.
export const onRequestHead = onRequestGet;
