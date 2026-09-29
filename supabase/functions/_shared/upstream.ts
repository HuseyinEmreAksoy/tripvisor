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
// fakes and the repo-level tsc can check it without Deno globals. It also
// avoids Deno-only APIs and TS-only runtime syntax, so upstream.test.mjs runs
// under both `deno test` and `node --experimental-strip-types --test`.

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
  /** `bytes`: body size as read, in bytes (after fetch undoes any Content-Encoding). */
  | { ok: true; status: number; data: T; attempts: number; durationMs: number; bytes: number }
  | {
      ok: false;
      /** 'timeout' | 'network' | 'http_<status>' | 'too_large' | 'bad_json' */
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
  /**
   * Cap on the response body, in bytes. Counted while the body streams in:
   * the read stops (and the stream is cancelled) as soon as the count passes
   * the cap, so an oversized answer is never buffered whole (reason
   * 'too_large'). No cap = read to the end.
   */
  maxBytes?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type CappedText =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: 'too_large'; bytes: number };

/** Drop a body we will not read (frees the connection; never throws). */
export async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Already consumed, locked or errored: nothing left to free.
  }
}

/**
 * Read `res`'s body as UTF-8 text with a byte counter (Wave-1 review #14).
 * A declared Content-Length over `maxBytes` is refused before reading a
 * byte; otherwise chunks are counted as they arrive and the stream is
 * cancelled the moment the total passes the cap, so a huge or endless
 * upstream answer costs at most about one chunk over the cap in memory.
 *
 * Decoding matches `Response.text()`: UTF-8, BOM stripped, invalid bytes as
 * U+FFFD, and a character split across chunks decodes correctly. `bytes` is
 * the exact byte count read. Errors from the stream (e.g. the caller's
 * AbortController firing mid-body) propagate to the caller.
 *
 * Runtime-neutral (Response / ReadableStream / TextDecoder only), so it runs
 * under Deno and under Node's test runner.
 */
export async function readTextCapped(
  res: Response,
  maxBytes: number = Number.POSITIVE_INFINITY,
): Promise<CappedText> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(res);
    return { ok: false, reason: 'too_large', bytes: declared };
  }
  const body = res.body;
  if (!body) return { ok: true, text: '', bytes: 0 };
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The stream already failed; nothing more to release.
      }
      return { ok: false, reason: 'too_large', bytes };
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return { ok: true, text: parts.join(''), bytes };
}

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
      if (!res.ok) {
        // An error page is never parsed: drop it instead of buffering it.
        await discardBody(res);
        last = { reason: `http_${res.status}`, status: res.status };
        if (res.status >= 500 && attempts <= retries) {
          await sleep(150 + Math.floor(Math.random() * 300));
          continue;
        }
        break;
      }
      // Still inside this attempt's timeout: a body that trickles in past
      // `timeoutMs` aborts the read ('timeout'), like slow headers would.
      const body = await readTextCapped(res, opts.maxBytes);
      if (!body.ok) {
        last = { reason: 'too_large', status: res.status };
        break;
      }
      try {
        return {
          ok: true,
          status: res.status,
          data: JSON.parse(body.text) as T,
          attempts,
          durationMs: Date.now() - started,
          bytes: body.bytes,
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
  // A plain field, not a constructor parameter property: Node's type
  // stripping (upstream.test.mjs) cannot run parameter properties.
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
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
