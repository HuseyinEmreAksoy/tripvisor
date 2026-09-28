import { describe, expect, it } from '@jest/globals';
import { resolveNativeMapsMode } from '../nativeMapsConfig';

describe('resolveNativeMapsMode', () => {
  it('uses Google on Android only when the build flagged a key', () => {
    expect(resolveNativeMapsMode('android', { nativeMaps: { android: true, ios: false } })).toBe('google');
    expect(resolveNativeMapsMode('android', { nativeMaps: { android: false, ios: true } })).toBe(
      'unavailable',
    );
  });

  it('treats a missing extra block as "no key" (older builds, jest)', () => {
    expect(resolveNativeMapsMode('android', undefined)).toBe('unavailable');
    expect(resolveNativeMapsMode('android', {})).toBe('unavailable');
  });

  it('falls back to Apple Maps on iOS without a key', () => {
    expect(resolveNativeMapsMode('ios', { nativeMaps: { android: true, ios: false } })).toBe('apple');
    expect(resolveNativeMapsMode('ios', { nativeMaps: { ios: true } })).toBe('google');
  });

  it('never accepts truthy non-boolean flags', () => {
    expect(resolveNativeMapsMode('android', { nativeMaps: { android: 'REPLACE_ME' } })).toBe(
      'unavailable',
    );
  });
});
