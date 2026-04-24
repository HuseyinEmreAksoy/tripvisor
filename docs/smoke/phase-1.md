# Phase 1 — live smoke

**Date**: 2026-04-24
**Tester**: test-specialist (acting role) + user
**Build**: `master @ 8bfc57c` plus uncommitted Playwright infra
**Runner**: `npx playwright test e2e/web/phase-1-auth.spec.ts` + manual magic-link verification via local Supabase + Mailpit
**Status**: 🟢 **Green — all 3 web checks pass; magic-link send + delivery confirmed against local Supabase stack**

## Web (Chromium, localhost:8081)

- ☑ App boots — Metro serves, bundle loads, `/` redirects to `/login`
- ☑ Login form validates empty email — "Send magic link" button disabled until valid email entered
- ☑ Login form accepts valid email and sends magic link — verified 2026-04-24 against local Supabase (Docker); user signed up and received the magic-link email via Mailpit at `127.0.0.1:54324`, clicked through, and landed authenticated in the app

## iOS / Android

- Deferred to user smoke (no EAS dev-client build available during this run). Native parity expected from shared code path; tick platform boxes in `docs/features/auth.md` once user confirms.

## What this run proved

- Expo dev server starts cleanly on Windows from a cold `node_modules`
- Expo Router root layout (`ThemeProvider` + `QueryClientProvider` + `GestureHandlerRootView`) mounts without error
- Unauthenticated root redirect to `/login` works
- `react-hook-form` + Zod validation wiring on the login form is correct
- `supabase.auth.signInWithOtp` succeeds against local Supabase; email delivery via Mailpit works
- Magic-link redirect (`http://localhost:8081`) brings the user back to an authenticated session
- The `useLayoutEffect does nothing on the server` warnings logged during SSR hydration are standard Expo Router noise, not bugs

## Findings

**None.** All three Phase 1 web checks pass. Phase 1 flips to ✅ Done in `plan.md` for web; native smoke remains deferred-to-user.

## Follow-ups for the user

- When ready, build EAS dev clients and repeat the signup + magic-link flow on iOS + Android; tick the "Platforms verified" boxes in `docs/features/auth.md`.
- Before shipping to a real Supabase project, repeat this check against the hosted instance (not local) to confirm the hosted magic-link template + redirect URLs are correctly configured.
