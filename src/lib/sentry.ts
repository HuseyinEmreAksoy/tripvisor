// Tripvisor Phase 4 — Sentry initialization.
//
// Behavior:
//   - When `EXPO_PUBLIC_SENTRY_DSN` is blank, `initSentry()` is a no-op.
//     Nothing is shipped, no transport is started, no network traffic happens.
//     This is the default during local dev and CI.
//   - When the DSN is set, Sentry is initialized with a conservative sample
//     rate and PII redaction.
//
// Called once at the very top of `app/_layout.tsx`, before any other init.

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // Explicit no-op. Do not call Sentry.init — doing so spins up a transport
    // even with an empty DSN and emits warnings on every platform.
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // `__DEV__` is a global set by Metro/React Native in both native and web bundles.
    // Fallback to NODE_ENV for tests / SSR.
    environment:
      typeof __DEV__ !== 'undefined' && __DEV__
        ? 'dev'
        : process.env.NODE_ENV === 'production'
          ? 'production'
          : 'dev',
    release: Constants.expoConfig?.version ?? '0.0.0',
  });
  initialized = true;
}

export { Sentry };
