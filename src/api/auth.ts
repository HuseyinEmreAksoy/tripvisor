import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import { initTier1Sync, teardownTier1Sync } from '@/sync/hydrate';
import { startPhotoUploads, stopPhotoUploads } from './memories.upload-queue';

const SESSION_KEY = ['auth', 'session'] as const;

export function useSession() {
  const qc = useQueryClient();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      qc.setQueryData(SESSION_KEY, session ?? null);
      // v2 S2.8: the Tier-1 offline engine follows the auth lifecycle from
      // this single seam (covers magic link, OAuth, session restore, and
      // sign-out alike). Inert when the sync flag is off — initTier1Sync
      // resolves to a no-op — and never blocks the auth callback.
      if (session?.user?.id) {
        void initTier1Sync({ userId: session.user.id }).catch(() => {
          // Engine boot failures are telemetered inside src/sync — auth
          // must never fail because offline sync couldn't start.
        });
        // M5 Y2.1: resume this user's durable photo upload queue (never throws).
        startPhotoUploads(session.user.id);
      } else {
        teardownTier1Sync();
        stopPhotoUploads();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  return useQuery<Session | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session ?? null;
    },
    staleTime: Infinity,
  });
}

export function useSignInWithMagicLink() {
  return useMutation({
    mutationFn: async (email: string) => {
      // Linking.createURL produces tripvisor://... on native and
      // https://<deployed-host>/... on web — both are accepted by Supabase
      // as long as the URL is in the Supabase project's allow-list.
      const emailRedirectTo = Linking.createURL('/');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo },
      });
      if (error) throw error;
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.setQueryData(SESSION_KEY, null);
      qc.clear();
    },
  });
}

// ============================================================
// Phase 25 Step 25.5: account self-service mutations
// ============================================================
//
// `useChangeEmail` and `useChangePassword` wrap `supabase.auth.updateUser`
// for the two account-settings affordances the UI surfaces in Phase 25.
// Both are intentionally narrow:
//   - `useChangeEmail` accepts only `{ newEmail }`. Supabase emails a
//     confirmation link to the new address; the change becomes effective
//     once the user clicks it.
//   - `useChangePassword` accepts only `{ newPassword }`. Validates the
//     min length client-side (8) before the round trip. The Supabase
//     project setting `auth.minimum_password_length` may be tighter
//     server-side; if so, the server returns the canonical error and we
//     map it to `weak_password`.
//
// Error shape
// -----------
// We map the most common Supabase auth error strings into a small
// structured discriminated union via the `code` field on the thrown
// error. The UI renders the message verbatim; the code lets it choose
// the affordance (e.g. inline form error vs. toast).
//
//   - 'email_exists'    — the new email is already registered to another account
//   - 'weak_password'   — password did not meet the project's minimum
//   - 'same_password'   — the new password matches the existing one (no-op)
//   - 'unknown'         — anything else; the original message is preserved
//
// Falling through with `unknown` (rather than swallowing the error)
// means we never lose the upstream message — the UI always has
// something to show. Consumers can branch on `error instanceof
// AuthMutationError` and inspect `error.code`.

/**
 * Typed error thrown by `useChangeEmail` / `useChangePassword`. Mirrors
 * the `PlacesError` / `EdgeFunctionError` shape so the call sites can
 * `instanceof` check against a stable class.
 */
export class AuthMutationError extends Error {
  public readonly code:
    | 'email_exists'
    | 'weak_password'
    | 'same_password'
    | 'unknown';
  constructor(
    code: 'email_exists' | 'weak_password' | 'same_password' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'AuthMutationError';
    this.code = code;
  }
}

/**
 * Heuristic mapping from Supabase's free-text auth error messages to our
 * stable `code` enum. Supabase doesn't expose a stable error code for
 * these failure modes (as of 2026-04), so we pattern-match against the
 * known message substrings. New failure modes fall through to
 * `'unknown'` with the original message preserved.
 */
function mapAuthError(err: { message?: string; code?: string } | null | undefined): AuthMutationError {
  const message = err?.message ?? 'Auth update failed';
  const normalized = message.toLowerCase();
  // Supabase >= 2025 occasionally returns `code: 'email_exists'` directly.
  if (err?.code === 'email_exists') {
    return new AuthMutationError('email_exists', message);
  }
  if (
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('email_exists')
  ) {
    return new AuthMutationError('email_exists', message);
  }
  if (
    normalized.includes('weak password') ||
    normalized.includes('password should be at least') ||
    normalized.includes('password is too short') ||
    err?.code === 'weak_password'
  ) {
    return new AuthMutationError('weak_password', message);
  }
  if (
    normalized.includes('new password should be different') ||
    normalized.includes('same as the old') ||
    normalized.includes('same_password') ||
    err?.code === 'same_password'
  ) {
    return new AuthMutationError('same_password', message);
  }
  return new AuthMutationError('unknown', message);
}

/**
 * Minimum length for a new password client-side. Matches Supabase's
 * recommended floor; the project's `auth.minimum_password_length` may
 * be tighter server-side (in which case Supabase returns
 * `'password should be at least N characters'`, which we map to
 * `weak_password`).
 */
const MIN_PASSWORD_LENGTH = 8;

export interface ChangeEmailInput {
  newEmail: string;
}

export interface ChangeEmailResult {
  ok: true;
}

/**
 * Initiate an email-change flow. Calls `supabase.auth.updateUser({ email })`
 * which sends a confirmation link to the new address; the email change
 * becomes effective only when the user clicks that link (this matches
 * `auth.email.double_confirm_changes = true` in our supabase config).
 *
 * The mutation resolves as soon as the request to Supabase succeeds —
 * the user's session still references the old email until they confirm.
 * The UI should show a "check your email" affordance based on this
 * resolution, NOT treat it as a completed change.
 */
export function useChangeEmail() {
  return useMutation<ChangeEmailResult, AuthMutationError, ChangeEmailInput>({
    mutationFn: async ({ newEmail }) => {
      const trimmed = newEmail.trim();
      if (!trimmed) {
        throw new AuthMutationError('unknown', 'Email is required');
      }
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) {
        throw mapAuthError(error);
      }
      return { ok: true };
    },
  });
}

export interface ChangePasswordInput {
  newPassword: string;
}

export interface ChangePasswordResult {
  ok: true;
}

/**
 * Update the signed-in user's password. Performs a client-side minimum-
 * length check (8 chars) before the round trip so we don't waste a
 * Supabase auth request on an obviously-invalid value. The server may
 * still reject (project policy, breached-password lists, etc.); those
 * failures land as `weak_password` via `mapAuthError`.
 *
 * Unlike email change, the password change is effective immediately —
 * no confirmation step.
 */
export function useChangePassword() {
  return useMutation<ChangePasswordResult, AuthMutationError, ChangePasswordInput>({
    mutationFn: async ({ newPassword }) => {
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new AuthMutationError(
          'weak_password',
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        throw mapAuthError(error);
      }
      return { ok: true };
    },
  });
}
