/**
 * Pure language helpers (ADR-0011). No i18next, no storage, no platform code,
 * so they are trivially unit-testable and safe to import anywhere.
 */

export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** What the user picked in Profile → Language. `system` follows the device. */
export type LanguagePreference = AppLanguage | 'system';

export const FALLBACK_LANGUAGE: AppLanguage = 'en';

/** AsyncStorage key for the persisted override (ADR-0011 §3). Absent = system. */
export const LOCALE_STORAGE_KEY = 'tv.locale';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'tr';
}

/** A stored raw value → preference. Anything unknown means "system". */
export function parsePreference(raw: string | null | undefined): LanguagePreference {
  return isAppLanguage(raw) ? raw : 'system';
}

/** `tr-TR` / `tr_TR` / `TR` → `tr`; `en-GB` → `en`; anything else → null. */
export function matchLanguage(tag: string | null | undefined): AppLanguage | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isAppLanguage(base) ? base : null;
}

/**
 * The language the app renders in. An explicit choice wins; otherwise the
 * first device language we support (in the user's own order), else English.
 */
export function resolveLanguage(preference: LanguagePreference, deviceTags: readonly string[]): AppLanguage {
  if (preference !== 'system') return preference;
  for (const tag of deviceTags) {
    const match = matchLanguage(tag);
    if (match) return match;
  }
  return FALLBACK_LANGUAGE;
}

/**
 * BCP-47 tag for `Intl` (ADR-0011 §4): Turkish is always `tr-TR`; English
 * keeps the device region (`en-GB` → 29 Sep, `en-US` → Sep 29) and falls
 * back to `en-US` when the region is unknown or malformed.
 */
export function intlLocaleFor(language: AppLanguage, deviceRegion?: string | null): string {
  if (language === 'tr') return 'tr-TR';
  const region = deviceRegion?.trim().toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? `en-${region}` : 'en-US';
}
