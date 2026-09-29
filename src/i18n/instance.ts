/**
 * The i18next instance, initialised synchronously on import (ADR-0011):
 * resources are bundled, so `t()` works on the very first render and in
 * static web prerender. Import from `@/i18n`, not from here.
 *
 * Initial language = stored choice (read synchronously on web only; native
 * catches up in `preference.ts`) → first supported device language → `en`.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_NS, NAMESPACES, resources } from './resources';
import {
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  intlLocaleFor,
  isAppLanguage,
  parsePreference,
  resolveLanguage,
  type AppLanguage,
  type LanguagePreference,
} from './languages';
import { readDeviceLocale, type DeviceLocale } from './device';
import { applyDocumentLanguage, ensureIntlPolyfills, isStaticRender, readStoredPreferenceSync } from './platform';

// Before init: i18next caches plural rules on first use.
ensureIntlPolyfills();

// Static web export prerenders in English whatever the build machine's locale.
let device: DeviceLocale = isStaticRender() ? { tags: [], region: null } : readDeviceLocale();

/** The persisted choice as seen at boot (always `system` on native until hydrated). */
export const bootPreference: LanguagePreference = parsePreference(readStoredPreferenceSync());

export const i18n = i18next;

/** The active app language (`en` | `tr`). */
export function currentLanguage(): AppLanguage {
  const lng = i18n.resolvedLanguage ?? i18n.language;
  return isAppLanguage(lng) ? lng : FALLBACK_LANGUAGE;
}

/** BCP-47 tag for `Intl` in the active (or given) app language. */
export function appLocale(language: AppLanguage = currentLanguage()): string {
  return intlLocaleFor(language, device.region);
}

export function getDeviceLocale(): DeviceLocale {
  return device;
}

/** Called when the OS reports new locales (see `useSystemLanguageSync`). */
export function setDeviceLocale(next: DeviceLocale): void {
  device = next;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: resolveLanguage(bootPreference, device.tags),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: NAMESPACES,
    defaultNS: DEFAULT_NS,
    // React already escapes rendered strings.
    interpolation: { escapeValue: false },
    returnNull: false,
    // Resources are in memory, so init completes synchronously.
    initAsync: false,
    // Nothing to wait for; Suspense would only flash fallbacks on native.
    react: { useSuspense: false },
  });
  applyDocumentLanguage(currentLanguage());
  i18n.on('languageChanged', (lng: string) => {
    if (isAppLanguage(lng)) applyDocumentLanguage(lng);
  });
}
