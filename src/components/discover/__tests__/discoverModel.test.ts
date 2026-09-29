import { describe, expect, it } from '@jest/globals';
import { i18n } from '@/i18n';
import { AddPoiError, RecommendationsError } from '@/api/recommendations';
import {
  INTERESTS,
  INTEREST_ICONS,
  addPoiErrorKey,
  degradedKey,
  initialInterests,
  interestLabelKey,
  normalizeInterests,
  parseDayParam,
  recommendationsErrorKey,
  safeHttpUrl,
  sameInterests,
  toggleInterest,
  tripDayCountOf,
} from '../discoverModel';

const t = i18n.t.bind(i18n);

describe('interest mapping', () => {
  it('every interest has an icon and an en + tr label', () => {
    for (const i of INTERESTS) {
      expect(INTEREST_ICONS[i]).toBeTruthy();
      const en = t(`discover:${interestLabelKey(i)}`, { lng: 'en' });
      const tr = t(`discover:${interestLabelKey(i)}`, { lng: 'tr' });
      expect(en).not.toContain('interests.');
      expect(tr).not.toContain('interests.');
    }
    expect(t('discover:interests.food', { lng: 'tr' })).toBe('Yeme-içme');
  });

  it('normalizes saved values: unknown keys dropped, canonical order, no duplicates', () => {
    expect(normalizeInterests(['food', 'surfing', 'history', 'food'])).toEqual(['history', 'food']);
    expect(normalizeInterests(undefined)).toEqual([]);
  });

  it('toggles and compares sets', () => {
    expect(toggleInterest(['food'], 'history')).toEqual(['history', 'food']);
    expect(toggleInterest(['history', 'food'], 'history')).toEqual(['food']);
    expect(sameInterests(['food', 'history'], ['history', 'food'])).toBe(true);
    expect(sameInterests(['food'], ['history'])).toBe(false);
  });

  it('pre-selects preferences, else the onboarding picks, else nothing', () => {
    expect(initialInterests(['nature'], ['food'])).toEqual(['nature']);
    expect(initialInterests([], ['food', 'kids'])).toEqual(['food', 'kids']);
    expect(initialInterests(undefined, null)).toEqual([]);
  });
});

describe('error + banner keys', () => {
  it('maps every AddPoiError code to its own discover:addError key', () => {
    const codes = [
      'no_match',
      'quota_exceeded',
      'places_unavailable',
      'not_authenticated',
      'already_in_trip',
      'create_failed',
      'invalid_input',
    ] as const;
    for (const code of codes) {
      const key = addPoiErrorKey(new AddPoiError(code, 'x'));
      expect(key).toBe(`addError.${code}`);
      expect(i18n.exists(`discover:${key}`)).toBe(true);
    }
    expect(addPoiErrorKey(new Error('boom'))).toBe('addError.places_unavailable');
  });

  it('maps recommendation errors, keeping unknown ones retryable', () => {
    expect(recommendationsErrorKey(new RecommendationsError('quota_exceeded', 'x', 429))).toBe('error.quota_exceeded');
    expect(recommendationsErrorKey(new RecommendationsError('recommendations_disabled', 'x', 503))).toBe(
      'error.recommendations_disabled',
    );
    expect(recommendationsErrorKey(new Error('network'))).toBe('error.generic');
  });

  it('maps degraded codes to banners', () => {
    expect(degradedKey(null)).toBeNull();
    for (const d of ['partial', 'user_quota', 'global_cap', 'overpass_unavailable', 'cache_only'] as const) {
      expect(i18n.exists(`discover:${degradedKey(d)!}`)).toBe(true);
    }
  });
});

describe('small helpers', () => {
  it('parses ?day= within the trip', () => {
    expect(parseDayParam('1', 3)).toBe(1);
    expect(parseDayParam('3', 3)).toBeNull();
    expect(parseDayParam('-1', 3)).toBeNull();
    expect(parseDayParam(undefined, 3)).toBeNull();
  });

  it('counts trip days inclusively', () => {
    expect(tripDayCountOf('2026-10-01', '2026-10-03')).toBe(3);
    expect(tripDayCountOf(null, null)).toBe(0);
  });

  it('only opens http(s) links', () => {
    expect(safeHttpUrl('https://en.wikipedia.org/wiki/X')).toBe('https://en.wikipedia.org/wiki/X');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
  });
});
