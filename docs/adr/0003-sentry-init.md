# ADR-0003: Sentry initialisation

**Status**: Accepted
**Date**: 2026-04-24

## Context

Phase 4 adds error monitoring. The app targets iOS, Android, and Web from one Expo codebase. Options range from a separate SDK per platform to a single unified SDK. Privacy (GDPR / Google ToS) and developer-experience cost both matter.

## Decision

Use `@sentry/react-native`, which covers iOS + Android + Web via Metro's bundle pipeline.

Key settings:

| Setting | Value |
|---|---|
| DSN env var | `EXPO_PUBLIC_SENTRY_DSN` |
| Org / project slug | `tripvisor` / `tripvisor-app` (placeholder — user sets final slug) |
| `tracesSampleRate` | `0.1` |
| `sendDefaultPii` | `false` |
| Init guard | `initSentry()` no-ops when `EXPO_PUBLIC_SENTRY_DSN` is empty |

The `app.json` config plugin (`@sentry/react-native`'s Expo integration) is required for native symbol upload on EAS builds.

## Alternatives considered

| Option | Pro | Con |
|---|---|---|
| `@sentry/browser` on web only | Zero native surface | Misses iOS/Android crashes entirely |
| Separate SDKs per platform | Fine-grained control | Three init paths, three configs to keep in sync |
| `@sentry/react-native` (chosen) | One SDK, one init, Metro handles web | Requires config plugin; slightly larger bundle |
| No monitoring | Zero config | Blind to production errors |

## Consequences

- `initSentry()` must be called at app root before any navigation renders.
- Dev and CI environments with no DSN set are zero-cost and functionally identical to unmonitored builds.
- Release and environment tags are auto-filled from `expoConfig` — no manual tagging required.
- PII is off by default; any future PII capture requires an explicit ADR update and privacy review.
- EAS build must have `EXPO_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` set as secrets for symbol upload to work.
