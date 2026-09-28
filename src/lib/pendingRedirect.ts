/**
 * pendingRedirect — remember where a signed-out user was headed so the app
 * can send them back there after they sign in (e.g. an /invite/<token> link).
 *
 * Stored in AsyncStorage (localStorage on web) because the sign-in round trip
 * can leave the app entirely (magic link opens a new tab, OAuth redirects),
 * so neither router state nor a query param survives it.
 *
 * Only same-origin, app-relative paths are accepted: must start with `/` and
 * must not start with `//` (protocol-relative → open redirect), and must not
 * contain control characters (browsers strip 	/
, so "/	/x" becomes "//x").
 *
 * Entries expire after PENDING_REDIRECT_TTL_MS so a user who abandoned an
 * invite and signs in days later lands on /trips, not a stale invite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_REDIRECT_KEY = 'tripvisor.pendingRedirect';
export const PENDING_REDIRECT_TTL_MS = 60 * 60 * 1000;

interface StoredRedirect {
  path: string;
  at: number;
}

export function isSafeRedirectPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export async function setPendingRedirect(path: string): Promise<void> {
  if (!isSafeRedirectPath(path)) return;
  try {
    const entry: StoredRedirect = { path, at: Date.now() };
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, JSON.stringify(entry));
  } catch {
    // Storage unavailable (private mode, quota) — degrade to the default route.
  }
}

/**
 * Parse a raw stored entry. Unparseable, stale (older than the TTL) or unsafe
 * entries resolve null. Pure — never touches storage; `takePendingRedirect`
 * clears the key itself, and read-only callers (the onboarding gate) use this
 * to tell a live pending redirect from a leftover one.
 */
export function parsePendingRedirect(raw: string): string | null {
  let entry: Partial<StoredRedirect>;
  try {
    entry = JSON.parse(raw) as Partial<StoredRedirect>;
  } catch {
    return null;
  }
  if (typeof entry?.at !== 'number' || Date.now() - entry.at > PENDING_REDIRECT_TTL_MS) return null;
  return isSafeRedirectPath(entry.path) ? entry.path : null;
}

// Shared in-flight read so two callers racing on mount (StrictMode double
// effects, root index + auth layout) see the same value instead of the
// second one reading an already-cleared key.
let inFlight: Promise<string | null> | null = null;

/** Read and clear the stored redirect. Resolves null when none/invalid. */
export function takePendingRedirect(): Promise<string | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_REDIRECT_KEY);
      if (raw === null) return null;
      await AsyncStorage.removeItem(PENDING_REDIRECT_KEY);
      return parsePendingRedirect(raw);
    } catch {
      return null;
    }
  })();
  const p = inFlight;
  void p.finally(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}
