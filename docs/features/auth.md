# auth

**Status**: 🚧 In progress — Phase 20 visual overhaul shipped 2026-04-25; web verified; native deferred to user smoke.
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: —

## Platforms verified
- ☐ iOS (native) — deferred to user smoke
- ☐ Android (native) — deferred to user smoke
- ✅ Web — Phase 20 smoke green 2026-04-25 (auth flow + hero screens confirmed)

## Phase 20 changes

`app/(auth)/login.tsx` and `app/(auth)/signup.tsx` received a hero redesign: full-bleed Unsplash CDN destination image, semi-transparent overlay using the new `heroOverlay` token, a floating chip strip (`heroChipBg`/`heroChipText`) for destination badges, and a lifted form card. At desktop widths (≥1024 px, via `useBreakpoint`) the screens render in two-column layout — imagery left, form right.

`src/theme/tokens.ts` additions: `heroOverlay`, `heroChipBg`, `heroChipText`. Also fixed a latent TS bug where `darkColors: typeof lightColors` was widening string literal types to `string`; switched to `Record<keyof typeof lightColors, string>`.

## User story
As a traveler, I want to sign in with just my email so that I don't have to remember another password.

## UI
- `app/(auth)/login.tsx` — email form + "Check your inbox" confirmation state
- `app/(auth)/signup.tsx` — same flow; entry point for new users
- `app/(auth)/_layout.tsx` — redirects to `/trips` if session present
- `app/(app)/_layout.tsx` — redirects to `/login` if session absent
- `app/index.tsx` — root redirect based on session
- Platform differences: none — React Native Web renders the same components

## Data
- Supabase `auth.users` (managed by Supabase) — no custom tables
- Session persisted via `storageAdapter`:
  - native: `expo-secure-store` (chunked for safety)
  - web: `localStorage` (with in-memory fallback for SSR contexts)

## APIs
- `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser, emailRedirectTo } })`
- `supabase.auth.getSession()`
- `supabase.auth.onAuthStateChange()` drives React Query cache updates
- `supabase.auth.signOut()`

## Edge cases
- `emailRedirectTo` computed from `Linking.createURL('/')` — resolves to `tripvisor://` on native and to the deployed host on web. Both must be on Supabase's Redirect URL allow-list in the dashboard.
- Rate limiting: Supabase throttles magic-link sends per email + IP. UI surfaces the error; no client-side retry logic.
- Sign-out clears the React Query cache to prevent stale user-scoped data.

## Test plan
- Unit: none (thin pass-through wrapper)
- Component: login form (`src/components/__tests__` covers primitives; login form validation test can be added)
- Integration / manual: user enters email → receives link → app opens to `/trips`
- E2E: deferred to Phase 4 (Playwright)
