/**
 * Trip money totals (M5 Y2.2): home-currency totals by kind, category, day
 * and original currency, plus the "rate pending" report.
 *
 * Every sum is exact (decimal.ts), so totals are independent of row order and
 * sum(byCategory) === sum(byDay) === total, to the last digit. Pending rows
 * are NEVER inside a converted total: they are counted and summed per
 * ORIGINAL currency in `pending` (the get_my_trip_stats pending_* mirror).
 */
import { type Decimal, ZERO, add, cmp, sub, toNumber, tryDecimal } from './decimal';
import { moneyValue, normalizeCurrency } from './currency';
import { type ConversionContext, convertExpense } from './convert';
import type {
  CategoryTotals,
  ConversionMethod,
  CurrencyBreakdown,
  CurrencyCode,
  DayTotals,
  KindTotals,
  MoneyCategory,
  MoneyExpense,
  RowMoney,
  TripMoneySummary,
} from './types';

/** Fixed category grid, in display order (lockstep with the 0010 CHECK). */
export const MONEY_CATEGORIES: readonly MoneyCategory[] = [
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
] as const;

type Kind = 'actual' | 'estimated';

interface KindAcc {
  actual: Decimal;
  estimated: Decimal;
}

function kindAcc(): KindAcc {
  return { actual: ZERO, estimated: ZERO };
}

function bump(acc: KindAcc, kind: Kind, amount: Decimal): void {
  acc[kind] = add(acc[kind], amount);
}

function kindTotals(acc: KindAcc, currency: CurrencyCode): KindTotals {
  return { actual: moneyValue(acc.actual, currency), estimated: moneyValue(acc.estimated, currency) };
}

function isMoneyCategory(value: unknown): value is MoneyCategory {
  return typeof value === 'string' && (MONEY_CATEGORIES as readonly string[]).includes(value);
}

function kindOf(value: unknown): Kind | null {
  return value === 'actual' || value === 'estimated' ? value : null;
}

function dayIndexOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export interface SummarizeOptions extends ConversionContext {
  /** `trips.total_budget` (home units); null/undefined = no budget. */
  budget?: number | string | null;
}

interface CurrencyAcc {
  count: number;
  original: KindAcc;
  converted: KindAcc;
  pending: KindAcc;
  pendingCount: number;
}

interface DayAcc {
  acc: KindAcc;
  count: number;
  pendingCount: number;
}

/**
 * Summarise one trip's expenses in its home currency. `expenses` may contain
 * other trips' rows only if the caller filtered them out first; tombstones
 * (`deleted: true`) are skipped here.
 */
export function summarizeTripMoney(expenses: Iterable<MoneyExpense>, options: SummarizeOptions): TripMoneySummary {
  const home = normalizeCurrency(options.home);
  if (!home) throw new RangeError(`summarizeTripMoney: home currency must be an ISO 4217 code (got ${String(options.home)})`);
  const ctx: ConversionContext = { ...options, home };

  const total = kindAcc();
  const byCategory = new Map<MoneyCategory, { acc: KindAcc; count: number }>();
  for (const cat of MONEY_CATEGORIES) byCategory.set(cat, { acc: kindAcc(), count: 0 });
  const byDay = new Map<number | null, DayAcc>();
  const byCurrency = new Map<CurrencyCode, CurrencyAcc>();
  const pendingActual = new Map<CurrencyCode, Decimal>();
  const pendingEstimated = new Map<CurrencyCode, Decimal>();
  const pendingIds: string[] = [];
  const rows: Record<string, RowMoney> = {};
  const methods: Record<ConversionMethod, number> = {
    same_currency: 0,
    legacy: 0,
    frozen: 0,
    rederived: 0,
    today: 0,
  };
  const counts = { total: 0, converted: 0, pending: 0, invalid: 0 };

  for (const expense of expenses) {
    if (!expense || expense.deleted === true) continue;
    counts.total += 1;

    const kind = kindOf(expense.kind);
    if (!kind) {
      counts.invalid += 1;
      rows[expense.id] = { status: 'invalid', reason: 'kind' };
      continue;
    }
    const conversion = convertExpense(expense, ctx);
    if (conversion.status === 'invalid') {
      counts.invalid += 1;
      rows[expense.id] = { status: 'invalid', reason: conversion.reason };
      continue;
    }

    // Unknown (future) categories fold into 'other' so the grid still sums to the total.
    const category = isMoneyCategory(expense.category) ? expense.category : 'other';
    const categorySlot = byCategory.get(category)!;
    categorySlot.count += 1;

    const dayIndex = dayIndexOf(expense.day_index);
    let daySlot = byDay.get(dayIndex);
    if (!daySlot) {
      daySlot = { acc: kindAcc(), count: 0, pendingCount: 0 };
      byDay.set(dayIndex, daySlot);
    }
    daySlot.count += 1;

    let currencySlot = byCurrency.get(conversion.currency);
    if (!currencySlot) {
      currencySlot = { count: 0, original: kindAcc(), converted: kindAcc(), pending: kindAcc(), pendingCount: 0 };
      byCurrency.set(conversion.currency, currencySlot);
    }
    currencySlot.count += 1;
    bump(currencySlot.original, kind, conversion.amount);

    if (conversion.status === 'converted') {
      counts.converted += 1;
      methods[conversion.method] += 1;
      bump(total, kind, conversion.homeAmount);
      bump(categorySlot.acc, kind, conversion.homeAmount);
      bump(daySlot.acc, kind, conversion.homeAmount);
      bump(currencySlot.converted, kind, conversion.homeAmount);
      rows[expense.id] = {
        status: 'converted',
        method: conversion.method,
        original: moneyValue(conversion.amount, conversion.currency),
        home: moneyValue(conversion.homeAmount, home),
        rate: toNumber(conversion.rate),
      };
    } else {
      counts.pending += 1;
      pendingIds.push(expense.id);
      daySlot.pendingCount += 1;
      currencySlot.pendingCount += 1;
      bump(currencySlot.pending, kind, conversion.amount);
      const bucket = kind === 'actual' ? pendingActual : pendingEstimated;
      bucket.set(conversion.currency, add(bucket.get(conversion.currency) ?? ZERO, conversion.amount));
      rows[expense.id] = {
        status: 'pending',
        reason: conversion.reason,
        original: moneyValue(conversion.amount, conversion.currency),
      };
    }
  }

  const categoryOut = {} as Record<MoneyCategory, CategoryTotals>;
  for (const cat of MONEY_CATEGORIES) {
    const slot = byCategory.get(cat)!;
    categoryOut[cat] = {
      ...kindTotals(slot.acc, home),
      remaining: moneyValue(sub(slot.acc.estimated, slot.acc.actual), home),
      count: slot.count,
    };
  }

  const dayOut: DayTotals[] = [...byDay.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([dayIndex, slot]) => ({
      dayIndex,
      ...kindTotals(slot.acc, home),
      count: slot.count,
      pendingCount: slot.pendingCount,
    }));

  const currencyOut: CurrencyBreakdown[] = [...byCurrency.entries()]
    .map(([currency, slot]) => ({
      currency,
      count: slot.count,
      original: kindTotals(slot.original, currency),
      converted: kindTotals(slot.converted, home),
      pending: { ...kindTotals(slot.pending, currency), count: slot.pendingCount },
      sortKey: add(slot.converted.actual, slot.converted.estimated),
    }))
    .sort((a, b) => {
      if (a.currency === home) return -1;
      if (b.currency === home) return 1;
      const byConverted = cmp(b.sortKey, a.sortKey);
      return byConverted !== 0 ? byConverted : compareCodes(a.currency, b.currency);
    })
    .map(({ sortKey: _sortKey, ...rest }) => rest);

  const budgetDec = tryDecimal(options.budget);
  const budget = budgetDec ? moneyValue(budgetDec, home) : null;
  const remaining = budgetDec ? moneyValue(sub(budgetDec, total.actual), home) : null;

  const toRecord = (map: Map<CurrencyCode, Decimal>) =>
    Object.fromEntries([...map.entries()].sort(([a], [b]) => compareCodes(a, b)).map(([c, v]) => [c, moneyValue(v, c)]));

  return {
    home,
    rateMode: options.rateMode ?? 'entry',
    total: kindTotals(total, home),
    byCategory: categoryOut,
    byDay: dayOut,
    byCurrency: currencyOut,
    pending: {
      count: counts.pending,
      ids: pendingIds,
      actualByCurrency: toRecord(pendingActual),
      estimatedByCurrency: toRecord(pendingEstimated),
    },
    budget,
    remaining,
    rows,
    counts,
    methods,
  };
}

/** Code-point order for ISO codes (locale-independent, deterministic). */
function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An all-zero summary (a trip with no expenses yet). */
export function emptyTripMoneySummary(home: CurrencyCode, options: Omit<SummarizeOptions, 'home'> = {}): TripMoneySummary {
  return summarizeTripMoney([], { ...options, home });
}
