# sentry

**Status**: 🚧 Code complete · awaiting native smoke
**Owner agents**: backend-specialist
**Depends on**: (none — cross-cutting concern)

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Check a box only after smoke-testing on that platform.)

## User story
As a developer, I want unhandled errors to be captured in Sentry automatically, so I can diagnose production issues without waiting for user reports.

## UI
- No visible UI when working correctly.
- An error boundary in `app/_layout.tsx` catches uncaught React errors and calls `Sentry.captureException`. The default Expo error overlay in development is unaffected.
- Platform difference: `@sentry/react-native` covers iOS, Android, and Web via Metro's bundle pipeline — no per-platform split file required for the init path.

## Data
- No Supabase tables or columns.
- `sendDefaultPii: false` — no user identity or PII is sent to Sentry.
- `tracesSampleRate: 0.1` — 10% of transactions are traced.
- `release` and `environment` are auto-filled from `Constants.expoConfig.version` and `__DEV__`.

## APIs
- **No Google APIs.**
- Sentry ingest: `https://o<id>.ingest.sentry.io/...` (set via `EXPO_PUBLIC_SENTRY_DSN` in `.env`). When the env var is unset, no network connection to Sentry is ever made.

## Init guard
`src/lib/sentry.ts` exports `initSentry()`. The function early-returns when `process.env.EXPO_PUBLIC_SENTRY_DSN` is falsy — no `Sentry.init` call, no transport, no background thread. Called inside a `useEffect(() => { initSentry(); }, [])` in `RootLayout` (moved from module top-level to improve testability and avoid import-time side effects).

## Edge cases
- DSN unset: app runs identically to an unmonitored build. No logs, no errors, no network calls.
- DSN set to a malformed value: Sentry SDK handles internally (logs a warning to console; does not crash the app).
- Test environment: `EXPO_PUBLIC_SENTRY_DSN` is always `undefined` at Jest compile time because `babel-preset-expo` inlines env vars. The DSN-absent branch is covered; the DSN-present branch requires the shell workaround `EXPO_PUBLIC_SENTRY_DSN=any-value npm test`. This known gap is documented in `RUNNING.md` section 6.
- Native symbol upload: requires `SENTRY_AUTH_TOKEN` in EAS build secrets (not in `.env`). Without it, source maps are not uploaded and stack traces show minified names. This is acceptable for MVP.

## Test plan
- Unit: `src/lib/__tests__/sentry.test.ts` — 4 cases: `initSentry()` no-ops when DSN blank; `Sentry.init` not called; error boundary calls `captureException` ✅
- DSN-present branch coverage workaround: `EXPO_PUBLIC_SENTRY_DSN=any-value npm test` ✅ (documented in `RUNNING.md`)
- E2E: Sentry dashboard is not exercised in automated tests — live verification requires a real DSN in a staging environment. Deferred to user smoke.
- Manual native smoke (iOS + Android): set `EXPO_PUBLIC_SENTRY_DSN` to a dev DSN, force an unhandled error, confirm event appears in Sentry within 30s — deferred to user

## ADR
- [ADR-0003 — Sentry initialisation](../adr/0003-sentry-init.md)

## Review
- [Phase 4 review — Problems 6, 11](../reviews/phase-4.md)
