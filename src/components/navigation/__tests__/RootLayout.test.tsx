/**
 * Root layout, native cold start (Wave-1 review #13). The splash is held from
 * module scope, so the root's `null` render (while the stored language is
 * read) never shows as a blank frame. It's hidden once i18n is ready.
 * (Jest runs the iOS preset, so `Platform.OS` is native here.)
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { ComponentType } from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
let mockI18nReady = false;
jest.mock('@/i18n', () => ({
  useI18nReady: () => mockI18nReady,
  useSystemLanguageSync: () => undefined,
}));
// The navigator, cache allowlist and Sentry are out of scope here.
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('@/api/offline', () => ({ shouldDehydrateQuery: () => false }));
jest.mock('@/lib/sentry', () => ({ initSentry: () => undefined }));
jest.mock('react-native-gesture-handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { GestureHandlerRootView: View };
});

const splash = jest.requireMock<{
  preventAutoHideAsync: jest.Mock<() => Promise<boolean>>;
  hideAsync: jest.Mock<() => Promise<void>>;
}>('expo-splash-screen');

describe('RootLayout splash handling (native)', () => {
  it('holds the splash on import, then hides it once i18n is ready', () => {
    // Imported here so the mocks above are in place for the module-scope call.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RootLayout = (require('../../../../app/_layout') as { default: ComponentType }).default;
    expect(splash.preventAutoHideAsync).toHaveBeenCalledTimes(1);

    const { rerender, toJSON } = render(<RootLayout />);
    // Stored language still loading: nothing rendered, splash still up.
    expect(toJSON()).toBeNull();
    expect(splash.hideAsync).not.toHaveBeenCalled();

    mockI18nReady = true;
    rerender(<RootLayout />);
    expect(toJSON()).not.toBeNull();
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);

    // Later renders don't hide it again.
    rerender(<RootLayout />);
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });
});
