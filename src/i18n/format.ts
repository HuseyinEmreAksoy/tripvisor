/**
 * Shared locale-aware formatters (ADR-0011 §4). Everything follows the ACTIVE
 * APP LANGUAGE (Profile → Language), never the device region on its own:
 * Turkish renders `₺1.234,50` / `29 Eyl 2026`, English `€1,234.50` / `Sep 29`.
 *
 * Plain functions (not hooks), so they work in lists, memos and non-React
 * code. A component re-renders on a language switch as long as it calls
 * `useT()` (or `useAppLocale()`); the formatters read the language at call
 * time. Every function takes an optional trailing `lng` to force a language
 * (e.g. the English original of a legal page).
 *
 * `Intl` objects are cached per locale + options: list rows can call these
 * thousands of times.
 */
import { appLocale, currentLanguage, i18n } from './instance';
import type { AppLanguage } from './languages';

export type DateInput = Date | string | number;

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.Collator>(
  kind: string,
  locale: string,
  options: object,
  make: () => T,
): T {
  const key = `${kind}|${locale}|${JSON.stringify(options)}`;
  let hit = cache.get(key) as T | undefined;
  if (!hit) {
    hit = make();
    cache.set(key, hit);
  }
  return hit;
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached('n', locale, options, () => new Intl.NumberFormat(locale, options));
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached('d', locale, options, () => new Intl.DateTimeFormat(locale, options));
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a date input. `YYYY-MM-DD` (how trip/day dates are stored) becomes
 * LOCAL midnight, not UTC, so "2026-06-12" never renders as 11 June west of
 * Greenwich. Returns null for anything unparseable.
 */
export function toDate(input: DateInput | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'string') {
    const m = DATE_ONLY.exec(input.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Explicit field sets (no `dateStyle`) so Hermes and browsers agree. */
export const DATE_STYLES = {
  /** 29 Sep · 29 Eyl · Sep 29 */
  short: { day: 'numeric', month: 'short' },
  /** 29 Sep 2026 · 29 Eyl 2026 · Sep 29, 2026 */
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  /** 29 September 2026 · 29 Eylül 2026 */
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  /** Tuesday 29 September 2026 · 29 Eylül 2026 Salı */
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  /** Tue 29 Sep · 29 Eyl Sal */
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  /** Tuesday 29 September · 29 Eylül Salı */
  weekdayLong: { weekday: 'long', day: 'numeric', month: 'long' },
  /** Tue · Sal */
  weekdayOnly: { weekday: 'short' },
  /** September 2026 · Eylül 2026 */
  monthYear: { month: 'long', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof DATE_STYLES;

/** Formats a date in the app language. Unparseable input → ''. */
export function formatDate(input: DateInput | null | undefined, style: DateStyle = 'medium', lng?: AppLanguage): string {
  const d = toDate(input);
  if (!d) return '';
  return dateFormat(appLocale(lng), DATE_STYLES[style]).format(d);
}

/** 14:05 (tr, en-GB) · 2:05 PM (en-US). */
export function formatTime(input: DateInput | null | undefined, lng?: AppLanguage): string {
  const d = toDate(input);
  if (!d) return '';
  return dateFormat(appLocale(lng), { hour: 'numeric', minute: '2-digit' }).format(d);
}

/** 29 Sep 2026, 14:05. */
export function formatDateTime(input: DateInput | null | undefined, lng?: AppLanguage): string {
  const d = toDate(input);
  if (!d) return '';
  return dateFormat(appLocale(lng), { ...DATE_STYLES.medium, hour: 'numeric', minute: '2-digit' }).format(d);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A trip's date span: `12–18 Haz 2026`, `Jun 28 – Jul 3, 2026`. Uses
 * `Intl.DateTimeFormat#formatRange` where the engine has it (browsers,
 * Node); Hermes gets `12 Haz – 18 Haz 2026`. One date → that date; none → null.
 */
export function formatDateRange(
  start: DateInput | null | undefined,
  end: DateInput | null | undefined,
  lng?: AppLanguage,
): string | null {
  const s = toDate(start);
  const e = toDate(end);
  if (s && e) {
    if (sameDay(s, e)) return formatDate(s, 'medium', lng);
    const fmt = dateFormat(appLocale(lng), DATE_STYLES.medium) as Intl.DateTimeFormat & {
      formatRange?: (a: Date, b: Date) => string;
    };
    if (typeof fmt.formatRange === 'function') {
      try {
        return fmt.formatRange(s, e);
      } catch {
        // Fall through to the manual join.
      }
    }
    const first = s.getFullYear() === e.getFullYear() ? formatDate(s, 'short', lng) : formatDate(s, 'medium', lng);
    return `${first} – ${formatDate(e, 'medium', lng)}`;
  }
  const only = s ?? e;
  return only ? formatDate(only, 'medium', lng) : null;
}

type RelativeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function relativePhrase(value: number, unit: RelativeUnit, lng?: AppLanguage): string {
  const count = Math.abs(value);
  const opts = { count, lng: lng ?? currentLanguage() };
  // Literal keys per unit keep them type-checked and visible to i18n:check.
  const future: Record<RelativeUnit, () => string> = {
    minute: () => i18n.t('common:relative.future.minute', opts),
    hour: () => i18n.t('common:relative.future.hour', opts),
    day: () => i18n.t('common:relative.future.day', opts),
    week: () => i18n.t('common:relative.future.week', opts),
    month: () => i18n.t('common:relative.future.month', opts),
    year: () => i18n.t('common:relative.future.year', opts),
  };
  const past: Record<RelativeUnit, () => string> = {
    minute: () => i18n.t('common:relative.past.minute', opts),
    hour: () => i18n.t('common:relative.past.hour', opts),
    day: () => i18n.t('common:relative.past.day', opts),
    week: () => i18n.t('common:relative.past.week', opts),
    month: () => i18n.t('common:relative.past.month', opts),
    year: () => i18n.t('common:relative.past.year', opts),
  };
  return (value >= 0 ? future : past)[unit]();
}

/**
 * "3 days ago" / "3 gün sonra" / "yesterday". Built from translation strings
 * rather than `Intl.RelativeTimeFormat` (missing on Hermes), so all three
 * platforms print exactly the same text.
 *
 * `granularity: 'day'` compares calendar days (today / tomorrow / in 12 days),
 * which is what trip countdowns want; `auto` picks the largest fitting unit.
 */
export function formatRelative(
  input: DateInput | null | undefined,
  options: { now?: Date; granularity?: 'auto' | 'day'; lng?: AppLanguage } = {},
): string {
  const d = toDate(input);
  if (!d) return '';
  const now = options.now ?? new Date();
  const lng = options.lng;
  const t = (key: 'now' | 'today' | 'yesterday' | 'tomorrow') =>
    i18n.t(`common:relative.${key}`, { lng: lng ?? currentLanguage() });

  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (options.granularity === 'day') {
    if (days === 0) return t('today');
    if (days === 1) return t('tomorrow');
    if (days === -1) return t('yesterday');
    return relativeDays(days, lng);
  }

  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 45_000) return t('now');
  if (abs < 45 * MINUTE) return relativePhrase(Math.sign(diff) * Math.max(1, Math.round(abs / MINUTE)), 'minute', lng);
  if (abs < 22 * HOUR || days === 0) {
    return relativePhrase(Math.sign(diff) * Math.max(1, Math.round(abs / HOUR)), 'hour', lng);
  }
  if (days === 1) return t('tomorrow');
  if (days === -1) return t('yesterday');
  return relativeDays(days, lng);
}

function relativeDays(days: number, lng?: AppLanguage): string {
  const abs = Math.abs(days);
  const sign = Math.sign(days);
  if (abs < 7) return relativePhrase(days, 'day', lng);
  if (abs < 30) return relativePhrase(sign * Math.round(abs / 7), 'week', lng);
  if (abs < 365) return relativePhrase(sign * Math.max(1, Math.round(abs / 30.4)), 'month', lng);
  return relativePhrase(sign * Math.round(abs / 365), 'year', lng);
}

// ─── Numbers & money ─────────────────────────────────────────────────────────

/** 1.234,5 (tr) · 1,234.5 (en). Non-finite → '—'. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}, lng?: AppLanguage): string {
  if (!Number.isFinite(value)) return '—';
  return numberFormat(appLocale(lng), options).format(value);
}

/** 0.42 → %42 (tr) · 42% (en). */
export function formatPercent(fraction: number, maximumFractionDigits = 0, lng?: AppLanguage): string {
  return formatNumber(fraction, { style: 'percent', maximumFractionDigits }, lng);
}

export interface MoneyOptions {
  /** `symbol` (default: disambiguates CA$ / A$ / $), `narrowSymbol` or `code`. */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** `exceptZero` for signed deltas (+₺12,00). */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

/**
 * Money in the app language: `formatMoney(1234.5, 'TRY')` → `₺1.234,50` (tr)
 * or `TRY 1,234.50` (en-US); `formatMoney(1234.5, 'EUR')` → `€1,234.50` (en).
 *
 * The ISO 4217 code is REQUIRED and always comes from the row being shown
 * (an expense's own currency, a trip's home currency) — never assume the
 * trip currency. An unknown code still renders: `1.234,50 XYZ`.
 */
export function formatMoney(amount: number, currency: string, options: MoneyOptions = {}, lng?: AppLanguage): string {
  const code = currency.trim().toUpperCase();
  if (!Number.isFinite(amount)) return '—';
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return numberFormat(appLocale(lng), { style: 'currency', currency: code, ...options }).format(amount);
    } catch {
      // Engine without data for this code: fall through.
    }
  }
  const digits = {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  };
  const number = formatNumber(amount, digits, lng);
  return code ? `${number} ${code}` : number;
}

// ─── Durations & distances ───────────────────────────────────────────────────

/** Minutes → `1h 30m` (en) · `1 sa 30 dk` (tr). Rounds; negatives clamp to 0. */
export function formatDuration(minutes: number, lng?: AppLanguage): string {
  const rounded = Number.isFinite(minutes) ? Math.round(Math.max(0, minutes)) : 0;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  const opts = { lng: lng ?? currentLanguage() };
  if (h === 0) return i18n.t('common:duration.minutes', { ...opts, m });
  if (m === 0) return i18n.t('common:duration.hours', { ...opts, h });
  return i18n.t('common:duration.hoursMinutes', { ...opts, h, m });
}

/** Metres → `850 m` / `1,2 km` (tr) / `12 km`. */
export function formatDistance(meters: number, lng?: AppLanguage): string {
  const safe = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  const opts = { lng: lng ?? currentLanguage() };
  if (safe < 1000) {
    return i18n.t('common:units.meters', { ...opts, value: formatNumber(Math.round(safe), {}, lng) });
  }
  const km = safe / 1000;
  const value = formatNumber(km, { maximumFractionDigits: km < 10 ? 1 : 0 }, lng);
  return i18n.t('common:units.kilometers', { ...opts, value });
}

// ─── Text: collation and case ────────────────────────────────────────────────

/**
 * Collator for the app language. Turkish sorts `Ç` after `C` and dotless
 * `I/ı` before dotted `İ/i`; English folds them. Default: accent- and
 * case-insensitive comparison (`sensitivity: 'base'`), numeric-aware.
 */
export function getCollator(options: Intl.CollatorOptions = {}, lng?: AppLanguage): Intl.Collator {
  const opts: Intl.CollatorOptions = { sensitivity: 'base', numeric: true, ...options };
  return cached('c', appLocale(lng), opts, () => new Intl.Collator(appLocale(lng), opts));
}

export function compareText(a: string, b: string, lng?: AppLanguage): number {
  return getCollator({}, lng).compare(a, b);
}

/** `istanbul` → `İSTANBUL` in Turkish, `ISTANBUL` in English. */
export function toLocaleUpper(text: string, lng?: AppLanguage): string {
  try {
    return text.toLocaleUpperCase(appLocale(lng));
  } catch {
    return text.toUpperCase();
  }
}

/** `IĞDIR` → `ığdır` in Turkish, `iğdir` in English. */
export function toLocaleLower(text: string, lng?: AppLanguage): string {
  try {
    return text.toLocaleLowerCase(appLocale(lng));
  } catch {
    return text.toLowerCase();
  }
}
