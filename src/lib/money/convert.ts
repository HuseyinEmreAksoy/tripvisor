/**
 * Expense → home-currency conversion (M5 Y2.2, ADR-0012, 0038 CORRECTION).
 *
 * THE order (the analytics MV in 0038 and the TripExpense JSDoc use the same):
 *   1. currency NULL or === home                              → × 1
 *   2. fx_rate set AND fx_home_currency === home              → × fx_rate
 *   3. fx_date set AND the EUR table has both legs on fx_date → × rate(home) / rate(currency)
 *      (rate('EUR') = 1; exact-date lookup, like the MV)
 *   4. otherwise PENDING — excluded from every converted total and reported
 *      per ORIGINAL currency. A frozen rate into ANOTHER home is never used,
 *      and a pending row is never counted 1:1.
 *
 * Pure and exact (decimal.ts). Nothing here rounds; MoneyValue construction
 * (currency.ts) rounds once, for display.
 */
import { type Decimal, type DecimalInput, ONE, div, fromNumber, mul, toDecimal, tryDecimal } from './decimal';
import { FX_BASE, moneyValue, normalizeCurrency } from './currency';
import type {
  ConversionMethod,
  CurrencyCode,
  DayRates,
  MoneyExpense,
  MoneyValue,
  PendingReason,
  RateBook,
  RateMode,
} from './types';

/** `RateBook` key for today's table (RateMode 'today'). */
export const LATEST = 'latest';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' that is a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** EUR-based rate of `code` in one day's table; EUR is 1. null when missing or not > 0. */
export function eurRate(day: DayRates | undefined, code: CurrencyCode): Decimal | null {
  if (code === FX_BASE) return ONE;
  const raw = day?.[code];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return fromNumber(raw);
}

/**
 * Fractional digits kept for a cross rate. Table rates span ~1e-4 (e.g. EUR
 * per IDR) to ~1e6, so a ratio can be ~1e-10: 30 digits still leaves ≥ 20
 * significant ones (the MV's numeric division keeps ~16+).
 */
export const CROSS_RATE_SCALE = 30;

/**
 * `to` units per 1 `from` unit from one EUR-based day table: rate(to) / rate(from).
 * null when either leg is missing. Identity is 1 even with no table.
 */
export function crossRate(day: DayRates | undefined, from: CurrencyCode, to: CurrencyCode): Decimal | null {
  if (from === to) return ONE;
  const rFrom = eurRate(day, from);
  const rTo = eurRate(day, to);
  if (!rFrom || !rTo) return null;
  return div(rTo, rFrom, CROSS_RATE_SCALE);
}

/** {@link crossRate} for a date in a {@link RateBook}. */
export function bookRate(book: RateBook | undefined, date: string, from: CurrencyCode, to: CurrencyCode): Decimal | null {
  if (from === to) return ONE;
  return crossRate(book?.[date], from, to);
}

export interface ConversionContext {
  /** The trip's CURRENT home currency (`trips.currency`). */
  home: CurrencyCode;
  /** EUR-based rates by date (the `fx_rates` rows for the expenses' fx_dates). Step 3. */
  book?: RateBook;
  /** Default 'entry'. */
  rateMode?: RateMode;
  /** Today's EUR-based table (RateMode 'today'); falls back to `book.latest`. */
  todayRates?: DayRates;
}

export type ExpenseConversion =
  | {
      status: 'converted';
      method: ConversionMethod;
      /** Normalised original currency. */
      currency: CurrencyCode;
      home: CurrencyCode;
      /** Original amount (exact). */
      amount: Decimal;
      /** Home units per 1 original unit that was applied (exact or 20-digit). */
      rate: Decimal;
      /** amount × rate, exact (unrounded). */
      homeAmount: Decimal;
    }
  | {
      status: 'pending';
      reason: PendingReason;
      currency: CurrencyCode;
      home: CurrencyCode;
      amount: Decimal;
    }
  | {
      status: 'invalid';
      reason: 'amount' | 'currency';
    };

function converted(
  method: ConversionMethod,
  currency: CurrencyCode,
  home: CurrencyCode,
  amount: Decimal,
  rate: Decimal,
): ExpenseConversion {
  return { status: 'converted', method, currency, home, amount, rate, homeAmount: mul(amount, rate) };
}

/**
 * Convert ONE expense into `ctx.home`, following the order in the header.
 * Tombstones are not filtered here (callers skip `deleted` rows).
 */
export function convertExpense(expense: MoneyExpense, ctx: ConversionContext): ExpenseConversion {
  const home = normalizeCurrency(ctx.home);
  if (!home) throw new RangeError(`convertExpense: home currency must be an ISO 4217 code (got ${String(ctx.home)})`);

  const amount = tryDecimal(expense.amount);
  if (!amount || amount.m < BigInt(0)) return { status: 'invalid', reason: 'amount' };

  let currency: CurrencyCode;
  let legacy = false;
  if (expense.currency === null || expense.currency === undefined || expense.currency === '') {
    currency = home;
    legacy = true;
  } else {
    const normalized = normalizeCurrency(expense.currency);
    if (!normalized) return { status: 'invalid', reason: 'currency' };
    currency = normalized;
  }

  // 1. Same currency (or a legacy NULL row): exactly 1, in every mode.
  if (currency === home) return converted(legacy ? 'legacy' : 'same_currency', currency, home, amount, ONE);

  if ((ctx.rateMode ?? 'entry') === 'today') {
    const today = ctx.todayRates ?? ctx.book?.[LATEST];
    const rate = crossRate(today, currency, home);
    return rate
      ? converted('today', currency, home, amount, rate)
      : { status: 'pending', reason: 'today_rate_missing', currency, home, amount };
  }

  // 2. Frozen rate — ONLY when it converts into the current home.
  const frozen = tryDecimal(expense.fx_rate);
  const frozenValid = frozen !== null && frozen.m > BigInt(0);
  if (frozenValid && normalizeCurrency(expense.fx_home_currency) === home) {
    return converted('frozen', currency, home, amount, frozen);
  }

  // 3. Re-derive from the EUR table on fx_date (exact-date lookup, as the MV does).
  const fxDate = expense.fx_date;
  if (isIsoDate(fxDate)) {
    const rate = bookRate(ctx.book, fxDate, currency, home);
    if (rate) return converted('rederived', currency, home, amount, rate);
  }

  // 4. Pending.
  const reason: PendingReason = !isIsoDate(fxDate) ? 'no_fx_date' : frozenValid ? 'home_changed' : 'rate_pending';
  return { status: 'pending', reason, currency, home, amount };
}

/** Converted amount of one expense as a MoneyValue in `ctx.home`, or null when pending/invalid. */
export function expenseInHome(expense: MoneyExpense, ctx: ConversionContext): MoneyValue | null {
  const c = convertExpense(expense, ctx);
  return c.status === 'converted' ? moneyValue(c.homeAmount, c.home) : null;
}

/** `amount × rate` as a MoneyValue in `to` (the live "≈ ₺1.234,50" preview while typing). */
export function applyRate(amount: DecimalInput, rate: DecimalInput, to: CurrencyCode): MoneyValue {
  return moneyValue(mul(toDecimal(amount), toDecimal(rate)), to);
}

/**
 * Convert an arbitrary amount `from` → `to` with a day's EUR table (or the
 * identity). null when a leg is missing — callers show "rate unavailable",
 * never a 1:1 guess.
 */
export function convertAmount(
  amount: DecimalInput,
  from: CurrencyCode,
  to: CurrencyCode,
  day?: DayRates,
): MoneyValue | null {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (!f || !t) return null;
  const rate = crossRate(day, f, t);
  return rate ? applyRate(amount, rate, t) : null;
}
