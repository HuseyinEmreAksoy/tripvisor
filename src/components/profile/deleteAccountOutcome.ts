/**
 * delete-account error triage (F14).
 *
 * The edge function deletes the auth user FIRST and sweeps trips/storage
 * afterwards, so an error from `functions.invoke('delete-account')` does not
 * always mean the account still exists:
 *   - 500 db_error "Account removed but data cleanup failed" — the account is
 *     gone; only the server-side cleanup failed.
 *   - 401 not_authorized on a retry — the token's user no longer exists
 *     (a previous attempt succeeded but its response was lost).
 * In both cases the client must still wipe Tier-1 data and sign out locally,
 * otherwise the user is stuck in a zombie session that can never delete.
 */

interface ResponseLike {
  status?: number;
  clone?: () => ResponseLike;
  json?: () => Promise<unknown>;
}

async function readBody(res: ResponseLike): Promise<unknown> {
  try {
    const source = typeof res.clone === 'function' ? res.clone() : res;
    return typeof source.json === 'function' ? await source.json() : null;
  } catch {
    return null;
  }
}

/** True when a delete-account error still means the account was removed. */
export async function isAccountGoneError(error: unknown): Promise<boolean> {
  if (!error || typeof error !== 'object') return false;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object') return false;
  const res = context as ResponseLike;
  if (res.status === 401) return true;
  const body = await readBody(res);
  const inner = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const message = typeof inner?.message === 'string' ? inner.message : '';
  return /account removed/i.test(message);
}
