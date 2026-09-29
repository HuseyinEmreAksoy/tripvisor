// fx-rates — daily FX rates for multi-currency expenses (ADR-0012, M5 Y1.3).
//
// Sources (all free, keyless; verified live 2026-09-29):
//   1. Frankfurter v2, ECB provider: GET https://api.frankfurter.dev/v2/providers/ecb/rates?date=D
//      Official ECB reference rates (~30 currencies incl. TRY/USD/GBP). One set
//      per TARGET business day, about 16:00 CET. A weekend/holiday date
//      answers with the previous business day's set (Sat 2026-09-26 -> Fri 09-25).
//   2. Frankfurter v2, blended: GET https://api.frankfurter.dev/v2/rates?date=D
//      ~166 currencies blended across 100+ central banks. Used ONLY for codes
//      the ECB does not publish (AED, EGP, GEL, MAD, VND, ...), so travellers
//      outside the ECB set still get a rate.
//   3. Fallback when both Frankfurter calls fail: jsDelivr
//      @fawazahmed0/currency-api (@D or @latest) /v1/currencies/eur.min.json.
//   (v1 at api.frankfurter.app now 301s to api.frankfurter.dev/v1 and sends a
//   `Deprecation` header: v2 is the supported API.)
//
// Contract (contractVersion 1). POST JSON body, or GET with the same fields
// as query parameters (`quotes` comma-separated):
//   { action?: 'rates' (default) | 'currencies',
//     date?: 'latest' (default) | 'YYYY-MM-DD',
//     base?: ISO 4217 (default 'EUR')          alias: from
//     quotes?: ISO 4217[] (<= 60; default all) alias: to (one code) }
//   -> rates:
//      { base, date,            // date = the requested day (today UTC for latest)
//        rateDate,              // publication date behind these rates (<= date;
//                               // a Saturday resolves to Friday's ECB set)
//        rates: { [quote]: number },   // quote units per 1 base, unrounded
//        rate?: number,         // only when exactly one quote was asked (pair mode)
//        missing?: string[],    // asked-for quotes without a rate
//        source: 'frankfurter-ecb' | 'frankfurter' | 'currency-api' | 'mixed',
//        stale: boolean,        // true = upstream failed; served the newest cached
//                               // day within 7 days before `date` (rateDate says which)
//        meta: { contractVersion: 1, cache: 'hit' | 'miss' | 'stale' } }
//   -> currencies:
//      { date, rateDate, currencies: [{ code, ecb: boolean }], meta }
//   GET ?ping -> { ok: true, fn: 'fx-rates' }   (public, health only)
//
// Errors ({ error: { code, message } }): invalid_input 400 ·
//   not_authenticated 401 · method_not_allowed 405 · unsupported_currency 422 ·
//   quota_exceeded 429 · quota_unavailable 503 · rates_unavailable 503 ·
//   auth_unavailable 503 · internal_error 500
//
// Caching (fx_rates, 0034): one EUR table per REQUESTED date. Upstream is
// hit at most once per date in normal operation:
//   - a date whose reference set was published for that day, or that was
//     fetched after the day ended (UTC), is final and never refetched;
//   - today's table is refetched after 6 h (ADR-0012), and once more after
//     midnight so it settles on the day's real publication;
//   - a requested code missing from a cached table triggers at most one
//     refetch per hour (a partially failed fill heals, garbage codes stay cheap);
//   - concurrent requests for the same date inside one isolate share one fill.
//   Rows stored under a date other than their publication date carry it in
//   `source` as '<provider>@YYYY-MM-DD' (rates.ts encodeSource).
//
// Quotas (fail closed): a signed-in user is required (requireUser: the public
// anon key gets 401). Only FILLS spend anything upstream, so only fills are
// metered: FX_USER_DAILY_FILLS per user per UTC day, and the global
// service_usage caps 'frankfurter' / 'currency_api' (0037). Cache hits are free.
//
// Pure w.r.t. I/O: every side effect goes through FxDeps (deps.ts wires
// supabase-js), so index.test.ts drives the whole flow with fakes.

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { requireUser, secondsUntilUtcMidnight } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handlePreflight } from '../_shared/cors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { log, newRequestId } from '../_shared/logger.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { type FetchFn, fetchJson, userAgent } from '../_shared/upstream.ts';
import {
  addDays,
  crossRate,
  effectiveDate,
  eurRate,
  FX_BASE,
  FX_CONTRACT_VERSION,
  type FxSource,
  ISO_4217,
  MISSING_QUOTE_RETRY_MS,
  mergeRows,
  needsRefresh,
  parseCurrencyApi,
  parseFrankfurterV2,
  type RateRow,
  referenceDate,
  resolveRequestDate,
  type Snapshot,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './rates.ts';

const FN = 'fx-rates';

export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev';
export const CURRENCY_API_BASE_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

/** Per-attempt budget; Frankfurter answers from Cloudflare's edge in well under 1 s. */
const UPSTREAM_TIMEOUT_MS = 8_000;
/** Largest upstream body we parse (the blended table is ~11 KB). */
const MAX_UPSTREAM_BYTES = 512 * 1024;
/** Stale fallback window when upstream is down. */
const STALE_WINDOW_DAYS = 7;

/**
 * Daily caps. A fill costs 2 Frankfurter calls (ECB + blend), plus 1
 * currency-api call only when both fail. Normal use is "about one fill per
 * distinct date across all users" (ADR-0012): these caps only bound abuse
 * and runaway loops, far below anything Frankfurter's abuse limiter cares
 * about (it has no quotas; responses are Cloudflare-cached).
 */
export const FX_USER_DAILY_FILLS = 60;
export const FRANKFURTER_DAILY_CALLS = 600;
export const CURRENCY_API_DAILY_CALLS = 200;

export type UsageOutcome = 'ok' | 'exceeded' | 'unavailable';

export interface FxDeps {
  /** Rows cached under `date` (null when none). */
  loadSnapshot(date: string): Promise<{ snapshot: Snapshot | null; error: string | null }>;
  /** Newest cached day in [minDate, beforeDate) (the stale fallback). */
  loadLatestBefore(beforeDate: string, minDate: string): Promise<{ snapshot: Snapshot | null; error: string | null }>;
  /** Upsert one day's rows under `date`. */
  saveSnapshot(date: string, rows: RateRow[], fetchedAtIso: string): Promise<{ error: string | null }>;
  /** Global per-service daily cap (0037 consume_service_usage). */
  consumeService(service: string, units: number, cap: number): Promise<UsageOutcome>;
  /** Per-user daily fill cap. */
  consumeUserFills(userId: string, cap: number): Promise<UsageOutcome>;
  fetch: FetchFn;
  now(): number;
  contact?: string;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const Code = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency codes are 3 letters (ISO 4217)')
  .transform((s: string) => s.toUpperCase());

const InputSchema = z
  .object({
    action: z.enum(['rates', 'currencies']).default('rates'),
    date: z.string().max(10).optional(),
    base: Code.optional(),
    from: Code.optional(),
    to: Code.optional(),
    quotes: z.array(Code).max(60).optional(),
  })
  .strict();

interface FxInput {
  action: 'rates' | 'currencies';
  date?: string;
  base: string;
  /** Empty = the whole table. */
  quotes: string[];
}

function normalize(raw: {
  action: 'rates' | 'currencies';
  date?: string;
  base?: string;
  from?: string;
  to?: string;
  quotes?: string[];
}): { ok: true; input: FxInput } | { ok: false; message: string } {
  if (raw.base && raw.from && raw.base !== raw.from) {
    return { ok: false, message: 'base and from disagree' };
  }
  const quotes = [...new Set([...(raw.quotes ?? []), ...(raw.to ? [raw.to] : [])])];
  return {
    ok: true,
    input: { action: raw.action, date: raw.date, base: raw.base ?? raw.from ?? FX_BASE, quotes },
  };
}

async function readInput(req: Request, url: URL): Promise<unknown> {
  if (req.method === 'GET') {
    const q = url.searchParams;
    const obj: Record<string, unknown> = {};
    for (const key of ['action', 'date', 'base', 'from', 'to']) {
      const v = q.get(key);
      if (v !== null && v !== '') obj[key] = v;
    }
    const quotes = q.get('quotes');
    if (quotes) obj.quotes = quotes.split(',').map((s) => s.trim()).filter(Boolean);
    return obj;
  }
  const text = await req.text();
  return text.trim() === '' ? {} : JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Upstream fill
// ---------------------------------------------------------------------------

type FillResult =
  | { ok: true; rows: Map<string, RateRow>; fetchedAt: number }
  | { ok: false; reason: string; quota?: 'exceeded' | 'unavailable' };

async function fill(
  deps: FxDeps,
  date: string,
  latest: boolean,
  requestId: string,
): Promise<FillResult> {
  const ua = userAgent(FN, deps.contact);
  const headers = { 'User-Agent': ua, Accept: 'application/json' };
  const common = { fetchFn: deps.fetch, timeoutMs: UPSTREAM_TIMEOUT_MS, retries: 1, headers, maxBytes: MAX_UPSTREAM_BYTES };

  let ecbRows: RateRow[] = [];
  let blendRows: RateRow[] = [];
  const budget = await deps.consumeService('frankfurter', 2, FRANKFURTER_DAILY_CALLS);
  if (budget === 'ok') {
    const [ecb, blend] = await Promise.all([
      fetchJson(`${FRANKFURTER_BASE_URL}/v2/providers/ecb/rates?date=${date}`, common),
      fetchJson(`${FRANKFURTER_BASE_URL}/v2/rates?date=${date}`, common),
    ]);
    if (ecb.ok) ecbRows = parseFrankfurterV2(ecb.data, 'frankfurter-ecb', date);
    if (blend.ok) blendRows = parseFrankfurterV2(blend.data, 'frankfurter', date);
    log({
      requestId,
      fn: FN,
      level: ecb.ok && blend.ok ? 'info' : 'warn',
      stage: 'upstream',
      provider: 'frankfurter',
      date,
      ecb: ecb.ok ? ecbRows.length : ecb.reason,
      blend: blend.ok ? blendRows.length : blend.reason,
      duration_ms: Math.max(ecb.durationMs, blend.durationMs),
    });
  } else {
    log({ requestId, fn: FN, level: 'warn', stage: 'upstream', provider: 'frankfurter', skipped: budget });
  }

  let fallbackRows: RateRow[] = [];
  if (ecbRows.length === 0 && blendRows.length === 0) {
    const fb = await deps.consumeService('currency_api', 1, CURRENCY_API_DAILY_CALLS);
    if (fb === 'ok') {
      const tag = latest ? 'latest' : date;
      const res = await fetchJson(`${CURRENCY_API_BASE_URL}@${tag}/v1/currencies/eur.min.json`, common);
      if (res.ok) fallbackRows = parseCurrencyApi(res.data, date, ISO_4217);
      log({
        requestId,
        fn: FN,
        level: res.ok && fallbackRows.length > 0 ? 'info' : 'warn',
        stage: 'upstream',
        provider: 'currency-api',
        date,
        rows: res.ok ? fallbackRows.length : res.reason,
        duration_ms: res.durationMs,
      });
    } else {
      log({ requestId, fn: FN, level: 'warn', stage: 'upstream', provider: 'currency-api', skipped: fb });
    }
  }

  const rows = mergeRows(ecbRows, blendRows, fallbackRows);
  if (rows.size === 0) return { ok: false, reason: budget === 'ok' ? 'upstream_failed' : `budget_${budget}` };

  const fetchedAt = deps.now();
  const saved = await deps.saveSnapshot(date, [...rows.values()], new Date(fetchedAt).toISOString());
  if (saved.error) {
    // Serve the fresh rows anyway; the next request simply refetches.
    log({ requestId, fn: FN, level: 'error', stage: 'cache_write', date, err: saved.error });
  }
  return { ok: true, rows, fetchedAt };
}

/** Per-isolate single flight: concurrent requests for one date share one fill. */
const inflight = new Map<string, Promise<FillResult>>();

// ---------------------------------------------------------------------------
// Response building
// ---------------------------------------------------------------------------

function summarizeSource(rows: ReadonlyMap<string, RateRow>, codes: readonly string[]): FxSource | 'mixed' {
  const seen = new Set<FxSource>();
  for (const c of codes) {
    const r = rows.get(c);
    if (r) seen.add(r.source);
  }
  if (seen.size === 1) return [...seen][0]!;
  if (seen.size === 0) return 'frankfurter-ecb';
  return 'mixed';
}

export function createHandler(deps: FxDeps): (req: Request) => Promise<Response> {
  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const requestId = newRequestId();
    const startedAt = deps.now();

    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    if (url.searchParams.has('ping')) return jsonResponse({ ok: true, fn: FN }, { origin });
    if (req.method !== 'GET' && req.method !== 'POST') {
      return errorResponse('method_not_allowed', 'Only GET and POST are allowed', 405, origin);
    }

    const auth = await requireUser(req, { fn: FN, requestId, origin });
    if (!auth.ok) return auth.response;
    const userId: string = auth.user.id;

    let raw: unknown;
    try {
      raw = await readInput(req, url);
    } catch {
      return errorResponse('invalid_input', 'Invalid JSON', 400, origin);
    }
    const parsed = InputSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i: { message: string }) => i.message).join('; ');
      return errorResponse('invalid_input', msg, 400, origin);
    }
    const norm = normalize(parsed.data);
    if (!norm.ok) return errorResponse('invalid_input', norm.message, 400, origin);
    const input = norm.input;

    const resolved = resolveRequestDate(input.date, deps.now());
    if (!resolved.ok) return errorResponse('invalid_input', resolved.message, 400, origin);
    const date = resolved.date;

    try {
      const wanted = input.action === 'rates' ? [input.base, ...input.quotes].filter((c) => c !== FX_BASE) : [];

      // 1. Cache.
      const loaded = await deps.loadSnapshot(date);
      if (loaded.error) log({ requestId, fn: FN, level: 'error', stage: 'cache_read', date, err: loaded.error });
      let snapshot = loaded.snapshot;
      let cache: 'hit' | 'miss' | 'stale' = 'hit';

      const now = deps.now();
      const missing = snapshot ? wanted.filter((c) => !snapshot!.rows.has(c)) : wanted;
      const wantFill =
        !snapshot ||
        needsRefresh(snapshot, now) ||
        (missing.length > 0 && now - snapshot.fetchedAt >= MISSING_QUOTE_RETRY_MS);

      // 2. Fill (metered) when the cache can't answer. The in-flight entry is
      //    set synchronously, before any await, so concurrent requests for the
      //    same date join one fill (and one quota charge, the initiator's).
      if (wantFill) {
        let pending = inflight.get(date);
        const initiator = !pending;
        if (!pending) {
          pending = (async (): Promise<FillResult> => {
            const quota = await deps.consumeUserFills(userId, FX_USER_DAILY_FILLS);
            if (quota !== 'ok') return { ok: false, reason: `user_quota_${quota}`, quota };
            return await fill(deps, date, resolved.latest, requestId);
          })().finally(() => inflight.delete(date));
          inflight.set(date, pending);
        }
        const result = await pending;
        if (result.ok) {
          snapshot = { date, rows: result.rows, fetchedAt: result.fetchedAt };
          cache = 'miss';
        } else if (result.quota && initiator) {
          log({ requestId, fn: FN, level: 'warn', stage: 'quota', userId, outcome: result.quota });
          if (!snapshot) return fxQuotaDenied(result.quota, origin, now);
        } else {
          log({ requestId, fn: FN, level: 'warn', stage: 'fill', date, err: result.reason, have_cached: !!snapshot });
        }
      }

      // 3. Stale fallback: upstream down and nothing cached for this date.
      let stale = false;
      if (!snapshot || snapshot.rows.size === 0) {
        const prev = await deps.loadLatestBefore(date, addDays(date, -STALE_WINDOW_DAYS));
        if (prev.error) log({ requestId, fn: FN, level: 'error', stage: 'stale_read', date, err: prev.error });
        if (!prev.snapshot || prev.snapshot.rows.size === 0) {
          return errorResponse(
            'rates_unavailable',
            'Exchange rates are temporarily unavailable. Please retry later.',
            503,
            origin,
          );
        }
        snapshot = prev.snapshot;
        stale = true;
        cache = 'stale';
      }
      const rows = snapshot.rows;

      if (input.action === 'currencies') {
        const currencies = [FX_BASE, ...rows.keys()]
          .sort()
          .map((code) => ({ code, ecb: code === FX_BASE || rows.get(code)?.source === 'frankfurter-ecb' }));
        log({ requestId, fn: FN, level: 'info', stage: 'done', action: 'currencies', userId, date, cache, count: currencies.length, duration_ms: deps.now() - startedAt });
        return jsonResponse(
          {
            date,
            rateDate: referenceDate(rows.values()) ?? date,
            currencies,
            stale,
            meta: { contractVersion: FX_CONTRACT_VERSION, cache },
          },
          { origin },
        );
      }

      // 4. Rates relative to the requested base.
      if (eurRate(rows, input.base) === null) {
        return errorResponse('unsupported_currency', `No rate available for ${input.base}`, 422, origin);
      }
      const quotes = input.quotes.length > 0 ? input.quotes : [FX_BASE, ...rows.keys()].filter((c) => c !== input.base);
      const rates: Record<string, number> = {};
      const missingQuotes: string[] = [];
      for (const q of quotes) {
        const r = crossRate(rows, input.base, q);
        if (r === null) missingQuotes.push(q);
        else rates[q] = r;
      }
      if (Object.keys(rates).length === 0 && quotes.length > 0) {
        return errorResponse('unsupported_currency', `No rate available for ${missingQuotes.join(', ')}`, 422, origin);
      }
      const used = [input.base, ...Object.keys(rates)];
      const body: Record<string, unknown> = {
        base: input.base,
        date,
        rateDate: effectiveDate(rows, used) ?? referenceDate(rows.values()) ?? date,
        rates,
        source: summarizeSource(rows, used),
        stale,
        meta: { contractVersion: FX_CONTRACT_VERSION, cache },
      };
      if (input.quotes.length === 1 && rates[input.quotes[0]!] !== undefined) body.rate = rates[input.quotes[0]!];
      if (missingQuotes.length > 0) body.missing = missingQuotes;

      log({
        requestId,
        fn: FN,
        level: 'info',
        stage: 'done',
        action: 'rates',
        userId,
        date,
        base: input.base,
        quotes: input.quotes.length,
        cache,
        stale,
        duration_ms: deps.now() - startedAt,
      });
      return jsonResponse(body, {
        origin,
        // Per-user response (auth): never shared caches. Past final days are
        // immutable, so a client may keep them a while; `latest` for 1 h.
        headers: { 'Cache-Control': `private, max-age=${resolved.latest || stale ? 3600 : 86400}` },
      });
    } catch (err) {
      log({ requestId, fn: FN, level: 'error', stage: 'unexpected', userId, date, err: String(err), duration_ms: deps.now() - startedAt });
      return errorResponse('internal_error', 'fx-rates failed', 500, origin);
    }
  };
}

function fxQuotaDenied(outcome: 'exceeded' | 'unavailable', origin: string | null, nowMs: number): Response {
  if (outcome === 'unavailable') {
    // Same envelope as auth.ts quotaDeniedResponse('unavailable'): fail closed, retryable.
    return jsonResponse(
      { error: { code: 'quota_unavailable', message: 'Usage check is temporarily unavailable. Please retry shortly.' } },
      { status: 503, origin, headers: { 'Retry-After': '5' } },
    );
  }
  return jsonResponse(
    {
      error: {
        code: 'quota_exceeded',
        message: `Daily exchange-rate lookup limit reached (${FX_USER_DAILY_FILLS} new dates/day). It resets at 00:00 UTC.`,
        kind: 'fx_fills',
        limit: FX_USER_DAILY_FILLS,
      },
    },
    { status: 429, origin, headers: { 'Retry-After': String(secondsUntilUtcMidnight(nowMs)) } },
  );
}
