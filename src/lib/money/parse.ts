/**
 * Locale-aware amount parsing for the expense keypad (M5 Y2.2 / Y3.2):
 * "12,50" in Turkish and "12.50" in English both mean 12.5.
 *
 * Rules, for a language whose decimal separator is D and grouping separator G:
 *   - whitespace (incl. NBSP / narrow NBSP) and apostrophes are ignored;
 *   - one D splits integer and fraction; G may appear in the integer part
 *     only in valid groups of three ("1.234,5" in tr, "1,234.5" in en);
 *   - with no D, a SINGLE G followed by exactly three digits after a 1–3
 *     digit integer part is grouping ("1.234" in tr = 1234), otherwise it is
 *     read as the decimal point, leniently ("12.5" typed in tr = 12.5);
 *   - several Gs must be valid grouping ("1.234.567" in tr);
 *   - a trailing D is allowed while typing ("12," = 12);
 *   - negative amounts are rejected (trip_expenses.amount >= 0);
 *   - when `currency` is given, more fraction digits than its minor units
 *     (trailing zeros aside) is `too_many_decimals` (JPY takes none).
 *
 * Pure: no Intl. The separator comes from the app language (the i18n module
 * knows it); pass `decimalSeparator` explicitly to override.
 */
import { parseDecimal, toNumber, toPlainString, cmp } from './decimal';
import { currencyMinorUnits } from './currency';

export type ParseAmountError = 'empty' | 'invalid' | 'negative' | 'too_many_decimals' | 'too_large';

export type ParseAmountResult =
  | {
      ok: true;
      /** The amount as a JS number (safe: validated against the currency's minor units). */
      value: number;
      /** Canonical plain decimal string ('1234.5'). */
      exact: string;
    }
  | { ok: false; error: ParseAmountError };

export interface ParseAmountOptions {
  /** App language or BCP-47 tag ('tr', 'en', 'tr-TR'); picks the decimal separator. Default 'en'. */
  language?: string;
  /** Overrides the language's separator. */
  decimalSeparator?: '.' | ',';
  /** Enforce this currency's minor units on the fraction. */
  currency?: string;
  /** Upper bound (inclusive). Default 1e12 — far above any real expense, below float trouble. */
  max?: number;
}

/** Languages that write the decimal part after a comma (CLDR). Only tr/en ship today. */
const COMMA_DECIMAL_LANGUAGES = new Set([
  'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'bs', 'bg', 'ro', 'hu',
  'el', 'uk', 'be', 'lt', 'lv', 'et', 'fi', 'sv', 'da', 'nb', 'nn', 'no', 'is', 'id', 'vi', 'az', 'ka', 'kk',
  'uz', 'ca', 'gl', 'eu', 'sq', 'mk', 'mn', 'af',
]);

/** '.' or ',' for an app language / BCP-47 tag ('tr' → ',', 'en' → '.'). */
export function decimalSeparatorFor(languageOrLocale: string | null | undefined): '.' | ',' {
  const base = (languageOrLocale ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return COMMA_DECIMAL_LANGUAGES.has(base) ? ',' : '.';
}

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

function escapeRe(ch: string): string {
  return ch === '.' ? '\\.' : ch;
}

function isGroupedInteger(text: string, group: string): boolean {
  return new RegExp(`^\\d{1,3}(${escapeRe(group)}\\d{3})+$`).test(text);
}

export function parseAmount(input: string | null | undefined, options: ParseAmountOptions = {}): ParseAmountResult {
  const decimal = options.decimalSeparator ?? decimalSeparatorFor(options.language ?? 'en');
  const group = decimal === ',' ? '.' : ',';
  const max = options.max ?? 1e12;

  let text = (input ?? '').replace(/[\s   '’]/g, '');
  if (text.length === 0) return { ok: false, error: 'empty' };
  if (text.startsWith('-') || text.startsWith('−')) {
    return /\d/.test(text) ? { ok: false, error: 'negative' } : { ok: false, error: 'invalid' };
  }
  if (text.startsWith('+')) text = text.slice(1);
  if (!/^[0-9.,]+$/.test(text) || !/\d/.test(text)) return { ok: false, error: 'invalid' };

  const decimals = count(text, decimal);
  const groups = count(text, group);
  let intPart: string;
  let fracPart = '';

  if (decimals > 1) return { ok: false, error: 'invalid' };
  if (decimals === 1) {
    const at = text.indexOf(decimal);
    intPart = text.slice(0, at);
    fracPart = text.slice(at + 1);
    if (fracPart.includes(group)) return { ok: false, error: 'invalid' };
    if (groups > 0) {
      if (!isGroupedInteger(intPart, group)) return { ok: false, error: 'invalid' };
      intPart = intPart.split(group).join('');
    }
  } else if (groups === 0) {
    intPart = text;
  } else if (groups === 1) {
    const at = text.indexOf(group);
    const before = text.slice(0, at);
    const after = text.slice(at + 1);
    const looksGrouped = /^[1-9]\d{0,2}$/.test(before) && /^\d{3}$/.test(after);
    if (looksGrouped) {
      intPart = `${before}${after}`;
    } else {
      // Lenient: the "other" separator used as the decimal point ("12.5" typed in tr).
      intPart = before;
      fracPart = after;
    }
  } else {
    if (!isGroupedInteger(text, group)) return { ok: false, error: 'invalid' };
    intPart = text.split(group).join('');
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return { ok: false, error: 'invalid' };
  if (intPart.length === 0 && fracPart.length === 0) return { ok: false, error: 'invalid' };

  const trimmedFraction = fracPart.replace(/0+$/, '');
  if (options.currency && trimmedFraction.length > currencyMinorUnits(options.currency)) {
    return { ok: false, error: 'too_many_decimals' };
  }

  const value = parseDecimal(`${intPart.length > 0 ? intPart : '0'}${trimmedFraction ? `.${trimmedFraction}` : ''}`);
  if (cmp(value, max) > 0) return { ok: false, error: 'too_large' };
  return { ok: true, value: toNumber(value), exact: toPlainString(value) };
}
