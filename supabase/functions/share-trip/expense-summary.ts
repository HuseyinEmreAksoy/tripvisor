// share-trip — expenses SUMMARY for the public link (contract v3, M5 Y2.5).
//
// Pure module (no Deno / network imports): unit-tested in isolation and
// type-checked by the repo-root tsc.
//
// What the public link may show (0037 comment on trip_shares.show_expenses):
// home-currency totals by category + the per-currency breakdown. NEVER line
// items: no labels (free text), no days, no dates, no ids. This module only
// ever sees the columns in EXPENSE_SUMMARY_FIELDS, and its output has no
// per-row data at all.
//
// Conversion into the trip's CURRENT home currency follows the rule order of
// the analytics MV (migration 0038 §1, the Wave-1 correction that supersedes
// 0034 step 4), so the public page and the owner's stats never disagree:
//   1. currency NULL or = home                         -> x 1
//   2. fx_rate set AND fx_home_currency = home         -> x fx_rate
//   3. fx_date set AND fx_rates has both legs on fx_date
//                                                      -> x rate(home)/rate(ccy)
//                                                         (EUR-based, rate(EUR) = 1)
//   4. otherwise PENDING: excluded from every converted total and reported
//      per ORIGINAL currency instead. Never multiplied by a rate into another
//      currency, never counted 1:1.
// Amounts are not rounded to minor units here (the client rounds at display);
// only float noise below 1e-6 is trimmed.

/** Columns read from trip_expenses (tombstones are filtered in the query). */
export const EXPENSE_SUMMARY_FIELDS = 'id, category, kind, amount, currency, fx_rate, fx_date, fx_home_currency';

export interface ExpenseSummaryRow {
  category?: unknown;
  kind?: unknown;
  amount?: unknown;
  currency?: unknown;
  fx_rate?: unknown;
  fx_date?: unknown;
  fx_home_currency?: unknown;
}

export interface PublicExpenseCategoryTotal {
  category: string;
  /** Home currency, pending rows excluded. */
  actual: number;
  estimated: number;
}

export interface PublicExpenseCurrencyTotal {
  /** ISO 4217 code of the ORIGINAL amounts (a NULL currency counts as the home currency). */
  currency: string;
  /** Original amounts in `currency` (pending rows included: nothing is converted here). */
  actual: number;
  estimated: number;
  count: number;
}

export interface PublicExpenseSummary {
  /** trips.currency: the unit of `totals` and `byCategory`. */
  homeCurrency: string;
  /** Live expenses counted (pending included). */
  count: number;
  totals: { actual: number; estimated: number };
  /** Sorted by actual + estimated, largest first. */
  byCategory: PublicExpenseCategoryTotal[];
  /** Sorted by count, then code. */
  byCurrency: PublicExpenseCurrencyTotal[];
  pending: {
    count: number;
    actualByCurrency: Record<string, number>;
    estimatedByCurrency: Record<string, number>;
  };
}

const ISO = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function code(v: unknown): string | null {
  return typeof v === 'string' && ISO.test(v) ? v : null;
}

function day(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const d = v.slice(0, 10);
  return DATE.test(d) ? d : null;
}

/** Trim float noise only; display rounding to minor units is the client's job. */
function tidy(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

export function rateKey(date: string, quote: string): string {
  return `${date}|${quote}`;
}

/** EUR-based rates: `rateKey(date, quote)` -> quote units per 1 EUR. */
export type RateTable = ReadonlyMap<string, number>;

/**
 * The fx_rates rows rule 3 would read: distinct dates and quote codes (EUR
 * excluded, rate(EUR) = 1). Empty when no row reaches rule 3, so the caller
 * can skip the query.
 */
export function rateLookupsNeeded(
  rows: readonly ExpenseSummaryRow[],
  home: string,
): { dates: string[]; quotes: string[] } {
  const dates = new Set<string>();
  const quotes = new Set<string>();
  for (const r of rows) {
    const ccy = code(r.currency);
    if (ccy === null || ccy === home) continue; // rule 1
    if (num(r.fx_rate) !== null && r.fx_home_currency === home) continue; // rule 2
    const d = day(r.fx_date);
    if (!d) continue; // straight to pending
    dates.add(d);
    if (ccy !== 'EUR') quotes.add(ccy);
    if (home !== 'EUR') quotes.add(home);
  }
  return { dates: [...dates].sort(), quotes: [...quotes].sort() };
}

/** Factor into `home` for one row, or null = pending (rule 4). */
export function homeRate(row: ExpenseSummaryRow, home: string, rates: RateTable): number | null {
  const ccy = code(row.currency);
  if (ccy === null || ccy === home) return 1;
  const frozen = num(row.fx_rate);
  if (frozen !== null && frozen > 0 && row.fx_home_currency === home) return frozen;
  const d = day(row.fx_date);
  if (!d) return null;
  const toHome = home === 'EUR' ? 1 : rates.get(rateKey(d, home));
  const toCcy = ccy === 'EUR' ? 1 : rates.get(rateKey(d, ccy));
  if (toHome === undefined || toCcy === undefined || !(toHome > 0) || !(toCcy > 0)) return null;
  return toHome / toCcy;
}

/** The whole public summary. Rows with a non-numeric or negative amount are ignored. */
export function summarizeExpenses(
  rows: readonly ExpenseSummaryRow[],
  home: string,
  rates: RateTable,
): PublicExpenseSummary {
  const totals = { actual: 0, estimated: 0 };
  const byCategory = new Map<string, { actual: number; estimated: number }>();
  const byCurrency = new Map<string, { actual: number; estimated: number; count: number }>();
  const pending = {
    count: 0,
    actualByCurrency: {} as Record<string, number>,
    estimatedByCurrency: {} as Record<string, number>,
  };
  let count = 0;

  for (const r of rows) {
    const amount = num(r.amount);
    if (amount === null || amount < 0) continue;
    const kind: 'actual' | 'estimated' = r.kind === 'actual' ? 'actual' : 'estimated';
    const category = typeof r.category === 'string' && r.category ? r.category : 'other';
    const ccy = code(r.currency) ?? home;
    count += 1;

    const cur = byCurrency.get(ccy) ?? { actual: 0, estimated: 0, count: 0 };
    cur[kind] += amount;
    cur.count += 1;
    byCurrency.set(ccy, cur);

    const rate = homeRate(r, home, rates);
    if (rate === null) {
      pending.count += 1;
      const bucket = kind === 'actual' ? pending.actualByCurrency : pending.estimatedByCurrency;
      bucket[ccy] = (bucket[ccy] ?? 0) + amount;
      continue;
    }
    const converted = amount * rate;
    totals[kind] += converted;
    const cat = byCategory.get(category) ?? { actual: 0, estimated: 0 };
    cat[kind] += converted;
    byCategory.set(category, cat);
  }

  const tidyRecord = (rec: Record<string, number>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, tidy(v)]));

  return {
    homeCurrency: home,
    count,
    totals: { actual: tidy(totals.actual), estimated: tidy(totals.estimated) },
    byCategory: [...byCategory.entries()]
      .map(([category, t]) => ({ category, actual: tidy(t.actual), estimated: tidy(t.estimated) }))
      .sort((a, b) => b.actual + b.estimated - (a.actual + a.estimated) || a.category.localeCompare(b.category)),
    byCurrency: [...byCurrency.entries()]
      .map(([currency, t]) => ({ currency, actual: tidy(t.actual), estimated: tidy(t.estimated), count: t.count }))
      .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency)),
    pending: {
      count: pending.count,
      actualByCurrency: tidyRecord(pending.actualByCurrency),
      estimatedByCurrency: tidyRecord(pending.estimatedByCurrency),
    },
  };
}
