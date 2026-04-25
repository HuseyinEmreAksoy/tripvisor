# settings

**Status**: ✅ Done (Web). Native deferred to user smoke.
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: auth
**Shipped on**: 2026-04-25 — commit a2a24e3 (Phase 7)

## Platforms verified
- ☐ iOS — deferred to user smoke
- ☐ Android — deferred to user smoke
- ☑ Web — visual smoke confirmed 2026-04-25

## User story
As a signed-in user, I want a Settings screen where I can see my account email, switch the app theme, sign out, and permanently delete my account, so that I have control over my preferences and data.

## UI
- Screen(s): `app/(app)/settings.tsx` (new Expo Router file at `/(app)/settings`).
- Key interactions:
  - Email field: read-only, populated from `useSession()`.
  - Theme picker: `SegmentedControl` with three options — Light, Dark, System. Selecting one calls `useThemeControls().setMode(mode)` and persists the choice. System mode uses `Appearance.addChangeListener` to follow OS preference at runtime.
  - Sign out: calls `useSignOut().mutateAsync()`; routes to `/(auth)/login` via auth-gate redirect.
  - Delete account: opens a destructive confirm (platform-split helper `src/lib/confirm.{web,native,ts}`); on confirm calls `supabase.functions.invoke('delete-account')`; on 200 calls `await signOut.mutateAsync()` then `queryClient.clear()` then routes to login. On error, shows an inline error and stays put.
- Navigation: the inline Sign out button in `app/(app)/trips.tsx` was replaced with a Settings header link; Sign out moved into the Settings screen.
- Platform differences: `src/lib/confirm.native.ts` uses `Alert.alert`; `src/lib/confirm.web.ts` uses a small in-app confirm (not `window.confirm`). Both share the `src/lib/confirm.ts` type contract.

## Data
- No new tables or columns.
- Theme mode persisted under key `tripvisor.theme.mode` via the existing platform storage adapter:
  - Web: `localStorage` (via `storage.web.ts`)
  - Native: `expo-secure-store` (via `storage.native.ts`)
- Allowed values: `'light'` | `'dark'` | `'system'`. `'system'` is new in Phase 7; old `setOverride` alias preserved in `src/theme/ThemeProvider.tsx` for backward compatibility.

## APIs
- `useSession()` — read email from existing auth state.
- `useSignOut()` — existing TanStack Query mutation in `src/api/auth.ts`.
- `supabase.functions.invoke('delete-account')` — POST with JWT; server-side flow:
  1. Edge Function (`supabase/functions/delete-account/index.ts`) verifies JWT.
  2. Calls `auth.admin.deleteUser(jwt.sub)` first (auth-delete-first ordering; if this fails, the user retains their data and stays signed in — safer failure mode).
  3. On success, public rows are cleaned up via cascade from `auth.users`.
  4. Returns 200. `?ping` returns 200 for health checks.
- `queryClient.clear()` called after `signOut.mutateAsync()` resolves to flush stale cache (M1 fix — prevents the trips list from briefly rendering under the auth gate if the redirect is delayed).

## Edge cases
- M1 (fixed): sign-out race after delete-account — resolved by awaiting `signOut.mutateAsync()` before `qc.clear()` and before the router redirect.
- Delete-account with no trips: `auth.admin.deleteUser` still succeeds; cascade on `trips` is a no-op.
- Theme persistence across reloads: `ThemeProvider` reads `tripvisor.theme.mode` from storage on mount; System mode re-applies the OS listener on each mount.
- `?ping` on delete-account Edge Function: returns 200 immediately without auth check. Used for health probes.

## Test plan
- No tests authored in Phase 7 (test-specialist removed per user direction).
- Follow-up: component test asserting the Delete account button is disabled while the mutation is in-flight; unit test for the confirm helper on web and native.

## Open follow-ups
- **L3** — `src/lib/confirm.ts` native typecheck: TypeScript may flag the native `Alert` import path under strict mode depending on module resolution. Parked.
- **L4** — `delete_account_cascade` RPC hardening: the RPC is callable directly by authenticated clients; consider revoking execute permission and routing all calls through the Edge Function only. See also `docs/features/trip-lifecycle.md`.

See `docs/reviews/phase-7.md` for the full reviewer findings.
