/**
 * useCurrentLocation (web branch) — transient failures are retryable 'error',
 * only a missing geolocation API is 'unavailable'.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useCurrentLocation } from '../useCurrentLocation';

type ErrorCb = (err: { code: number }) => void;
type SuccessCb = (pos: { coords: { latitude: number; longitude: number } }) => void;

const originalOS = Platform.OS;
const nav = globalThis.navigator as unknown as { geolocation?: unknown };
const originalGeo = nav.geolocation;

function mockGeolocation(impl: (ok: SuccessCb, fail: ErrorCb) => void) {
  Object.defineProperty(nav, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: jest.fn(impl) },
  });
}

describe('useCurrentLocation (web)', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    Object.defineProperty(nav, 'geolocation', { configurable: true, value: originalGeo });
  });

  function setup() {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    return renderHook(() => useCurrentLocation());
  }

  it.each([2, 3])('maps error code %i to a retryable error that recovers', async (code) => {
    let fail = true;
    mockGeolocation((ok, err) => {
      if (fail) err({ code });
      else ok({ coords: { latitude: 1, longitude: 2 } });
    });
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe('error');

    fail = false;
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe('granted');
    expect(result.current.location).toEqual({ lat: 1, lng: 2 });
  });

  it('maps PERMISSION_DENIED to denied', async () => {
    mockGeolocation((_ok, err) => err({ code: 1 }));
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe('denied');
  });

  it('reserves unavailable for a missing geolocation API', async () => {
    Object.defineProperty(nav, 'geolocation', { configurable: true, value: undefined });
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe('unavailable');
  });
});
