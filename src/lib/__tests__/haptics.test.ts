/**
 * haptics.ts — fire-and-forget wrapper over expo-haptics.
 *
 * The module keeps module-level state (the cached reduce-motion preference and
 * a "subscribed" flag), so every test loads a FRESH copy via
 * `jest.resetModules`, configuring the fresh `react-native` instance
 * (Platform.OS + AccessibilityInfo) before `../haptics` is required.
 */

import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

type HapticsModule = typeof import('../haptics');

/** Minimal structural view of a jest.fn() (keeps tsc free of @types/jest lookups). */
interface MockFn {
  (...args: unknown[]): unknown;
  mock: { calls: unknown[][] };
  mockImplementationOnce(impl: (...args: unknown[]) => unknown): MockFn;
}

interface HapticsMock {
  impactAsync: MockFn;
  selectionAsync: MockFn;
  notificationAsync: MockFn;
}

interface Loaded {
  haptics: HapticsModule['haptics'];
  Haptics: HapticsMock;
  isReduceMotionEnabled: MockFn;
  /** The reduceMotionChanged listener haptics registered (if any). */
  listener: () => ((value: boolean) => void) | undefined;
  addEventListener: MockFn | undefined;
}

interface LoadOptions {
  os?: string;
  /** What AccessibilityInfo.isReduceMotionEnabled() resolves/rejects with. */
  reduceMotion?: () => Promise<boolean>;
  /** Simulate a platform where AccessibilityInfo.addEventListener is missing. */
  noAddEventListener?: boolean;
}

function load(opts: LoadOptions = {}): Loaded {
  const { os = 'ios', reduceMotion = () => Promise.resolve(false), noAddEventListener = false } = opts;
  // resetModules (not isolateModules): react-native's index exposes Platform /
  // AccessibilityInfo through LAZY getters that require() at access time, i.e.
  // when haptics.tap() runs. With isolateModules those later requires resolve
  // against the outer registry (unpatched Platform); after resetModules the
  // fresh registry is the active one for the whole test.
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  Object.defineProperty(RN.Platform, 'OS', { configurable: true, get: () => os });

  const isReduceMotionEnabled: MockFn = jest.fn(reduceMotion);
  RN.AccessibilityInfo.isReduceMotionEnabled = isReduceMotionEnabled;

  let registered: ((value: boolean) => void) | undefined;
  let addEventListener: MockFn | undefined;
  if (noAddEventListener) {
    RN.AccessibilityInfo.addEventListener = undefined;
  } else {
    addEventListener = jest.fn((_event: string, handler: (value: boolean) => void) => {
      registered = handler;
      return { remove: jest.fn() };
    }) as unknown as MockFn; // typed jest-mock Mock vs our structural view
    RN.AccessibilityInfo.addEventListener = addEventListener;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Haptics = require('expo-haptics') as HapticsMock;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../haptics') as HapticsModule;
  return {
    haptics: mod.haptics,
    Haptics,
    isReduceMotionEnabled,
    listener: () => registered,
    addEventListener,
  };
}

/** Let pending promise callbacks (the reduce-motion read) settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function totalCalls(h: HapticsMock): number {
  return h.impactAsync.mock.calls.length + h.selectionAsync.mock.calls.length + h.notificationAsync.mock.calls.length;
}

describe('haptics — feedback mapping (native)', () => {
  it('tap fires a Light impact', () => {
    const { haptics, Haptics } = load();
    haptics.tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('impact fires a Medium impact', () => {
    const { haptics, Haptics } = load();
    haptics.impact();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('select fires a selection tick', () => {
    const { haptics, Haptics } = load();
    haptics.select();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('success / warning / error fire the matching notification type', () => {
    const { haptics, Haptics } = load();
    haptics.success();
    haptics.warning();
    haptics.error();
    expect(Haptics.notificationAsync.mock.calls).toEqual([['success'], ['warning'], ['error']]);
  });

  it('works on android too', () => {
    const { haptics, Haptics } = load({ os: 'android' });
    haptics.tap();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });
});

describe('haptics — web', () => {
  it('is a no-op on web and never reads the accessibility preference', () => {
    const { haptics, Haptics, isReduceMotionEnabled, addEventListener } = load({ os: 'web' });
    haptics.tap();
    haptics.impact();
    haptics.select();
    haptics.success();
    haptics.warning();
    haptics.error();
    expect(totalCalls(Haptics)).toBe(0);
    expect(isReduceMotionEnabled).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
  });
});

describe('haptics — reduce motion preference', () => {
  it('subscribes exactly once, however many times haptics fire', () => {
    const { haptics, isReduceMotionEnabled, addEventListener } = load();
    haptics.tap();
    haptics.select();
    haptics.success();
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
  });

  it('suppresses haptics once the OS reports reduce motion enabled', async () => {
    const { haptics, Haptics } = load({ reduceMotion: () => Promise.resolve(true) });
    // First call fires: the preference is read asynchronously (no per-call await).
    haptics.tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    await flush();
    haptics.tap();
    haptics.success();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('follows reduceMotionChanged events in both directions', async () => {
    const { haptics, Haptics, listener } = load();
    haptics.select(); // subscribes
    await flush();
    const onChange = listener();
    expect(onChange).toBeDefined();

    onChange?.(true);
    haptics.select();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    onChange?.(false);
    haptics.select();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  });

  it('keeps haptics on when the preference read rejects', async () => {
    const { haptics, Haptics } = load({ reduceMotion: () => Promise.reject(new Error('unavailable')) });
    haptics.tap();
    await flush();
    haptics.tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it('still works when AccessibilityInfo.addEventListener is unavailable', async () => {
    const { haptics, Haptics, isReduceMotionEnabled } = load({ noAddEventListener: true });
    expect(() => haptics.warning()).not.toThrow();
    await flush();
    haptics.warning();
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
  });
});

describe('haptics — never throws', () => {
  it('swallows a rejected native call (no haptic engine / module missing)', async () => {
    const { haptics, Haptics } = load();
    Haptics.impactAsync.mockImplementationOnce(() => Promise.reject(new Error('no engine')));
    expect(() => haptics.tap()).not.toThrow();
    // The rejection is caught internally — flushing must not surface it.
    await expect(flush()).resolves.toBeUndefined();
    // And the next call still goes through.
    haptics.tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it('returns undefined (fire-and-forget, nothing to await)', () => {
    const { haptics } = load();
    expect(haptics.tap()).toBeUndefined();
    expect(haptics.error()).toBeUndefined();
  });
});
