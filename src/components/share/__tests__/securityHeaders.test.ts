/**
 * @jest-environment node
 *
 * Security headers: public/_headers vs the /share/<token> Pages Function.
 *
 * Pages does not apply _headers to Function responses, so
 * functions/share/[token].ts re-sets every header itself. This suite makes
 * the Function's output match the `/*` rule exactly and checks the CSP
 * invariants the web app depends on. The CSP rationale lives next to
 * SECURITY_HEADERS in the Function file.
 */
import { describe, expect, it } from '@jest/globals';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { onRequestGet } from '../../../../functions/share/[token]';

const ROOT = path.resolve(__dirname, '../../../..');

/** Minimal Cloudflare Pages `_headers` parser: `#` comments, URL lines, indented `Name: value`. */
function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = new Map();
      rules.set(raw.trim(), current);
      continue;
    }
    if (!current) throw new Error(`header line before any URL pattern: ${raw}`);
    const idx = raw.indexOf(':');
    current.set(raw.slice(0, idx).trim().toLowerCase(), raw.slice(idx + 1).trim());
  }
  return rules;
}

function siteWideHeaders(): Map<string, string> {
  const rules = parseHeadersFile(readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8'));
  const all = rules.get('/*');
  if (!all) throw new Error('public/_headers has no `/*` rule');
  return all;
}

function cspDirectives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name, values] as [string, string[]]),
  );
}

/** Body of the inline <script> Expo's static export injects into every page. */
function expoHydrateScriptBody(): string {
  const expoDir = path.dirname(require.resolve('expo/package.json'));
  const serializeHtml = require.resolve('@expo/cli/build/src/start/server/metro/serializeHtml.js', {
    paths: [expoDir, ROOT],
  });
  const match = readFileSync(serializeHtml, 'utf8').match(/<script type="module">([^<]*)<\/script>/);
  if (!match?.[1]) {
    throw new Error(
      'Expo changed how it emits the inline hydrate <script>. Re-run a web export, hash every inline ' +
        'script (sha256, base64) and update script-src in public/_headers and functions/share/[token].ts.',
    );
  }
  return match[1];
}

type Ctx = Parameters<typeof onRequestGet>[0];

function makeContext(assets: (url: string) => Response): Ctx {
  return {
    request: new Request('https://tripvisor.pages.dev/share/abcdefgh1234'),
    env: { ASSETS: { fetch: async (input: Request | string | URL) => assets(String(input instanceof Request ? input.url : input)) } },
    params: { token: 'abcdefgh1234' },
    next: async () => new Response('fallback', { status: 200, headers: { 'content-type': 'text/html' } }),
  };
}

const SHELL = '<!doctype html><html><head><title>Tripvisor</title></head><body></body></html>';

describe('security headers', () => {
  it('keeps the COOP/COEP pair that offline sync needs', () => {
    const h = siteWideHeaders();
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(h.get('cross-origin-embedder-policy')).toBe('credentialless');
  });

  it('sends the anti-clickjacking / hardening headers on every route', () => {
    const h = siteWideHeaders();
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(self), payment=()');
    expect(h.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(h.get('content-security-policy')).toBeTruthy();
  });

  it('keeps every _headers line under the Pages 2,000-character limit', () => {
    for (const line of readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8').split(/\r?\n/)) {
      expect(line.length).toBeLessThanOrEqual(2000);
    }
  });

  const functionCases: Array<[string, (url: string) => Response]> = [
    ['share shell served (fail-open, no Supabase env)', (url: string) =>
      url.includes('/share/[token]')
        ? new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new Response('nope', { status: 404 })],
    ['shell missing (falls through to context.next())', () => new Response('nope', { status: 404 })],
  ];

  it.each(functionCases)('the /share Function mirrors public/_headers exactly: %s', async (_label, assets) => {
    const res = await onRequestGet(makeContext(assets));
    for (const [name, value] of siteWideHeaders()) {
      expect([name, res.headers.get(name)]).toEqual([name, value]);
    }
  });

  describe('Content-Security-Policy', () => {
    const csp = cspDirectives(siteWideHeaders().get('content-security-policy') ?? '');

    it('allows no inline or eval script except the hashed Expo hydrate snippet', () => {
      const scriptSrc = csp.get('script-src') ?? [];
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(scriptSrc).toContain("'self'");
      // wa-sqlite (expo-sqlite web) compiles WebAssembly.
      expect(scriptSrc).toContain("'wasm-unsafe-eval'");
      const hash = createHash('sha256').update(expoHydrateScriptBody(), 'utf8').digest('base64');
      expect(scriptSrc).toContain(`'sha256-${hash}'`);
    });

    it('blocks framing, plugins and base/form hijacking', () => {
      expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
      expect(csp.get('object-src')).toEqual(["'none'"]);
      expect(csp.get('base-uri')).toEqual(["'self'"]);
      expect(csp.get('form-action')).toEqual(["'self'"]);
      expect(csp.get('default-src')).toEqual(["'self'"]);
    });

    it('lets the maplibre module worker and the expo-sqlite blob worker start', () => {
      expect(csp.get('worker-src')).toEqual(expect.arrayContaining(["'self'", 'blob:']));
    });

    it('lets the app reach Supabase (HTTP + Realtime), OpenFreeMap and Sentry', () => {
      expect(csp.get('connect-src')).toEqual(
        expect.arrayContaining([
          "'self'",
          'https://*.supabase.co',
          'wss://*.supabase.co',
          'https://tiles.openfreemap.org',
          'https://*.ingest.sentry.io',
          'https://*.ingest.us.sentry.io',
          'https://*.ingest.de.sentry.io',
        ]),
      );
    });

    it('keeps React Native Web styles and remote imagery working', () => {
      expect(csp.get('style-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
      expect(csp.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https:']));
    });
  });
});
