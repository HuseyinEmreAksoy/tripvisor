/**
 * expenseMath — pure helpers for the budget surfaces (v2 M4 X2.4).
 * NO hooks, NO network, NO implicit "now" (callers pass `now`) — unit-test friendly.
 *
 *   EXPENSE_CATEGORIES      — one source for category label + emoji (category-based
 *                             budgeting only; there is deliberately no per-km cost).
 *   applyAmountKey          — reducer behind the quick-expense keypad.
 *   todayDayIndex           — "date defaults to today" → 0-based trip day index.
 *   shortDayLabel           — "Mon 12" for a trip day (or "Day N" without dates).
 *   dailySpend              — per-day ACTUAL spend for the spend strip.
 */
import type { TripExpense, TripExpenseCategory } from '@/api/types';

export interface ExpenseCategoryMeta {
  key: TripExpenseCategory;
  label: string;
  icon: string;
}

export const EXPENSE_CATEGORIES: ReadonlyArray<ExpenseCategoryMeta> = [
  { key: 'food', label: 'Food & Drink', icon: '🍽️' },
  { key: 'transport', label: 'Transport', icon: '🚆' },
  { key: 'activities', label: 'Activities', icon: '🎭' },
  { key: 'shopping', label: 'Shopping', icon: '🛍️' },
  { key: 'accommodation', label: 'Accommodation', icon: '🏨' },
  { key: 'other', label: 'Other', icon: '📦' },
];

export function categoryMeta(key: TripExpenseCategory): ExpenseCategoryMeta {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? { key, label: key, icon: '📦' };
}

// ── Keypad ──────────────────────────────────────────────────────────────────

export type AmountKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/** Max characters in the amount (e.g. "9999999.99"). */
export const MAX_AMOUNT_LENGTH = 10;

/**
 * Apply one keypad press to the amount text. Rules: a single decimal point,
 * at most 2 decimals, no leading zeros ("07" → "7"), "." alone → "0.".
 * Input that isn't a plain decimal (e.g. typed "12,5" on web) is normalized
 * to "." first so the keypad and the keyboard agree.
 */
export function applyAmountKey(text: string, key: AmountKey): string {
  const current = text.replace(',', '.');
  if (key === 'back') return current.slice(0, -1);
  if (current.length >= MAX_AMOUNT_LENGTH) return current;
  if (key === '.') {
    if (current.includes('.')) return current;
    return current.length === 0 ? '0.' : `${current}.`;
  }
  const dot = current.indexOf('.');
  if (dot >= 0 && current.length - dot > 2) return current; // 2 decimals max
  if (current === '0') return key; // replace a lone leading zero
  return current + key;
}

/** Parse the amount text; null when empty/invalid/negative. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Trip days ───────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local-calendar Date for a 'YYYY-MM-DD' string (never UTC-parsed), or null. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days from `a` to `b` (DST-safe). */
export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

/**
 * 0-based trip day index for `now`, or null when the trip has no start date
 * or `now` falls outside [0, tripDayCount).
 */
export function todayDayIndex(
  tripStartDate: string | null | undefined,
  tripDayCount: number,
  now: Date,
): number | null {
  const start = parseLocalDate(tripStartDate);
  if (!start) return null;
  const idx = daysBetween(start, now);
  return idx >= 0 && idx < tripDayCount ? idx : null;
}

/** "Mon 12" for trip day `index`, or "Day N" when the trip has no start date. */
export function shortDayLabel(tripStartDate: string | null | undefined, index: number): string {
  const start = parseLocalDate(tripStartDate);
  if (!start) return `Day ${index + 1}`;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

// ── Per-day spend ───────────────────────────────────────────────────────────

export interface DailySpend {
  /** ACTUAL spend per trip day (index = day_index). */
  days: number[];
  /** Actual spend not pinned to a day ("whole trip"). */
  unassigned: number;
  /** Largest single-day total (0 when nothing spent) — bar scale. */
  max: number;
  /** Mean over days that have any spend (0 when none). */
  averagePerActiveDay: number;
}

/**
 * Per-day ACTUAL spend. Estimated rows are plans, not spend, so they are
 * excluded. `dayCount` is a floor: an expense pinned beyond it widens the
 * strip rather than being dropped.
 */
export function dailySpend(expenses: ReadonlyArray<TripExpense>, dayCount: number): DailySpend {
  const actual = expenses.filter((e) => e.kind === 'actual' && !e.deleted);
  const maxPinned = actual.reduce(
    (m, e) => (e.day_index !== null && e.day_index > m ? e.day_index : m),
    -1,
  );
  const days = new Array<number>(Math.max(0, dayCount, maxPinned + 1)).fill(0);
  let unassigned = 0;
  for (const e of actual) {
    if (e.day_index === null || e.day_index < 0) unassigned += e.amount;
    else days[e.day_index] = (days[e.day_index] ?? 0) + e.amount;
  }
  const active = days.filter((v) => v > 0);
  return {
    days,
    unassigned,
    max: days.reduce((m, v) => Math.max(m, v), 0),
    averagePerActiveDay: active.length > 0 ? active.reduce((s, v) => s + v, 0) / active.length : 0,
  };
}
