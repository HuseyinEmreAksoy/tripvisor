/**
 * Web side of the i18n platform seam. Consumers import `./platform`.
 *
 * AsyncStorage on web is a thin wrapper over `localStorage` using the raw
 * key, so the persisted choice can be read synchronously here. That lets the
 * first client render already use the chosen language (no English flash),
 * except when hydrating prerendered HTML: that render must match the English
 * markup, so the switch waits until after mount (see `instance.ts`).
 */
import { LOCALE_STORAGE_KEY, type AppLanguage } from './languages';

/** True when `readStoredPreferenceSync` sees the real persisted value. */
export const SYNC_PREFERENCE_READ = true;

/**
 * True during `expo export` static rendering (Node, no `window`). The build
 * machine's locale must not leak into the prerendered HTML, so the server
 * render always uses English; the browser then resolves the visitor's language.
 */
export function isStaticRender(): boolean {
  return typeof window === 'undefined';
}

/**
 * True in the browser when React is about to hydrate prerendered HTML from
 * `expo export` (web output "static"). The exported page sets
 * `__EXPO_ROUTER_HYDRATE__` in an inline module script in `<head>`, which runs
 * before the deferred bundle, and `registerRootComponent` then calls
 * `hydrateRoot` instead of `createRoot`. The dev server doesn't set it
 * (unless `EXPO_WEB_DEV_HYDRATE`), so dev renders straight into the visitor's
 * language.
 */
export function isHydratingStaticHtml(): boolean {
  if (typeof window === 'undefined') return false;
  return (globalThis as { __EXPO_ROUTER_HYDRATE__?: unknown }).__EXPO_ROUTER_HYDRATE__ === true;
}

export function readStoredPreferenceSync(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(LOCALE_STORAGE_KEY);
    }
  } catch {
    // Sandboxed iframe / private mode / SSR: fall back to the device language.
  }
  return null;
}

/** Keeps `<html lang>` in sync so screen readers pronounce Turkish correctly. */
export function applyDocumentLanguage(language: AppLanguage): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = language;
  }
}

/** Every supported browser ships `Intl.PluralRules`; nothing to load. */
export function ensureIntlPolyfills(): void {}
