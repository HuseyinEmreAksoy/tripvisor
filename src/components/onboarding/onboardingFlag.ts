/**
 * First-run onboarding gate (v2 M4 X3.2).
 *
 * The 3-card intro shows once per device, and only to a signed-out visitor
 * who landed on `/`. It never shows when:
 *   - a session exists (a returning user, or a magic link landing on `/`);
 *     the flag is set then too, so signing out later doesn't replay it;
 *   - a post-login redirect is pending (an invite/share link was opened
 *     signed-out) and still live: an expired, unparseable or unsafe leftover
 *     entry (same TTL/rules as takePendingRedirect) does not suppress it. Those cold starts go straight to /login from the invite
 *     screen anyway; this check covers a user who then navigates to `/`;
 *   - storage is unreadable (private mode, quota). Fail open, to login.
 *
 * Invite and share links never render `app/index.tsx`, so they can't be
 * trapped by it in the first place.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_REDIRECT_KEY, parsePendingRedirect } from '@/lib/pendingRedirect';

export const ONBOARDING_SEEN_KEY = 'tripvisor.onboardingSeen.v1';

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // Storage unavailable: the intro may show again next time. Harmless.
  }
}

/** True only when the intro should be shown (see the rules above). */
export async function shouldShowOnboarding(): Promise<boolean> {
  try {
    const [seen, pending] = await Promise.all([
      AsyncStorage.getItem(ONBOARDING_SEEN_KEY),
      AsyncStorage.getItem(PENDING_REDIRECT_KEY),
    ]);
    const hasLivePending = pending !== null && parsePendingRedirect(pending) !== null;
    return seen === null && !hasLivePending;
  } catch {
    return false;
  }
}

export interface OnboardingGate {
  /** False until the storage check resolves (render a spinner meanwhile). */
  ready: boolean;
  show: boolean;
  /** Persist the flag and hide the intro. */
  finish: () => Promise<void>;
}

/**
 * `signedOut` must be true only once the session check has resolved with no
 * session. While it's false, the hook reports ready/hidden and (when a
 * session exists) records the flag so a returning user never sees the intro.
 */
export function useOnboardingGate(signedOut: boolean, hasSession: boolean): OnboardingGate {
  const [state, setState] = useState<{ ready: boolean; show: boolean }>({ ready: false, show: false });

  useEffect(() => {
    if (hasSession) void markOnboardingSeen();
  }, [hasSession]);

  useEffect(() => {
    if (!signedOut) return;
    let cancelled = false;
    void shouldShowOnboarding().then((show) => {
      if (!cancelled) setState({ ready: true, show });
    });
    return () => {
      cancelled = true;
    };
  }, [signedOut]);

  const finish = useCallback(async () => {
    await markOnboardingSeen();
    setState({ ready: true, show: false });
  }, []);

  return { ready: state.ready, show: state.show, finish };
}
