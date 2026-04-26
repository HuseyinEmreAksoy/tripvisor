/**
 * formatCurrency — format a numeric amount with the trip's currency.
 *
 * Uses Intl.NumberFormat when available (all modern browsers + React Native
 * Hermes via the polyfill that ships with Expo SDK 52+). Falls back to a
 * plain "CODE amount" string for any currency code that Intl rejects.
 *
 * Callers should pass `trip.currency` directly; null/undefined falls back to
 * USD to handle older trip rows that pre-date the column.
 */
export function formatCurrency(amount: number, currency: string | null | undefined): string {
  const cur = (currency ?? 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(amount);
  } catch {
    // Fallback for invalid currency codes — print the code + amount with 2 decimals.
    return `${cur} ${amount.toFixed(2)}`;
  }
}
