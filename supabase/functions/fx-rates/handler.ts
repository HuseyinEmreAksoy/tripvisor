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
// Caching (fx_rates, 0034): one EUR table per REQUESTED date.
//   - TODAY ('latest') is stored whole (~166 codes; the currencies picker
//     lists it). It is refetched after 6 h (ADR-0012) and once more after
//     midnight so it settles on the day's real publication. A code missing
//     from it is re-asked at most once an hour (garbage codes stay cheap).
//   - A PAST day stores only the ECB reference set (~29 codes) plus the codes
//     callers asked for (Wave-1 review #8: storing the whole blend for every
//     expense date added ~166 rows per date). Its first fill calls only the
//     ECB endpoint when every requested code is an ECB code, else ECB + blend.
//     A later request for a code not stored yet runs a TOP-UP (blend only,
//     one call) that appends just that code. A code the blend turned out not
//     to have is not re-asked for an hour (per isolate, planFill).
//     So a past day's whole-table / `currencies` answer from cache lists the
//     ECB set plus the codes asked for so far, not all 166. Ask for the codes
//     you need (the client always does: pair mode).
//   - A day whose reference set was published for that day, or that was
//     fetched after the day ended (UTC), is final and never refetched.
//   - Concurrent requests for one date inside one isolate share one fill; a
//     request that rode a fill planned for other codes tops up on its own.
//   Rows stored under a date other than their publication date carry it in
//   `source` as '<provider>@YYYY-MM-DD' (rates.ts encodeSource).
//
// Quotas (fail closed): a signed-in user is required (requireUser: the public
// anon key gets 401). Only FILLS (top-ups included) spend anything upstream,
// so only fills are metered: FX_USER_DAILY_FILLS per user per UTC day, and
// the global service_usage caps 'frankfurter' (per call) / 'currency_api'
// (0037). Cache hits are free. When a requested rate is missing because a
// fill was refused or upstream failed, the answer is that quota error or
// 503 rates_unavailable, never 422 unsupported_currency: the client treats
// 422 as permanent, the others as "rate pending, retry later".
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
  ECB_CODES,
  effectiveDate,
  eurRate,
  type FillMode,
  FX_BASE,
  FX_CONTRACT_VERSION,
  type FxSource,
  ISO_4217,
  MISSING_QUOTE_RETRY_MS,
  mergeRows,
  needsRefresh,
  parseCurrencyApi,
  parseFrankfurterV2,
  pastDayRowsToKeep,
  planFill,
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
 * Daily caps. A fill costs 1–2 Frankfurter calls (ECB and/or blend; a
 * top-up is 1), plus 1 currency-api call only when Frankfurter could not
 * answer. Normal use is "about one fill per distinct date across all users"
 * (ADR-0012) plus a top-up per non-ECB currency and past date: these caps
 * only bound abuse and runaway loops, far below anything Frankfurter's abuse
 * limiter cares about (it has no quotas; responses are Cloudflare-cached).
 * 20 fills per user per day (Wave-1 review #8; was 60) still covers entering
 * a two-to-three-week trip's back-dated expenses in one sitting, and keeps
 * one account from spending more than ~40 of the global 600 calls. A refused
 * fill leaves the expense "rate pending" for the reconciler.
 */
export const FX_USER_DAILY_FILLS = 20;
export const FRANKFURTER_DAILY_CALLS = 600;
export const CURRENCY_API_DAILY_CALLS = 200;
/** Bound on the per-isolate "upstream has no rate for this code" memory. */
const ABSENT_MEMORY_MAX = 1000;

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

interface FillRequest {
  date: string;
  latest: boolean;
  mode: FillMode;
  /** The request's non-EUR codes (base + quotes). */
  wanted: readonly string[];
  /** Codes already cached for `date`: a top-up never rewrites them. */
  stored: ReadonlySet<string>;
}

type FillResult =
  | {
      ok: true;
      /** Everything fetched (the response may use all of it; fewer rows are stored for a past day). */
      rows: Map<string, RateRow>;
      fetchedAt: number;
      /**
       * false = a source that could have held a still-missing wanted code
       * did not answer, so "missing" means "unavailable now", not "unsupported".
       */
      complete: boolean;
      /** Wanted codes the blend answered WITHOUT (upstream has no rate that day). */
      absent: string[];
    }
  | { ok: false; reason: string; quota?: 'exceeded' | 'unavailable' };

type FillOk = Extract<FillResult, { ok: true }>;

interface TableFetch {
  answered: boolean;
  rows: RateRow[];
}

const NOT_FETCHED: TableFetch = { answered: false, rows: [] };

/**
 * Fetch one day's rates (metered), store the part worth keeping, and return
 * everything fetched. Endpoints per plan:
 *   today ('latest', always 'full') -> ECB + blend; the whole table is stored;
 *   past day, 'full'  -> ECB, plus the blend only when a wanted code is
 *                        outside the ECB set (or the ECB call failed / lacked
 *                        one); stores pastDayRowsToKeep (ECB set + wanted);
 *   past day, 'topup' -> the blend only; stores the wanted codes not cached yet.
 * currency-api is the last resort when Frankfurter gave nothing, or when the
 * blend did not answer and a wanted code is still missing.
 */
async function fill(deps: FxDeps, req: FillRequest, requestId: string): Promise<FillResult> {
  const { date, latest, mode } = req;
  const wanted = new Set(req.wanted);
  const ua = userAgent(FN, deps.contact);
  const headers = { 'User-Agent': ua, Accept: 'application/json' };
  const common = { fetchFn: deps.fetch, timeoutMs: UPSTREAM_TIMEOUT_MS, retries: 1, headers, maxBytes: MAX_UPSTREAM_BYTES };

  const frankfurter = async (kind: 'ecb' | 'blend'): Promise<TableFetch> => {
    const source: FxSource = kind === 'ecb' ? 'frankfurter-ecb' : 'frankfurter';
    const url =
      kind === 'ecb'
        ? `${FRANKFURTER_BASE_URL}/v2/providers/ecb/rates?date=${date}`
        : `${FRANKFURTER_BASE_URL}/v2/rates?date=${date}`;
    const res = await fetchJson(url, common);
    const rows = res.ok ? parseFrankfurterV2(res.data, source, date) : [];
    log({
      requestId,
      fn: FN,
      level: res.ok ? 'info' : 'warn',
      stage: 'upstream',
      provider: source,
      date,
      mode,
      rows: res.ok ? rows.length : res.reason,
      duration_ms: res.durationMs,
    });
    return { answered: res.ok, rows };
  };
  const lacks = (fetched: TableFetch) => [...wanted].some((c) => !fetched.rows.some((r) => r.quote === c));

  const callEcb = mode === 'full';
  const callBlend = latest || mode === 'topup' || [...wanted].some((c) => !ECB_CODES.has(c));
  let ecb = NOT_FETCHED;
  let blend = NOT_FETCHED;
  const budget = await deps.consumeService('frankfurter', (callEcb ? 1 : 0) + (callBlend ? 1 : 0), FRANKFURTER_DAILY_CALLS);
  if (budget === 'ok') {
    [ecb, blend] = await Promise.all([
      callEcb ? frankfurter('ecb') : Promise.resolve(NOT_FETCHED),
      callBlend ? frankfurter('blend') : Promise.resolve(NOT_FETCHED),
    ]);
    // A past day planned as ECB-only whose ECB call failed or lacked a
    // wanted code: the blend is the next-best source (one more call).
    if (!callBlend && (!ecb.answered || lacks(ecb))) {
      const more = await deps.consumeService('frankfurter', 1, FRANKFURTER_DAILY_CALLS);
      if (more === 'ok') blend = await frankfurter('blend');
      else log({ requestId, fn: FN, level: 'warn', stage: 'upstream', provider: 'frankfurter', skipped: more });
    }
  } else {
    log({ requestId, fn: FN, level: 'warn', stage: 'upstream', provider: 'frankfurter', skipped: budget });
  }

  let rows = mergeRows(ecb.rows, blend.rows);
  let fallbackAnswered = false;
  const missingWanted = () => [...wanted].some((c) => !rows.has(c));
  if (rows.size === 0 || (!blend.answered && missingWanted())) {
    const fb = await deps.consumeService('currency_api', 1, CURRENCY_API_DAILY_CALLS);
    if (fb === 'ok') {
      const tag = latest ? 'latest' : date;
      const res = await fetchJson(`${CURRENCY_API_BASE_URL}@${tag}/v1/currencies/eur.min.json`, common);
      const fallbackRows = res.ok ? parseCurrencyApi(res.data, date, ISO_4217) : [];
      fallbackAnswered = res.ok && fallbackRows.length > 0;
      rows = mergeRows(ecb.rows, blend.rows, fallbackRows);
      log({
        requestId,
        fn: FN,
        level: fallbackAnswered ? 'info' : 'warn',
        stage: 'upstream',
        provider: 'currency-api',
        date,
        mode,
        rows: res.ok ? fallbackRows.length : res.reason,
        duration_ms: res.durationMs,
      });
    } else {
      log({ requestId, fn: FN, level: 'warn', stage: 'upstream', provider: 'currency-api', skipped: fb });
    }
  }
  if (rows.size === 0) return { ok: false, reason: budget === 'ok' ? 'upstream_failed' : `budget_${budget}` };

  // Persist: today whole; a past day only what later requests will need.
  const toStore = latest
    ? [...rows.values()]
    : mode === 'topup'
      ? [...rows.values()].filter((r) => wanted.has(r.quote) && !req.stored.has(r.quote))
      : pastDayRowsToKeep(rows.values(), wanted);
  const fetchedAt = deps.now();
  if (toStore.length > 0) {
    const saved = await deps.saveSnapshot(date, toStore, new Date(fetchedAt).toISOString());
    // On error serve the fresh rows anyway; the next request simply refetches.
    log({
      requestId,
      fn: FN,
      level: saved.error ? 'error' : 'info',
      stage: 'cache_write',
      date,
      mode,
      rows: toStore.length,
      ...(saved.error ? { err: saved.error } : {}),
    });
  }
  return {
    ok: true,
    rows,
    fetchedAt,
    complete: blend.answered || fallbackAnswered || !missingWanted(),
    absent: blend.answered ? [...wanted].filter((c) => !rows.has(c)) : [],
  };
}

/**
 * The day's rows after a fill. A full fill's rows win over older cached ones
 * (they are fresher); a top-up only adds codes the cache did not have. Codes
 * only one side has are kept either way, as in fx_rates (upserts never delete).
 */
function withFill(snapshot: Snapshot | null, date: string, result: FillOk, mode: FillMode): Snapshot {
  const rows = new Map<string, RateRow>();
  const layers = mode === 'topup' ? [snapshot?.rows, result.rows] : [result.rows, snapshot?.rows];
  for (const layer of layers) {
    if (!layer) continue;
    for (const [quote, r] of layer) if (!rows.has(quote)) rows.set(quote, r);
  }
  return { date, rows, fetchedAt: result.fetchedAt };
}

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
  // Per-isolate state (one createHandler per isolate in index.ts; tests get
  // a fresh one per world).
  /** Single flight: concurrent requests for one date share one fill. */
  const inflight = new Map<string, Promise<FillResult>>();
  /**
   * `${date}|${code}` -> ms: codes the blend answered a past day without.
   * Stops a code upstream lacks (or a typo) from re-running a metered top-up
   * on every request (planFill). Best effort: a new isolate forgets, and the
   * per-user fill cap still bounds the cost. Oldest entries evicted first.
   */
  const absent = new Map<string, number>();
  const noteAbsent = (date: string, codes: readonly string[], at: number) => {
    for (const code of codes) {
      const key = `${date}|${code}`;
      absent.delete(key);
      absent.set(key, at);
    }
    while (absent.size > ABSENT_MEMORY_MAX) {
      const oldest = absent.keys().next().value as string;
      absent.delete(oldest);
    }
  };

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
      const isAbsent = (code: string): boolean => {
        const at = absent.get(`${date}|${code}`);
        return at !== undefined && now - at < MISSING_QUOTE_RETRY_MS;
      };

      // 2. Fill (metered) when the cache can't answer. The in-flight entry is
      //    set synchronously, before any await, so concurrent requests for the
      //    same date join one fill (and one quota charge, the initiator's).
      //    A request that joined another's fill gets one more pass of its own
      //    when that fill (planned for the other request's codes, or refused
      //    by the other user's quota) left its codes out.
      let mode = planFill(snapshot, wanted, resolved.latest, now, isAbsent);
      const plannedFill = mode;
      /** Why a still-missing rate is unavailable rather than unsupported. */
      let denied: 'exceeded' | 'unavailable' | null = null;
      let upstreamFailed = false;
      for (let pass = 0; mode !== null && pass < 2; pass++) {
        denied = null;
        upstreamFailed = false;
        let pending = inflight.get(date);
        const initiator = !pending;
        if (!pending) {
          const fillReq: FillRequest = {
            date,
            latest: resolved.latest,
            mode,
            wanted,
            stored: new Set(snapshot ? snapshot.rows.keys() : []),
          };
          pending = (async (): Promise<FillResult> => {
            const quota = await deps.consumeUserFills(userId, FX_USER_DAILY_FILLS);
            if (quota !== 'ok') return { ok: false, reason: `user_quota_${quota}`, quota };
            const r = await fill(deps, fillReq, requestId);
            if (r.ok && r.absent.length > 0) noteAbsent(date, r.absent, deps.now());
            return r;
          })().finally(() => inflight.delete(date));
          inflight.set(date, pending);
        }
        const result = await pending;
        if (result.ok) {
          snapshot = withFill(snapshot, date, result, mode);
          cache = 'miss';
          upstreamFailed = !result.complete;
        } else if (result.quota && initiator) {
          log({ requestId, fn: FN, level: 'warn', stage: 'quota', userId, outcome: result.quota });
          if (!snapshot) return fxQuotaDenied(result.quota, origin, now);
          denied = result.quota;
        } else {
          log({ requestId, fn: FN, level: 'warn', stage: 'fill', date, err: result.reason, have_cached: !!snapshot });
          upstreamFailed = true;
        }
        if (initiator) break;
        const current: Snapshot | null = snapshot;
        const stillMissing = wanted.some((c) => !current?.rows.has(c) && !isAbsent(c));
        const again = result.ok ? !resolved.latest && stillMissing : !!result.quota;
        if (!again) break;
        mode = !current || needsRefresh(current, now) ? 'full' : 'topup';
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

      // 4. Rates relative to the requested base. A rate missing because a
      //    fill was refused or upstream failed is "not now", not
      //    "unsupported": answer the quota error / 503 so the client keeps the
      //    expense as "rate pending" (422 is a permanent error to it).
      const unavailable = (codes: readonly string[]): Response => {
        if (denied) return fxQuotaDenied(denied, origin, now);
        if (upstreamFailed) {
          return errorResponse(
            'rates_unavailable',
            'Exchange rates are temporarily unavailable. Please retry later.',
            503,
            origin,
          );
        }
        return errorResponse('unsupported_currency', `No rate available for ${codes.join(', ')}`, 422, origin);
      };
      if (eurRate(rows, input.base) === null) return unavailable([input.base]);
      const quotes = input.quotes.length > 0 ? input.quotes : [FX_BASE, ...rows.keys()].filter((c) => c !== input.base);
      const rates: Record<string, number> = {};
      const missingQuotes: string[] = [];
      for (const q of quotes) {
        const r = crossRate(rows, input.base, q);
        if (r === null) missingQuotes.push(q);
        else rates[q] = r;
      }
      if (Object.keys(rates).length === 0 && quotes.length > 0) return unavailable(missingQuotes);
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
        fill: plannedFill,
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
        message: `Daily exchange-rate lookup limit reached (${FX_USER_DAILY_FILLS} new rate lookups/day). It resets at 00:00 UTC.`,
        kind: 'fx_fills',
        limit: FX_USER_DAILY_FILLS,
      },
    },
    { status: 429, origin, headers: { 'Retry-After': String(secondsUntilUtcMidnight(nowMs)) } },
  );
}
