/**
 * iOS / Android side of the i18n platform seam. Consumers import `./platform`.
 */
import type { AppLanguage } from './languages';
import { ensurePluralRules } from './pluralRules';

/** Native storage is async: the root layout waits for `i18nReady` instead. */
export const SYNC_PREFERENCE_READ = false;

export function isStaticRender(): boolean {
  return false;
}

/** Native never hydrates server HTML. */
export function isHydratingStaticHtml(): boolean {
  return false;
}

export function readStoredPreferenceSync(): string | null {
  return null;
}

export function applyDocumentLanguage(_language: AppLanguage): void {}

/** Hermes may lack `Intl.PluralRules`; load the small polyfill only then. */
export function ensureIntlPolyfills(): void {
  ensurePluralRules(globalThis as { Intl?: { PluralRules?: unknown } }, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('intl-pluralrules');
  });
}
