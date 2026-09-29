// Global Jest setup for Tripvisor.
// Keep this tiny — rely on jest-expo for most of the RN wiring.
import { jest } from '@jest/globals';

// expo-font's loader expects native-module state jest-expo doesn't provide
// (loadedNativeFonts.forEach crash). Fonts are a progressive enhancement —
// `useFonts` reporting "not loaded" renders the system-stack typography,
// which is exactly the pre-v3 baseline the suites were written against.
jest.mock('expo-font', () => ({
  useFonts: () => [false, null] as const,
  isLoaded: () => false,
  loadAsync: jest.fn(async () => undefined),
}));

// i18n (ADR-0011): pin the device to en-US so every suite renders English
// by default, regardless of the machine running Jest. Tests that need
// Turkish call `setLanguagePreference('tr')` (and reset it afterwards).
jest.mock('expo-localization', () => {
  const locales = [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }];
  return {
    getLocales: () => locales,
    useLocales: () => locales,
    getCalendars: () => [{ calendar: 'gregory', timeZone: 'UTC', uses24hourClock: false, firstWeekday: 1 }],
  };
});
