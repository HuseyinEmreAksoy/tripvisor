/**
 * Maps a Supabase auth failure (magic-link send) to an `errors` namespace key,
 * so the message follows the app language instead of echoing the server's
 * English text. Unknown failures get a generic "couldn't send the link".
 */
export type AuthErrorKey =
  | 'errors:auth.rateLimited'
  | 'errors:auth.invalidEmail'
  | 'errors:network'
  | 'errors:auth.sendLinkFailed';

export function authErrorKey(error: unknown): AuthErrorKey {
  const e = (error ?? {}) as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.status === 429 || code.includes('rate_limit') || /rate limit|security purposes/i.test(message)) {
    return 'errors:auth.rateLimited';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'errors:auth.invalidEmail';
  if (e.name === 'AuthRetryableFetchError' || /network|failed to fetch|fetch failed/i.test(message)) {
    return 'errors:network';
  }
  return 'errors:auth.sendLinkFailed';
}
