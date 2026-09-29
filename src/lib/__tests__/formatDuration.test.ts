/**
 * formatDuration.ts — legacy entry points delegating to src/i18n/format.ts.
 * Jest pins the device to en-US (jest-setup.ts); Turkish cases switch the
 * app-language preference and reset it afterwards.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { i18n, setLanguagePreference } from '@/i18n';
import { formatDuration, formatDurationSeconds } from '../formatDuration';

afterEach(async () => {
  await setLanguagePreference('system');
});

describe('formatDuration (minutes)', () => {
  it('formats minutes, whole hours and mixed durations in English', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('rounds to the nearest minute before formatting', () => {
    expect(formatDuration(44.4)).toBe('44m');
    expect(formatDuration(59.6)).toBe('1h');
    expect(formatDuration(89.5)).toBe('1h 30m');
  });

  it('clamps negative and non-finite input to 0m', () => {
    expect(formatDuration(-15)).toBe('0m');
    expect(formatDuration(Number.NaN)).toBe('0m');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0m');
  });

  it('follows the active app language (Turkish)', async () => {
    await setLanguagePreference('tr');
    expect(i18n.language).toBe('tr');
    expect(formatDuration(45)).toBe('45 dk');
    expect(formatDuration(60)).toBe('1 sa');
    expect(formatDuration(90)).toBe('1 sa 30 dk');
  });
});

describe('formatDurationSeconds', () => {
  it('converts seconds to minutes and formats', () => {
    expect(formatDurationSeconds(0)).toBe('0m');
    expect(formatDurationSeconds(2700)).toBe('45m');
    expect(formatDurationSeconds(3600)).toBe('1h');
    expect(formatDurationSeconds(5400)).toBe('1h 30m');
  });

  it('rounds DOWN partial minutes (unlike the minutes entry point)', () => {
    expect(formatDurationSeconds(59)).toBe('0m');
    expect(formatDurationSeconds(119)).toBe('1m');
    expect(formatDurationSeconds(3599)).toBe('59m');
  });

  it('follows the active app language (Turkish)', async () => {
    await setLanguagePreference('tr');
    expect(formatDurationSeconds(5400)).toBe('1 sa 30 dk');
  });
});
