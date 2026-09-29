// fx-rates/rates.ts: pure FX logic (no I/O, no Deno globals).
//
// Everything is stored against base EUR (ADR-0012 §2, fx_rates in 0034):
// rate(Q) = Q units per 1 EUR, rate(EUR) = 1, and any cross rate is
// rate(to) / rate(from). Numbers stay unrounded here; rounding happens only
// at display (M5 money rule).

export const FX_CONTRACT_VERSION = 1 as const;
export const FX_BASE = 'EUR';

/** Where a row came from. Stored in fx_rates.source (see encodeSource). */
export type FxSource = 'frankfurter-ecb' | 'frankfurter' | 'currency-api';

/** Priority when merging: ECB reference rates > Frankfurter blend > currency-api. */
const SOURCE_PRIORITY: Record<FxSource, number> = {
  'frankfurter-ecb': 3,
  frankfurter: 2,
  'currency-api': 1,
};

export interface RateRow {
  quote: string;
  /** Quote units per 1 EUR, > 0. */
  rate: number;
  source: FxSource;
  /** The date the provider published this rate for (<= the requested date). */
  publishedDate: string;
}

/** One requested day's EUR table, as cached in fx_rates under `date`. */
export interface Snapshot {
  /** The requested date (fx_rates.rate_date). */
  date: string;
  rows: Map<string, RateRow>;
  /** ms epoch of the OLDEST row's fetched_at (conservative for refresh). */
  fetchedAt: number;
}

export const ISO_CODE = /^[A-Z]{3}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ECB reference rates start on 1999-01-04; nothing earlier exists upstream. */
export const MIN_DATE = '1999-01-04';

// ---------------------------------------------------------------------------
// Dates (UTC calendar days)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function isRealDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return utcDay(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS);
}

export function startOfDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export type DateResolution =
  | { ok: true; date: string; latest: boolean }
  | { ok: false; message: string };

/**
 * 'latest' (or nothing) -> today (UTC). A date one day ahead of UTC is
 * accepted and treated as latest: a traveller east of UTC (Istanbul is
 * UTC+3) can enter an expense on "tomorrow" in UTC terms. Anything later is
 * rejected, and so is anything before MIN_DATE.
 */
export function resolveRequestDate(input: string | undefined, nowMs: number): DateResolution {
  const today = utcDay(nowMs);
  if (input === undefined || input === 'latest') return { ok: true, date: today, latest: true };
  if (!isRealDate(input)) return { ok: false, message: 'date must be YYYY-MM-DD or "latest"' };
  if (input < MIN_DATE) return { ok: false, message: `date must be on or after ${MIN_DATE}` };
  if (input > addDays(today, 1)) return { ok: false, message: 'date is in the future' };
  if (input >= today) return { ok: true, date: today, latest: true };
  return { ok: true, date: input, latest: false };
}

// ---------------------------------------------------------------------------
// Cache freshness
// ---------------------------------------------------------------------------

/** Today's (not yet final) snapshot is refetched after this long (ADR-0012 §2). */
export const REFRESH_AFTER_MS = 6 * 3_600_000;
/** A quote missing from a cached snapshot triggers at most one refetch per hour. */
export const MISSING_QUOTE_RETRY_MS = 3_600_000;

/**
 * The date the snapshot's reference set was published for: the ECB rows'
 * date when there are any (ECB publishes one set per TARGET business day),
 * else the newest row date. null for an empty snapshot.
 */
export function referenceDate(rows: Iterable<RateRow>): string | null {
  let ecb: string | null = null;
  let newest: string | null = null;
  for (const r of rows) {
    if (r.source === 'frankfurter-ecb' && (ecb === null || r.publishedDate > ecb)) ecb = r.publishedDate;
    if (newest === null || r.publishedDate > newest) newest = r.publishedDate;
  }
  return ecb ?? newest;
}

/**
 * A snapshot is final (cached forever) when its reference set was published
 * for the requested day itself, or when it was fetched after that day had
 * ended in UTC: by then any publication for the day exists, so a weekend or
 * holiday has settled on the previous business day for good.
 */
export function isFinal(s: Snapshot): boolean {
  if (s.rows.size === 0) return false;
  return referenceDate(s.rows.values()) === s.date || s.fetchedAt >= startOfDayMs(addDays(s.date, 1));
}

/** Refetch a non-final snapshot after 6 h, or right away once its day has ended. */
export function needsRefresh(s: Snapshot, nowMs: number): boolean {
  if (s.rows.size === 0) return true;
  if (isFinal(s)) return false;
  return nowMs - s.fetchedAt >= REFRESH_AFTER_MS || nowMs >= startOfDayMs(addDays(s.date, 1));
}

/**
 * 'full' = (re)fetch the day's table; 'topup' = fetch the blend only to add
 * requested codes a past day's cached table does not hold yet.
 */
export type FillMode = 'full' | 'topup';

/**
 * What to fetch before answering for one day, or null to answer from cache.
 * `wanted` = the request's non-EUR codes; `isAbsent(code)` = upstream
 * recently answered this day without a rate for `code`.
 */
export function planFill(
  snapshot: Snapshot | null,
  wanted: readonly string[],
  latest: boolean,
  nowMs: number,
  isAbsent: (code: string) => boolean,
): FillMode | null {
  if (!snapshot || needsRefresh(snapshot, nowMs)) return 'full';
  const missing = wanted.filter((c) => !snapshot.rows.has(c));
  if (missing.length === 0) return null;
  // Today's table is stored whole: a missing code is one upstream lacks (or
  // a fill that partly failed), so it is re-asked at most once an hour.
  if (latest) return nowMs - snapshot.fetchedAt >= MISSING_QUOTE_RETRY_MS ? 'full' : null;
  // A past day holds the ECB set + the codes asked for so far: a missing code
  // is usually just not stored yet, unless upstream recently said otherwise.
  return missing.some((c) => !isAbsent(c)) ? 'topup' : null;
}

// ---------------------------------------------------------------------------
// fx_rates.source encoding
// ---------------------------------------------------------------------------

/**
 * fx_rates has no "published date" column (0034), so a row stored under a
 * requested date that differs from its publication date carries it in
 * `source` as `<provider>@<YYYY-MM-DD>` (e.g. a Saturday row
 * `frankfurter-ecb@2026-09-25`). Plain `<provider>` means "published for
 * rate_date itself". Readers that only need the rate can ignore it.
 */
export function encodeSource(row: RateRow, rateDate: string): string {
  return row.publishedDate === rateDate ? row.source : `${row.source}@${row.publishedDate}`;
}

export function decodeSource(
  raw: string,
  rateDate: string,
): { source: FxSource; publishedDate: string } | null {
  const at = raw.indexOf('@');
  const src = at === -1 ? raw : raw.slice(0, at);
  const pub = at === -1 ? rateDate : raw.slice(at + 1);
  if (!(src in SOURCE_PRIORITY) || !isRealDate(pub)) return null;
  return { source: src as FxSource, publishedDate: pub };
}

// ---------------------------------------------------------------------------
// Upstream parsing
// ---------------------------------------------------------------------------

function positive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Frankfurter v2 `/v2/rates` and `/v2/providers/ecb/rates` answer a JSON
 * array of `{ date, base, quote, rate }` (verified live 2026-09-29). Rows
 * with a base other than EUR, a malformed code or a non-positive rate are
 * dropped; so is anything dated after the requested day.
 */
export function parseFrankfurterV2(body: unknown, source: FxSource, requestedDate: string): RateRow[] {
  if (!Array.isArray(body)) return [];
  const out: RateRow[] = [];
  for (const item of body as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue;
    const { date, base, quote, rate } = item;
    if (base !== FX_BASE || typeof quote !== 'string' || !ISO_CODE.test(quote) || quote === FX_BASE) continue;
    if (typeof date !== 'string' || !isRealDate(date) || date > requestedDate) continue;
    if (!positive(rate)) continue;
    out.push({ quote, rate, source, publishedDate: date });
  }
  return out;
}

/**
 * fawazahmed0 currency-api (`.../v1/currencies/eur.min.json`):
 * `{ date, eur: { usd: 1.13, try: 55.7, btc: 0.00001, ... } }`. Lower-case
 * codes and crypto tickers are mixed in, so only codes in `known` (ISO 4217
 * codes already seen from Frankfurter, or the static fallback list) are kept:
 * 0034's CHECK rejects anything else and one bad row fails the whole upsert.
 */
export function parseCurrencyApi(
  body: unknown,
  requestedDate: string,
  known: ReadonlySet<string>,
): RateRow[] {
  if (!body || typeof body !== 'object') return [];
  const { date, eur } = body as { date?: unknown; eur?: unknown };
  if (typeof date !== 'string' || !isRealDate(date) || !eur || typeof eur !== 'object') return [];
  const published = date > requestedDate ? requestedDate : date;
  const out: RateRow[] = [];
  for (const [k, v] of Object.entries(eur as Record<string, unknown>)) {
    const quote = k.toUpperCase();
    if (!ISO_CODE.test(quote) || quote === FX_BASE || !known.has(quote) || !positive(v)) continue;
    out.push({ quote, rate: v, source: 'currency-api', publishedDate: published });
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a past day stores (Wave-1 review #8)
// ---------------------------------------------------------------------------

/**
 * The codes the ECB publishes reference rates for (Frankfurter
 * `/v2/providers/ecb/rates`, checked live 2026-09-29: these 29 plus EUR).
 * They cover most trips, so a past day's fill asks only the ECB endpoint
 * when every requested code is in here, and a past day's cached table always
 * keeps them. Historical ECB rows outside this list (e.g. BGN before 2026)
 * are kept too: persistence keys on the row's source, not only on this list.
 */
export const ECB_CODES: ReadonlySet<string> = new Set(
  (
    'AUD BRL CAD CHF CNY CZK DKK GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN ' +
    'RON SEK SGD THB TRY USD ZAR'
  ).split(' '),
);

/**
 * The rows of a PAST day worth persisting: every ECB reference row, a row for
 * any ECB-set code whichever provider answered (so a day whose ECB call
 * failed still caches the common set), and the codes the caller asked for.
 * About 30 rows plus the requested ones, instead of the ~166-code blend.
 * Today's table ('latest') is stored whole; see handler.ts.
 */
export function pastDayRowsToKeep(rows: Iterable<RateRow>, requested: ReadonlySet<string>): RateRow[] {
  const out: RateRow[] = [];
  for (const r of rows) {
    if (r.source === 'frankfurter-ecb' || ECB_CODES.has(r.quote) || requested.has(r.quote)) out.push(r);
  }
  return out;
}

/** Merge row lists; per quote the highest-priority source wins. */
export function mergeRows(...lists: RateRow[][]): Map<string, RateRow> {
  const out = new Map<string, RateRow>();
  for (const list of lists) {
    for (const row of list) {
      const prev = out.get(row.quote);
      if (!prev || SOURCE_PRIORITY[row.source] > SOURCE_PRIORITY[prev.source]) out.set(row.quote, row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross rates
// ---------------------------------------------------------------------------

/** rate(code) against EUR, 1 for EUR itself, null when unknown. */
export function eurRate(rows: ReadonlyMap<string, RateRow>, code: string): number | null {
  if (code === FX_BASE) return 1;
  return rows.get(code)?.rate ?? null;
}

/** `to` units per 1 `from` unit, or null when either side is unknown. */
export function crossRate(rows: ReadonlyMap<string, RateRow>, from: string, to: string): number | null {
  const f = eurRate(rows, from);
  const t = eurRate(rows, to);
  if (f === null || t === null) return null;
  return t / f;
}

/**
 * The publication date behind a set of codes: the OLDEST published date among
 * them (EUR has none of its own). null when no code has a row.
 */
export function effectiveDate(rows: ReadonlyMap<string, RateRow>, codes: readonly string[]): string | null {
  let oldest: string | null = null;
  for (const c of codes) {
    const r = rows.get(c);
    if (r && (oldest === null || r.publishedDate < oldest)) oldest = r.publishedDate;
  }
  return oldest;
}

/**
 * Static ISO 4217 active-code list: the filter for the currency-api fallback
 * when no Frankfurter snapshot exists yet to learn the code set from.
 */
export const ISO_4217: ReadonlySet<string> = new Set(
  (
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP ' +
    'BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP ' +
    'GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR ' +
    'KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK ' +
    'MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR ' +
    'SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS ' +
    'UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG'
  ).split(' '),
);
