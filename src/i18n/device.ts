/**
 * Device locale snapshot via expo-localization (iOS, Android, web). Never
 * throws: a missing native module or an odd browser falls back to en-US.
 */
import { getLocales, type Locale } from 'expo-localization';

export interface DeviceLocale {
  /** BCP-47 tags in the user's own preference order, e.g. `['tr-TR', 'en-US']`. */
  tags: string[];
  /** Region of the primary locale (`GB`, `TR`…) or null when unknown. */
  region: string | null;
}

export function deviceLocaleFrom(locales: readonly Pick<Locale, 'languageTag' | 'regionCode'>[] | null | undefined): DeviceLocale {
  const list = Array.isArray(locales) ? locales : [];
  const tags = list.map((l) => l.languageTag).filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  return { tags, region: list[0]?.regionCode ?? null };
}

export function readDeviceLocale(): DeviceLocale {
  try {
    return deviceLocaleFrom(getLocales());
  } catch {
    return { tags: [], region: null };
  }
}
