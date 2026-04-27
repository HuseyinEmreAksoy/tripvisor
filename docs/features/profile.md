# profile

**Status**: 🚧 In progress — settings screen revamp shipped Phase 25 (2026-04-26); change-email + change-password flows added
**Owner agents**: ui-specialist, backend-specialist
**Depends on**: auth

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web

## User story
As a signed-in user, I want to change my email address or password from the Settings screen, so I can keep my credentials current without deleting my account.

## UI
- Screen(s): `app/(app)/settings.tsx` — full revamp in Phase 25
- Key interactions:
  - **Account section** — displays the user's current email (read-only label)
  - **"Change email" button** — opens a modal with a single text field for the new email address; on confirm calls `useChangeEmail()`; on success shows "Check your inbox — we sent a confirmation link to <new email>"
  - **"Change password" button** — opens a modal with a single password field (min length 8 enforced client-side); on confirm calls `useChangePassword()`; on success shows a brief success toast
  - **Sign out** — preserved from Phase 7; calls `useSignOut()`
  - **Theme picker**, **Export my data**, **Delete account** — inherited from earlier phases; unchanged in Phase 25
- Error code mapping (inline banner beneath the relevant modal's confirm button):
  - `email_exists` → "That email is already in use."
  - `weak_password` → "Use at least 8 characters."
  - `same_password` → "Use a different password from your current one."
  - `unknown` → "Something went wrong — please try again."
- Platform differences: none — all controls are cross-platform; no native-only or web-only surface introduced

## Data
- No new tables or columns
- Supabase Auth `updateUser` is the only write path — no custom DB schema involved
- Email change is double-confirm: Supabase sends a confirmation link to the new address; the change is not applied until the link is clicked

## APIs
- `useChangeEmail()` in `src/api/auth.ts` — calls `supabase.auth.updateUser({ email: newEmail })`; throws `AuthMutationError` with codes `email_exists | unknown`
- `useChangePassword()` in `src/api/auth.ts` — validates min length 8 client-side; calls `supabase.auth.updateUser({ password: newPassword })`; throws `AuthMutationError` with codes `weak_password | same_password | unknown`
- `AuthMutationError extends Error` — new class in `src/api/auth.ts`; fields `{ code: 'email_exists' | 'weak_password' | 'same_password' | 'unknown', message: string }`

## Edge cases
- Email confirmation link: until the user clicks it, the account email remains unchanged; old session stays valid
- Password min-length of 8 is enforced client-side before network call to avoid a round-trip for obvious rejections
- `same_password` is only returned by Supabase when the new password equals the current one; the client surfaces it via `AuthMutationError.code`
- Sign-out remains functional regardless of pending credential changes

## Test plan
- Unit: `AuthMutationError` code mapping. Deferred — Phase 25 tests skipped per user direction.
- Component: Change-email modal error banner renders for each code. Deferred.
- Integration: `useChangeEmail` / `useChangePassword` round-trip against local Supabase. Deferred.
- E2E (web Playwright): open settings, change password with weak password, see error; change with valid password, see success. Deferred.
- Manual native smoke (iOS + Android): deferred to user smoke.
