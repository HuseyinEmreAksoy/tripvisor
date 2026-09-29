/**
 * Guarded `Intl.PluralRules` polyfill loader (ADR-0011 §5).
 *
 * i18next resolves `_one` / `_other` keys through `Intl.PluralRules`. When it
 * is missing (older Hermes builds), every plural key silently falls back to
 * the raw key. Browsers and Node always ship it, so only the native entry
 * (`platform.native.ts`) passes a real loader.
 */

interface IntlHost {
  Intl?: { PluralRules?: unknown } | undefined;
}

export function needsPluralRulesPolyfill(host: IntlHost): boolean {
  return typeof host.Intl === 'undefined' || typeof host.Intl.PluralRules !== 'function';
}

/** Runs `load` only when the host lacks `Intl.PluralRules`. Returns whether it ran. */
export function ensurePluralRules(host: IntlHost, load: () => void): boolean {
  if (!needsPluralRulesPolyfill(host)) return false;
  load();
  return true;
}
