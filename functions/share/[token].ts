/**
 * Cloudflare Pages Function — /share/<token> link previews for crawlers.
 *
 * The static export prerenders /share/[token] without trip data, so plain-HTML
 * unfurlers (WhatsApp, Facebook, Slack's bot, X, LinkedIn) only ever saw the
 * site-wide baseline tags. This function serves the exported shell and uses
 * HTMLRewriter to swap in per-trip <title>, description, og:* and twitter:*
 * values, read from the public `share-trip` Edge Function (`op: "read"`, the
 * same anonymous call `useSharedTrip` makes in src/api/share.ts).
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
 *   re-applies the COOP/COEP pair from public/_headers.
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

interface SharedTripPayload {
  trip?: OgTrip | null;
  places?: unknown[] | null;
}

async function fetchSharedTrip(env: Env, token: string): Promise<SharedTripPayload | null> {
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
      body: JSON.stringify({ op: 'read', token }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SharedTripPayload;
  } finally {
    clearTimeout(timer);
  }
}

function metaTag(attr: 'name' | 'property', key: string, content: string): string {
  // data-rh keeps the tag owned by expo-router's Head manager after hydration.
  return `<meta data-rh="true" ${attr}="${key}" content="${escapeHtml(content)}"/>`;
}

function withHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  // Mirrors public/_headers, which Pages does not apply to Function responses.
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
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
        ? fetchSharedTrip(context.env, token).catch(() => null)
        : Promise.resolve(null),
    ]);
    shell = shellRes;
    if (!shell) return withHeaders(await context.next());
    if (!shared?.trip) return withHeaders(shell);

    const meta = buildShareOgMeta(shared.trip, Array.isArray(shared.places) ? shared.places.length : 0);
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
