// _shared/upstream.ts: outbound calls to the free, keyless public APIs
// (Frankfurter, jsDelivr currency-api, Overpass, Wikipedia/Wikidata).
//
// Every request identifies Tripvisor with a descriptive User-Agent that has
// contact information. The OSM Overpass and Wikimedia policies ask for this,
// and Wikimedia rate-limits unidentified clients to 10 requests/minute
// instead of 200 (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits,
// checked 2026-09-29). Format per the Wikimedia User-Agent policy:
//   <client>/<version> (<contact>) <component>
// UPSTREAM_CONTACT (optional secret) overrides the contact part, e.g. an
// operator mailbox; the default is the public web app URL.
//
// Rule 7 (backend-specialist): every fetch has an AbortController timeout;
// only 5xx and network failures are retried, with jitter, at most `retries`
// times (<= 2).
//
// Pure except for the injected `fetchFn`, so the Deno tests drive it with
// fakes and the repo-level tsc can check it without Deno globals.

export const DEFAULT_UPSTREAM_CONTACT = 'https://tripvisor.pages.dev';

/** Build the User-Agent for one Edge Function. */
export function userAgent(fn: string, contact: string | undefined = undefined): string {
  const c = (contact ?? '').trim() || DEFAULT_UPSTREAM_CONTACT;
  // Header values must stay single-line printable ASCII.
  const safe = c.replace(/[^\x20-\x7e]/g, '').slice(0, 120);
  return `Tripvisor/1.0 (${safe}) ${fn}`;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type UpstreamResult<T> =
  | { ok: true; status: number; data: T; attempts: number; durationMs: number; bytes: number }
  | {
      ok: false;
      /** 'timeout' | 'network' | 'http_<status>' | 'bad_json' */
      reason: string;
      status: number | null;
      attempts: number;
      durationMs: number;
    };

export interface FetchJsonOptions {
  fetchFn: FetchFn;
  timeoutMs: number;
  /** Extra attempts on 5xx / network errors (0..2). Never retries 4xx or timeouts. */
  retries?: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Test hook; production jitter is 150–450 ms. */
  sleep?: (ms: number) => Promise<void>;
  /** Cap on the response body we are willing to parse (bytes of text). */
  maxBytes?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET/POST a JSON endpoint with a hard timeout per attempt. Never throws.
 * A timeout is not retried: the upstream is slow, and a second wait would
 * double the user's latency (callers fail over to another source instead).
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions): Promise<UpstreamResult<T>> {
  const started = Date.now();
  const retries = Math.min(Math.max(opts.retries ?? 0, 0), 2);
  const sleep = opts.sleep ?? defaultSleep;
  let attempts = 0;
  let last: { reason: string; status: number | null } = { reason: 'network', status: null };
  while (attempts <= retries) {
    attempts++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await opts.fetchFn(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        last = { reason: `http_${res.status}`, status: res.status };
        if (res.status >= 500 && attempts <= retries) {
          await sleep(150 + Math.floor(Math.random() * 300));
          continue;
        }
        break;
      }
      if (opts.maxBytes !== undefined && text.length > opts.maxBytes) {
        last = { reason: 'too_large', status: res.status };
        break;
      }
      try {
        return {
          ok: true,
          status: res.status,
          data: JSON.parse(text) as T,
          attempts,
          durationMs: Date.now() - started,
          bytes: text.length,
        };
      } catch {
        last = { reason: 'bad_json', status: res.status };
        break;
      }
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      last = { reason: aborted ? 'timeout' : 'network', status: null };
      if (aborted) break;
      if (attempts <= retries) {
        await sleep(150 + Math.floor(Math.random() * 300));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: last.reason, status: last.status, attempts, durationMs: Date.now() - started };
}

/**
 * Tiny per-isolate circuit breaker keyed by upstream host/URL. After a
 * failure the key is skipped for `cooldownMs`, so one hung or overloaded
 * instance costs one timeout per cooldown window instead of one per request
 * (Overpass asks clients to back off ~30 s after a 429/504).
 */
export class Breaker {
  private openUntil = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  isOpen(key: string): boolean {
    const until = this.openUntil.get(key);
    return until !== undefined && this.now() < until;
  }
  trip(key: string, cooldownMs: number): void {
    this.openUntil.set(key, this.now() + cooldownMs);
  }
  reset(key: string): void {
    this.openUntil.delete(key);
  }
  clear(): void {
    this.openUntil.clear();
  }
}
