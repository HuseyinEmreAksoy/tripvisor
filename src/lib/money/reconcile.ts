/**
 * "Rate pending" reconciliation + home-currency-change planning (M5 Y2.2).
 * Pure helpers; the I/O lives in src/api/expense-fx.ts.
 *
 *   - A row NEEDS A FILL when it has a foreign currency and no frozen rate
 *     (`fx_rate` NULL): the reconciler fetches `rate(currency → home)` for its
 *     fx_date and writes `{ fx_rate, fx_date, fx_home_currency }`.
 *   - A row NEEDS RE-DERIVATION when its frozen rate converts into an OLD
 *     home (the owner changed `trips.currency`). It is NOT rewritten: the
 *     frozen rate is the historical record. Views re-derive it from the EUR
 *     table on fx_date (step 3), so the table must be warm for that date.
 *
 * Dates are calendar strings ('YYYY-MM-DD'). "Today" is the device's LOCAL
 * calendar day (trip dates are local, see src/lib/tripToday.ts).
 */
import { normalizeCurrency, FX_BASE } from './currency';
import { isIsoDate } from './convert';
import { tryDecimal } from './decimal';
import type { CurrencyCode, IsoDate, MoneyExpense, RateBook } from './types';

/** fx-rates request date meaning "today's table" (fx.ts / the Edge Function). */
export const LATEST_REQUEST = 'latest';

/** Local calendar date of `date` as 'YYYY-MM-DD'. */
export function localIsoDate(date: Date = new Date()): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `date` + `days` (calendar arithmetic, DST-free). */
export function addDaysIso(date: IsoDate, days: number): IsoDate {
  if (!isIsoDate(date)) throw new RangeError(`addDaysIso: not a date (${date})`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * The calendar date an expense "happened" on, for picking its rate:
 *   1. an existing fx_date,
 *   2. else trip start_date + day_index (0-based, like trip_places),
 *   3. else the created_at day (UTC, as 0034's backfill used),
 *   4. else today.
 * Clamped to `today`: a planned expense on a future trip day uses today's rate
 * (the rate the traveller knows now; fx-rates refuses future dates).
 */
export function wantedRateDate(
  expense: Pick<MoneyExpense, 'fx_date' | 'day_index' | 'created_at'>,
  opts: { tripStartDate?: string | null; today?: IsoDate } = {},
): IsoDate {
  const today = opts.today ?? localIsoDate();
  let date: string | null = null;
  if (isIsoDate(expense.fx_date)) date = expense.fx_date;
  else if (
    isIsoDate(opts.tripStartDate) &&
    typeof expense.day_index === 'number' &&
    Number.isInteger(expense.day_index) &&
    expense.day_index >= 0
  ) {
    date = addDaysIso(opts.tripStartDate, expense.day_index);
  } else if (typeof expense.created_at === 'string' && isIsoDate(expense.created_at.slice(0, 10))) {
    date = expense.created_at.slice(0, 10);
  }
  if (!date || date > today) return today;
  return date;
}

/**
 * The fx-rates `date` parameter for a wanted rate date: past days go as-is
 * (their table is final and cached forever), today or later is 'latest'.
 */
export function fxRequestDate(date: IsoDate, today: IsoDate = localIsoDate()): string {
  return isIsoDate(date) && date < today ? date : LATEST_REQUEST;
}

/** True when `expense` has a foreign currency and no frozen rate yet (fx_rate NULL). */
export function needsRateFill(expense: MoneyExpense, home: CurrencyCode | null | undefined): boolean {
  if (expense.deleted === true) return false;
  const h = normalizeCurrency(home);
  const currency = normalizeCurrency(expense.currency);
  if (!h || !currency || currency === h) return false;
  const rate = tryDecimal(expense.fx_rate);
  return rate === null || rate.m <= BigInt(0);
}

/** True when `expense` is frozen into a home other than `home` (re-derive from the table). */
export function needsRederive(expense: MoneyExpense, home: CurrencyCode | null | undefined): boolean {
  if (expense.deleted === true) return false;
  const h = normalizeCurrency(home);
  const currency = normalizeCurrency(expense.currency);
  if (!h || !currency || currency === h) return false;
  const rate = tryDecimal(expense.fx_rate);
  if (rate === null || rate.m <= BigInt(0)) return false;
  return normalizeCurrency(expense.fx_home_currency) !== h;
}

/** One network fetch the reconciler makes: all rows of one (from, to, date). */
export interface RateFillGroup {
  tripId: string;
  from: CurrencyCode;
  to: CurrencyCode;
  /** The calendar date whose rate is wanted (becomes fx_date when no better one comes back). */
  date: IsoDate;
  /** fx-rates request date ('latest' for today). */
  requestDate: string;
  ids: string[];
}

/**
 * Group the rows that need a fill by (trip home, currency, date). Rows whose
 * trip home is unknown (`homeOf` → null) are skipped: without the home there
 * is nothing correct to fill.
 */
export function planRateFills(
  expenses: Iterable<MoneyExpense>,
  homeOf: (tripId: string) => CurrencyCode | null | undefined,
  opts: { today?: IsoDate; startDateOf?: (tripId: string) => string | null | undefined } = {},
): RateFillGroup[] {
  const today = opts.today ?? localIsoDate();
  const groups = new Map<string, RateFillGroup>();
  for (const expense of expenses) {
    if (!expense?.trip_id) continue;
    const home = normalizeCurrency(homeOf(expense.trip_id));
    if (!home || !needsRateFill(expense, home)) continue;
    const from = normalizeCurrency(expense.currency)!;
    const date = wantedRateDate(expense, { today, tripStartDate: opts.startDateOf?.(expense.trip_id) ?? null });
    const requestDate = fxRequestDate(date, today);
    const key = `${expense.trip_id}|${from}|${home}|${requestDate}`;
    let group = groups.get(key);
    if (!group) {
      group = { tripId: expense.trip_id, from, to: home, date, requestDate, ids: [] };
      groups.set(key, group);
    }
    group.ids.push(expense.id);
  }
  return [...groups.values()];
}

/** The reconciler's write: freeze `rate` (home per 1 original) for `rateDate` into `home`. */
export function rateFillPatch(
  rate: number,
  rateDate: IsoDate,
  home: CurrencyCode,
): { fx_rate: number; fx_date: IsoDate; fx_home_currency: CurrencyCode } {
  const h = normalizeCurrency(home);
  if (!h) throw new RangeError(`rateFillPatch: home must be an ISO 4217 code (got ${home})`);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`rateFillPatch: rate must be a number > 0 (got ${rate})`);
  }
  if (!isIsoDate(rateDate)) throw new RangeError(`rateFillPatch: not a date (${rateDate})`);
  return { fx_rate: rate, fx_date: rateDate, fx_home_currency: h };
}

/** A day of the EUR table that step 3 needs, with the codes it needs from it. */
export interface RateNeed {
  date: IsoDate;
  /** Codes other than EUR (sorted, unique). */
  currencies: CurrencyCode[];
}

function addNeed(map: Map<string, Set<string>>, date: string, codes: string[]): void {
  let set = map.get(date);
  if (!set) {
    set = new Set();
    map.set(date, set);
  }
  for (const c of codes) if (c !== FX_BASE) set.add(c);
}

function needsFromMap(map: Map<string, Set<string>>): RateNeed[] {
  return [...map.entries()]
    .filter(([, set]) => set.size > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, set]) => ({ date, currencies: [...set].sort() }));
}

/**
 * Days (and codes) of the EUR table that step 3 would read for these rows
 * under `home`: every foreign row that is NOT frozen into `home` and has an
 * fx_date. This is exactly "warm fx-rates for every distinct fx_date" after a
 * home-currency change, and the table read a summary needs.
 */
export function rateNeeds(expenses: Iterable<MoneyExpense>, home: CurrencyCode): RateNeed[] {
  const h = normalizeCurrency(home);
  if (!h) return [];
  const map = new Map<string, Set<string>>();
  for (const expense of expenses) {
    if (!expense || expense.deleted === true) continue;
    const currency = normalizeCurrency(expense.currency);
    if (!currency || currency === h) continue;
    const rate = tryDecimal(expense.fx_rate);
    const frozenIntoHome = rate !== null && rate.m > BigInt(0) && normalizeCurrency(expense.fx_home_currency) === h;
    if (frozenIntoHome || !isIsoDate(expense.fx_date)) continue;
    addNeed(map, expense.fx_date, [currency, h]);
  }
  return needsFromMap(map);
}

/** Merge several need lists (e.g. several trips with different homes). */
export function mergeRateNeeds(lists: Iterable<RateNeed[]>): RateNeed[] {
  const map = new Map<string, Set<string>>();
  for (const list of lists) for (const need of list) addNeed(map, need.date, need.currencies);
  return needsFromMap(map);
}

/** The subset of `needs` the book cannot answer yet (a code missing on that date). */
export function missingRateNeeds(book: RateBook | undefined, needs: RateNeed[]): RateNeed[] {
  const out: RateNeed[] = [];
  for (const need of needs) {
    const day = book?.[need.date];
    const missing = need.currencies.filter((c) => {
      const r = day?.[c];
      return typeof r !== 'number' || !Number.isFinite(r) || r <= 0;
    });
    if (missing.length > 0) out.push({ date: need.date, currencies: need.currencies });
  }
  return out;
}

/** What a home-currency change will do — for the Y3.2 confirm dialog. */
export interface HomeChangePlan {
  from: CurrencyCode | null;
  to: CurrencyCode;
  /** Live rows. */
  total: number;
  /** Rows already in the new home currency (converted at 1 afterwards). */
  alreadyInNewHome: number;
  /** Rows frozen into the new home already (their frozen rate keeps applying). */
  frozenIntoNewHome: number;
  /** Rows that will be re-derived from the EUR table on their fx_date. */
  toRederive: number;
  /** Rows with no fx_date: they stay pending after the change until edited. */
  withoutDate: number;
  /** Table days to warm right after the change (then call warm fx for them). */
  needs: RateNeed[];
}

export function planHomeCurrencyChange(
  expenses: Iterable<MoneyExpense>,
  fromHome: CurrencyCode | null | undefined,
  toHome: CurrencyCode,
): HomeChangePlan {
  const to = normalizeCurrency(toHome);
  if (!to) throw new RangeError(`planHomeCurrencyChange: not an ISO 4217 code (${toHome})`);
  const from = normalizeCurrency(fromHome);
  const rows = [...expenses].filter((e) => e && e.deleted !== true);
  let alreadyInNewHome = 0;
  let frozenIntoNewHome = 0;
  let toRederive = 0;
  let withoutDate = 0;
  for (const e of rows) {
    // A legacy NULL currency means "the trip's home": it follows the home to the new one.
    const currency: CurrencyCode = normalizeCurrency(e.currency) ?? to;
    if (currency === to) {
      alreadyInNewHome += 1;
      continue;
    }
    const rate = tryDecimal(e.fx_rate);
    if (rate !== null && rate.m > BigInt(0) && normalizeCurrency(e.fx_home_currency) === to) {
      frozenIntoNewHome += 1;
      continue;
    }
    if (isIsoDate(e.fx_date)) toRederive += 1;
    else withoutDate += 1;
  }
  return {
    from,
    to,
    total: rows.length,
    alreadyInNewHome,
    frozenIntoNewHome,
    toRederive,
    withoutDate,
    needs: rateNeeds(rows, to),
  };
}
