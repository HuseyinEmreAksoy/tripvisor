/**
 * shareSheet.native — buildAppUrl must always produce a public HTTPS link,
 * never the tripvisor:// custom scheme (recipients without the app can't open it).
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { buildAppUrl } from '../shareSheet.native';

const ORIGINAL = process.env.EXPO_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_APP_URL;
  else process.env.EXPO_PUBLIC_APP_URL = ORIGINAL;
});

describe('buildAppUrl (native)', () => {
  it('falls back to the live web origin when EXPO_PUBLIC_APP_URL is unset', () => {
    delete process.env.EXPO_PUBLIC_APP_URL;
    expect(buildAppUrl('share/abc')).toEqual({
      url: 'https://tripvisor.pages.dev/share/abc',
      usingDeepLink: false,
    });
  });

  it('prefers EXPO_PUBLIC_APP_URL and joins without doubled slashes', () => {
    process.env.EXPO_PUBLIC_APP_URL = 'https://example.test/';
    expect(buildAppUrl('/share/abc').url).toBe('https://example.test/share/abc');
  });

  it('treats a blank EXPO_PUBLIC_APP_URL as unset', () => {
    process.env.EXPO_PUBLIC_APP_URL = '   ';
    expect(buildAppUrl('invite/xyz').url).toBe('https://tripvisor.pages.dev/invite/xyz');
  });
});
