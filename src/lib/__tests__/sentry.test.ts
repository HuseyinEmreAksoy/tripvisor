/**
 * sentry.ts — initSentry() unit tests.
 *
 * KNOWN CONSTRAINT: babel-preset-expo inlines all EXPO_PUBLIC_* env vars at
 * compile time (via babel-plugin-transform-inline-environment-variables). This
 * means process.env.EXPO_PUBLIC_SENTRY_DSN is always compiled to `undefined`
 * in the Jest environment unless the variable is set in the shell before running
 * Jest. Consequently, the "DSN present" branch of initSentry() cannot be covered
 * from a plain Jest test without either:
 *   (a) setting EXPO_PUBLIC_SENTRY_DSN in the shell before `npm test`, or
 *   (b) extracting the DSN read into an injectable function (requires feature-code change).
 *
 * Tests here cover what is reliably testable:
 *   - initSentry() is a function
 *   - With the DSN absent (the default in CI), Sentry.init is NOT called
 *   - The module exports `Sentry` re-export
 *   - initSentry() is idempotent (safe to call multiple times in the no-DSN case)
 *
 * The "DSN present → Sentry.init called" branch is verified by:
 *   1. Reading the feature code directly (it's trivially correct)
 *   2. The live smoke test (initSentry is called in _layout.tsx on every boot)
 *   3. Running `EXPO_PUBLIC_SENTRY_DSN=<dsn> npm test src/lib/__tests__/sentry.test.ts`
 *      — when the env is set before Jest starts, the inlined value is non-empty
 *      and the coverage branch is hit.
 */

// Mock @sentry/react-native so no transport is ever started.
const mockInit = jest.fn();
jest.mock('@sentry/react-native', () => ({
  init: mockInit,
}));

jest.mock('expo-constants', () => ({
  default: { expoConfig: { version: '0.0.0-test' } },
  __esModule: true,
}));

import { initSentry, Sentry } from '../sentry';

describe('initSentry', () => {
  beforeEach(() => {
    mockInit.mockClear();
  });

  it('initSentry is a function', () => {
    expect(typeof initSentry).toBe('function');
  });

  it('Sentry re-export is an object', () => {
    // The module re-exports Sentry for use by other callers (e.g. error boundaries)
    expect(typeof Sentry).toBe('object');
  });

  it('does not call Sentry.init when EXPO_PUBLIC_SENTRY_DSN is absent (default in CI)', () => {
    // babel-preset-expo inlines EXPO_PUBLIC_SENTRY_DSN at compile time.
    // In the Jest environment where the var is not set, the compiled output
    // contains `undefined` literally, so this branch is always hit in CI.
    initSentry();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('initSentry can be called multiple times without throwing (idempotent no-op when DSN absent)', () => {
    // Safe to call initSentry multiple times — the initialized guard prevents re-init.
    // In the no-DSN case, it simply returns each time without any side-effects.
    expect(() => {
      initSentry();
      initSentry();
      initSentry();
    }).not.toThrow();
    expect(mockInit).not.toHaveBeenCalled();
  });
});
