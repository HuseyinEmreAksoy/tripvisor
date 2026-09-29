/**
 * Language resolution, the persisted Profile override, and the Hermes
 * `Intl.PluralRules` guard (ADR-0011 §3, §5).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createInstance } from 'i18next';
import {
  getLanguagePreference,
  i18n,
  LOCALE_STORAGE_KEY,
  setLanguagePreference,
  appLocale,
} from '@/i18n';
import { intlLocaleFor, matchLanguage, parsePreference, resolveLanguage } from '../languages';
import { ensurePluralRules, needsPluralRulesPolyfill } from '../pluralRules';
import { deviceLocaleFrom } from '../device';

describe('language resolution', () => {
  it('matches supported languages from any tag shape', () => {
    expect(matchLanguage('tr-TR')).toBe('tr');
    expect(matchLanguage('TR')).toBe('tr');
    expect(matchLanguage('en_GB')).toBe('en');
    expect(matchLanguage('de-DE')).toBeNull();
    expect(matchLanguage(undefined)).toBeNull();
  });

  it('prefers the stored choice, then the first supported device language, then English', () => {
    expect(resolveLanguage('en', ['tr-TR'])).toBe('en');
    expect(resolveLanguage('system', ['tr-TR', 'en-US'])).toBe('tr');
    expect(resolveLanguage('system', ['de-DE', 'tr-TR'])).toBe('tr');
    expect(resolveLanguage('system', ['de-DE', 'fr-FR'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
  });

  it('treats anything unknown in storage as System', () => {
    expect(parsePreference('tr')).toBe('tr');
    expect(parsePreference('de')).toBe('system');
    expect(parsePreference(null)).toBe('system');
  });

  it('maps the app language to an Intl locale (Turkish always tr-TR, English keeps the region)', () => {
    expect(intlLocaleFor('tr', 'GB')).toBe('tr-TR');
    expect(intlLocaleFor('en', 'gb')).toBe('en-GB');
    expect(intlLocaleFor('en', null)).toBe('en-US');
    expect(intlLocaleFor('en', '419')).toBe('en-US');
  });

  it('reads device locales defensively', () => {
    expect(deviceLocaleFrom([{ languageTag: 'tr-TR', regionCode: 'TR' }])).toEqual({ tags: ['tr-TR'], region: 'TR' });
    expect(deviceLocaleFrom(null)).toEqual({ tags: [], region: null });
  });
});

describe('Profile language override', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await setLanguagePreference('system');
  });

  it('boots in the (pinned) device language', () => {
    expect(i18n.language).toBe('en');
    expect(appLocale()).toBe('en-US');
  });

  it('switches without a restart and persists the choice', async () => {
    await setLanguagePreference('tr');
    expect(i18n.language).toBe('tr');
    expect(appLocale()).toBe('tr-TR');
    expect(getLanguagePreference()).toBe('tr');
    expect(i18n.t('shell:tabs.trips')).toBe('Geziler');
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBe('tr');
  });

  it('System clears the override and follows the device again', async () => {
    await setLanguagePreference('tr');
    await setLanguagePreference('system');
    expect(i18n.language).toBe('en');
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('applies a stored choice on the next launch', async () => {
    // A fresh module registry = a cold start (its own AsyncStorage mock too).
    await jest.isolateModulesAsync(async () => {
      const mod = require('@react-native-async-storage/async-storage') as typeof AsyncStorage & {
        default?: typeof AsyncStorage;
      };
      await (mod.default ?? mod).setItem(LOCALE_STORAGE_KEY, 'tr');
      const fresh = require('@/i18n') as typeof import('@/i18n');
      expect(fresh.useI18nReady).toBeDefined();
      await fresh.hydrateLanguagePreference();
      expect(fresh.getLanguagePreference()).toBe('tr');
      expect(fresh.i18n.language).toBe('tr');
      expect(fresh.i18n.t('common:actions.cancel')).toBe('Vazgeç');
    });
  });
});

describe('Intl.PluralRules guard (Hermes)', () => {
  const plurals = {
    en: { translation: { day_one: '{{count}} day', day_other: '{{count}} days' } },
  };

  it('only loads the polyfill when PluralRules is missing', () => {
    const load = jest.fn();
    expect(ensurePluralRules({ Intl: { PluralRules: function PluralRules() {} } }, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(needsPluralRulesPolyfill({ Intl: {} })).toBe(true);
    expect(needsPluralRulesPolyfill({})).toBe(true);
    expect(ensurePluralRules({ Intl: {} }, load)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('installs a real PluralRules when the engine lacks it, and plurals resolve', async () => {
    const intl = Intl as unknown as { PluralRules?: typeof Intl.PluralRules };
    const original = intl.PluralRules;
    delete intl.PluralRules;
    try {
      // Simulated Hermes without Intl.PluralRules: the native entry loads intl-pluralrules.
      jest.isolateModules(() => {
        const { ensureIntlPolyfills } = require('../platform.native') as typeof import('../platform.native');
        ensureIntlPolyfills();
      });
      expect(typeof intl.PluralRules).toBe('function');
      expect(intl.PluralRules).not.toBe(original);
      const rules = new intl.PluralRules!('tr');
      expect(rules.select(1)).toBe('one');
      expect(rules.select(3)).toBe('other');

      const i18next = createInstance();
      await i18next.init({ lng: 'en', resources: plurals, initAsync: false });
      // A throwaway instance with its own resources: bypass the app's typed keys.
      const t = i18next.t as unknown as (key: string, options: { count: number }) => string;
      expect(t('day', { count: 1 })).toBe('1 day');
      expect(t('day', { count: 2 })).toBe('2 days');
    } finally {
      intl.PluralRules = original;
    }
  });
});
