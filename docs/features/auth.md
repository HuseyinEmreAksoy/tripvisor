# auth

**Status**: 🚧 In progress (code complete, awaiting live Supabase smoke)
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: —

## Platforms verified
- ☐ iOS (native) — pending user `eas build --profile development`
- ☐ Android (native) — pending user `eas build --profile development`
- ☐ Web — pending user `npm install && npm run web`

Cannot be ticked until Supabase project is provisioned and magic-link mail arrives end-to-end.

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
