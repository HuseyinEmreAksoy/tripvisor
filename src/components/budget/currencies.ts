/**
 * currencies — pure helpers behind the currency pickers (M5 Y3.2).
 * NO hooks, NO Intl, NO network — unit-test friendly.
 *
 *   COMMON_CURRENCIES     — offline fallback list for "More…" (fx-rates lists ~166).
 *   recentCurrencies      — the trip's most recently used expense currencies.
 *   suggestedCurrencies   — the chip row: home first, then recent, then the selection.
 *   filterCurrencies      — "More…" search by code or display name (accent/case-insensitive).
 */
import { normalizeCurrency, roundMoney } from '@/lib/money/currency';
import { mul, toDecimal, toNumber } from '@/lib/money/decimal';

/**
 * The currencies travellers pick most (ECB reference set + popular
 * destinations). Used when the fx-rates currency list can't load (offline).
 * Every code here has a name in the `money:currencyNames` resources.
 */
export const COMMON_CURRENCIES: readonly string[] = [
  'EUR', 'USD', 'GBP', 'TRY', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY',
  'HKD', 'SGD', 'KRW', 'THB', 'IDR', 'MYR', 'PHP', 'INR', 'AED', 'SAR',
  'QAR', 'EGP', 'MAD', 'ZAR', 'BRL', 'MXN', 'ARS', 'CLP', 'SEK', 'NOK',
  'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'RSD', 'GEL', 'AZN',
  'UAH', 'ILS', 'VND',
];

/** Minimal row shape (a TripExpense satisfies it). */
export interface CurrencyUseRow {
  currency?: string | null;
  created_at?: string | null;
  deleted?: boolean;
}

/**
 * Distinct expense currencies, most recently used first (by `created_at`),
 * excluding `exclude` (the home currency, shown first anyway). Legacy rows
 * with a NULL currency are the home currency and are skipped.
 */
export function recentCurrencies(
  rows: readonly CurrencyUseRow[] | null | undefined,
  exclude?: string | null,
  max = 4,
): string[] {
  const skip = normalizeCurrency(exclude);
  const latest = new Map<string, string>();
  for (const row of rows ?? []) {
    if (!row || row.deleted === true) continue;
    const code = normalizeCurrency(row.currency);
    if (!code || code === skip) continue;
    const at = row.created_at ?? '';
    const seen = latest.get(code);
    if (seen === undefined || at > seen) latest.set(code, at);
  }
  return [...latest.entries()]
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1].localeCompare(a[1])))
    .slice(0, max)
    .map(([code]) => code);
}

/**
 * The chip row: `home` first, then `recent` (in order), then `extra`
 * fallbacks until `max` chips, and finally the current `selected` code if it
 * isn't already there (so a pick from "More…" stays visible). De-duplicated,
 * upper-cased, invalid codes dropped.
 */
export function suggestedCurrencies(opts: {
  home?: string | null;
  recent?: readonly string[];
  extra?: readonly string[];
  selected?: string | null;
  max?: number;
}): string[] {
  const max = opts.max ?? 5;
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const code = normalizeCurrency(value);
    if (code && !out.includes(code)) out.push(code);
  };
  push(opts.home);
  for (const code of opts.recent ?? []) {
    if (out.length >= max) break;
    push(code);
  }
  for (const code of opts.extra ?? []) {
    if (out.length >= max) break;
    push(code);
  }
  push(opts.selected);
  return out;
}

/** Lower-case, accent-free, Turkish dotless/dotted i folded — for search only. */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .trim();
}

/**
 * Filter `codes` by a free-text query matched against the code and the
 * display name. Code-prefix matches rank first, then name matches; the
 * original order is kept within each group. Empty query → all codes.
 */
export function filterCurrencies(
  codes: readonly string[],
  query: string,
  nameOf: (code: string) => string,
): string[] {
  const q = foldForSearch(query);
  if (!q) return [...codes];
  const byCode: string[] = [];
  const byName: string[] = [];
  for (const code of codes) {
    if (foldForSearch(code).startsWith(q)) byCode.push(code);
    else if (foldForSearch(nameOf(code)).includes(q)) byName.push(code);
  }
  return [...byCode, ...byName];
}

/**
 * The full "More…" list: the server list (when loaded) merged with the
 * common fallback, de-duplicated, common/popular codes first, then A→Z.
 */
export function allCurrencyCodes(serverCodes?: readonly string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of COMMON_CURRENCIES) {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  const rest = (serverCodes ?? [])
    .map((c) => normalizeCurrency(c))
    .filter((c): c is string => c !== null && !seen.has(c));
  rest.sort();
  for (const code of rest) {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/**
 * A budget converted into a new home currency at `rate` (new units per old
 * unit), rounded to the new currency's minor units (JPY 0, KWD 3). Exact
 * decimal math, rounded once.
 */
export function convertBudget(amount: number, rate: number, to: string): number {
  return toNumber(roundMoney(mul(toDecimal(amount), toDecimal(rate)), to));
}
