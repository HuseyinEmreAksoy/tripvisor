/**
 * formatCurrency — legacy entry point, kept so existing callers don't change.
 * Delegates to `formatMoney` in `src/i18n/format.ts` (ADR-0011), so output
 * follows the ACTIVE APP LANGUAGE (`₺1.234,50` in Turkish, `€1,234.50` in
 * English) instead of the device locale.
 *
 * null/undefined falls back to USD only for old trip rows that pre-date the
 * column. New code should call `formatMoney(amount, row.currency)` from
 * `@/i18n` with the row's own ISO code.
 */
import { formatMoney } from '@/i18n/format';

export function formatCurrency(amount: number, currency: string | null | undefined): string {
  return formatMoney(amount, currency ?? 'USD');
}
