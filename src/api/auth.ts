import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isAuthRetryableFetchError, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';
import { storageAdapter } from './storage';
import { initTier1Sync, teardownTier1Sync } from '@/sync/hydrate';
import { startPhotoUploads, stopPhotoUploads } from './memories.upload-queue';

const SESSION_KEY = ['auth', 'session'] as const;

// ------------------------------------------------------------
// Single auth lifecycle seam (module level, registered once)
// ------------------------------------------------------------
// Every useSession() consumer used to add its own onAuthStateChange
// subscription; auth-js emits INITIAL_SESSION to each new subscriber, so every
// screen mount re-ran a full Tier-1 resync + upload pump. Now ONE listener
// feeds every mounted QueryClient and drives the Tier-1 / photo-upload
// lifecycle, deduped by user id (TOKEN_REFRESHED for the same user is a no-op).

const queryClients = new Map<QueryClient, number>();
let listenerRegistered = false;
let lifecycleUserId: string | null = null;

function writeSession(session: Session | null) {
  queryClients.forEach((_n, qc) => qc.setQueryData(SESSION_KEY, session));
}

function startLifecycle(userId: string) {
  if (lifecycleUserId === userId) return;
  lifecycleUserId = userId;
  // v2 S2.8: the Tier-1 offline engine follows the auth lifecycle. Inert when
  // the sync flag is off and never blocks the auth callback.
  void initTier1Sync({ userId }).catch(() => {
    // Engine boot failures are telemetered inside src/sync.
  });
  // M5 Y2.1: resume this user's durable photo upload queue (never throws).
  startPhotoUploads(userId);
}

function stopLifecycle() {
  lifecycleUserId = null;
  teardownTier1Sync();
  stopPhotoUploads();
}

/** Exported for tests: the single auth-state handler. */
export function handleAuthStateChange(event: AuthChangeEvent, session: Session | null) {
  if (session?.user?.id) {
    writeSession(session);
    startLifecycle(session.user.id);
    return;
  }
  // A null session is only authoritative on an explicit SIGNED_OUT. auth-js
  // emits INITIAL_SESSION(null) when a refresh fails with a retryable
  // (offline) error while still keeping the stored session; treating that as
  // "signed out" bounced offline travellers to /login. The session query's
  // own queryFn resolves the initial state instead.
  if (event !== 'SIGNED_OUT') return;
  writeSession(null);
  stopLifecycle();
}

// ------------------------------------------------------------
// Native deep-link auth callback (PKCE ?code= exchange)
// ------------------------------------------------------------
// auth-js only reads the URL itself when window AND document exist (web). On
// iOS/Android the tripvisor://?code=... return from the magic link / Google
// OAuth must be exchanged here, or sign-in never completes.

let callbackError: string | null = null;
const callbackErrorListeners = new Set<() => void>();
const handledCodes = new Set<string>();

function setCallbackError(next: string | null) {
  callbackError = next;
  callbackErrorListeners.forEach((l) => l());
}

function readParam(url: string, name: string): string | null {
  const m = new RegExp(`[?#&]${name}=([^&#]*)`).exec(url);
  if (!m || m[1] === undefined) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return m[1];
  }
}

/**
 * Exchange a PKCE auth code carried by an incoming deep link. Returns true when
 * the URL was an auth callback (success or error). Exported for tests.
 */
export async function handleAuthCallbackUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  const errorDescription = readParam(url, 'error_description') ?? readParam(url, 'error');
  if (errorDescription) {
    setCallbackError(errorDescription);
    return true;
  }
  const code = readParam(url, 'code');
  if (!code) return false;
  if (handledCodes.has(code)) return true;
  handledCodes.add(code);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  setCallbackError(error ? error.message || 'exchange_failed' : null);
  return true;
}

function subscribeCallbackError(l: () => void) {
  callbackErrorListeners.add(l);
  return () => {
    callbackErrorListeners.delete(l);
  };
}

/** Last deep-link auth callback failure (null when none); login shows it. */
export function useAuthCallbackError(): { error: string | null; clear: () => void } {
  const error = useSyncExternalStore(subscribeCallbackError, () => callbackError, () => callbackError);
  return { error, clear: () => setCallbackError(null) };
}

function ensureAuthListeners() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  supabase.auth.onAuthStateChange((event, session) => handleAuthStateChange(event, session));
  if (Platform.OS !== 'web') {
    void Linking.getInitialURL()
      .then((url) => handleAuthCallbackUrl(url))
      .catch(() => {});
    Linking.addEventListener('url', ({ url }) => {
      void handleAuthCallbackUrl(url).catch(() => {});
    });
  }
}

/** Test-only: reset module-level auth state. */
export function __resetAuthModuleForTests() {
  queryClients.clear();
  listenerRegistered = false;
  lifecycleUserId = null;
  handledCodes.clear();
  callbackError = null;
  callbackErrorListeners.clear();
}

/**
 * The persisted session, read straight from storage. Used when auth-js can't
 * refresh an expired access token because the device is offline: the refresh
 * token is still valid, so the user is NOT signed out and must reach the
 * Tier-1 offline plan. Auto-refresh renews the token once back online.
 */
async function readPersistedSession(): Promise<Session | null> {
  try {
    const key = (supabase.auth as unknown as { storageKey?: string }).storageKey;
    if (!key) return null;
    const raw = await storageAdapter.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (parsed?.access_token && parsed.refresh_token && parsed.user?.id) return parsed as Session;
    return null;
  } catch {
    return null;
  }
}

export function useSession() {
  const qc = useQueryClient();

  useEffect(() => {
    ensureAuthListeners();
    queryClients.set(qc, (queryClients.get(qc) ?? 0) + 1);
    return () => {
      const n = (queryClients.get(qc) ?? 1) - 1;
      if (n <= 0) queryClients.delete(qc);
      else queryClients.set(qc, n);
    };
  }, [qc]);

  return useQuery<Session | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (!isAuthRetryableFetchError(error)) throw error;
        const persisted = await readPersistedSession();
        if (persisted?.user?.id) startLifecycle(persisted.user.id);
        return persisted;
      }
      const session = data.session ?? null;
      if (session?.user?.id) startLifecycle(session.user.id);
      return session;
    },
    staleTime: Infinity,
    // Web pauses queries while navigator is offline; a paused session query
    // has no data and read as "signed out". The queryFn is offline-safe.
    networkMode: 'always',
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
      // Global sign-out hits /logout first; offline, auth-js returns early and
      // keeps the local session, so "Sign out" silently did nothing (on a
      // shared device the next person kept access). Fall back to a local
      // sign-out, which always clears the session and fires SIGNED_OUT; other
      // devices stay signed in until their refresh token expires.
      const { error } = await supabase.auth.signOut();
      if (!error) return;
      const local = await supabase.auth.signOut({ scope: 'local' });
      if (local.error) throw local.error;
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
