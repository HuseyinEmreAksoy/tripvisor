/**
 * memoryErrors — MemoryErrorInfo → a `memories` i18n key (M5 Y3.1).
 *
 * Keep the KEY in state and translate at render (i18n rule 3). Quota errors
 * pick a key by scope; `pending` is transient (the queue waits on its own),
 * so it reads as "waiting", not as a failure.
 */
import type { MemoryErrorInfo } from '@/api/memories.types';

/** The i18n namespace these keys live in (also marks this file for `i18n:check`). */
export const MEMORY_ERRORS_NS = 'memories' as const;

export type MemoryErrorKey =
  | 'errors.quota_user'
  | 'errors.quota_user_bytes'
  | 'errors.quota_pending'
  | 'errors.quota_trip'
  | 'errors.storage_full'
  | 'errors.unsupported_image'
  | 'errors.image_too_large'
  | 'errors.exif_strip_failed'
  | 'errors.not_authenticated'
  | 'errors.forbidden'
  | 'errors.network'
  | 'errors.not_found'
  | 'errors.generic';

export function memoryErrorKey(info: Pick<MemoryErrorInfo, 'code' | 'scope'> | null | undefined): MemoryErrorKey {
  if (!info) return 'errors.generic';
  switch (info.code) {
    case 'quota_exceeded':
      switch (info.scope) {
        case 'user':
          return 'errors.quota_user';
        case 'user_bytes':
          return 'errors.quota_user_bytes';
        case 'pending':
          return 'errors.quota_pending';
        case 'trip':
          return 'errors.quota_trip';
        case 'global':
          return 'errors.storage_full';
        default:
          return 'errors.quota_user';
      }
    case 'storage_full':
      return 'errors.storage_full';
    case 'unsupported_image':
    case 'image_too_large':
    case 'exif_strip_failed':
    case 'not_authenticated':
    case 'forbidden':
    case 'network':
    case 'not_found':
      return `errors.${info.code}`;
    case 'not_author':
    case 'author_mismatch':
      return 'errors.forbidden';
    default:
      return 'errors.generic';
  }
}

/** Duck-typed read of a thrown MemoryError (or anything with `code`). */
export function errorInfoOf(err: unknown): Pick<MemoryErrorInfo, 'code' | 'scope'> | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; scope?: unknown };
  if (typeof e.code !== 'string') return { code: 'unknown' };
  return {
    code: e.code as MemoryErrorInfo['code'],
    ...(typeof e.scope === 'string' ? { scope: e.scope as MemoryErrorInfo['scope'] } : {}),
  };
}
