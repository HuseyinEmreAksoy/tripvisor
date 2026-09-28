import { beforeEach, describe, expect, it } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_REDIRECT_KEY,
  PENDING_REDIRECT_TTL_MS,
  isSafeRedirectPath,
  parsePendingRedirect,
  setPendingRedirect,
  takePendingRedirect,
} from '../pendingRedirect';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('isSafeRedirectPath', () => {
  it('accepts app-relative paths', () => {
    expect(isSafeRedirectPath('/invite/abc')).toBe(true);
    expect(isSafeRedirectPath('/trips')).toBe(true);
  });

  it('rejects protocol-relative, absolute and non-string values', () => {
    expect(isSafeRedirectPath('//evil.com')).toBe(false);
    expect(isSafeRedirectPath('/\\evil.com')).toBe(false);
    expect(isSafeRedirectPath('https://evil.com')).toBe(false);
    expect(isSafeRedirectPath('invite/abc')).toBe(false);
    expect(isSafeRedirectPath('/\t/evil.com')).toBe(false);
    expect(isSafeRedirectPath(null)).toBe(false);
  });
});

describe('set / take', () => {
  it('stores a safe path and consumes it exactly once', async () => {
    await setPendingRedirect('/invite/tok');
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_REDIRECT_KEY))!).path).toBe('/invite/tok');
    expect(await takePendingRedirect()).toBe('/invite/tok');
    expect(await AsyncStorage.getItem(PENDING_REDIRECT_KEY)).toBeNull();
    expect(await takePendingRedirect()).toBeNull();
  });

  it('ignores unsafe paths on write', async () => {
    await setPendingRedirect('//evil.com');
    expect(await AsyncStorage.getItem(PENDING_REDIRECT_KEY)).toBeNull();
  });

  it('drops a tampered stored value on read', async () => {
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, '//evil.com');
    expect(await takePendingRedirect()).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_REDIRECT_KEY)).toBeNull();
  });

  it('drops an entry older than the TTL', async () => {
    await AsyncStorage.setItem(
      PENDING_REDIRECT_KEY,
      JSON.stringify({ path: '/invite/old', at: Date.now() - PENDING_REDIRECT_TTL_MS - 1 }),
    );
    expect(await takePendingRedirect()).toBeNull();
    expect(await AsyncStorage.getItem(PENDING_REDIRECT_KEY)).toBeNull();
  });

  it('concurrent takers share one read', async () => {
    await setPendingRedirect('/invite/x');
    const [a, b] = await Promise.all([takePendingRedirect(), takePendingRedirect()]);
    expect(a).toBe('/invite/x');
    expect(b).toBe('/invite/x');
  });
});

describe('parsePendingRedirect', () => {
  it('returns the path for a fresh, safe entry without touching storage', async () => {
    const raw = JSON.stringify({ path: '/invite/x', at: Date.now() });
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, raw);
    expect(parsePendingRedirect(raw)).toBe('/invite/x');
    expect(await AsyncStorage.getItem(PENDING_REDIRECT_KEY)).toBe(raw);
  });

  it('rejects stale, unsafe and unparseable entries', () => {
    expect(parsePendingRedirect(JSON.stringify({ path: '/invite/x', at: Date.now() - PENDING_REDIRECT_TTL_MS - 1 }))).toBeNull();
    expect(parsePendingRedirect(JSON.stringify({ path: '//evil.com', at: Date.now() }))).toBeNull();
    expect(parsePendingRedirect(JSON.stringify({ path: '/invite/x' }))).toBeNull();
    expect(parsePendingRedirect('{')).toBeNull();
  });
});
