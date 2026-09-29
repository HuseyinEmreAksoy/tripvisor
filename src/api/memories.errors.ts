/**
 * memories.errors.ts — one error vocabulary for every memory surface (M5 Y2.1).
 *
 * Server errors arrive as PostgREST errors whose `message` is a token from
 * 0036/0038 (quota ones carry `details` = JSON {scope, limit, used}); Storage
 * errors as StorageApiError {status, statusCode, message}; client pipeline
 * errors as PhotoEncodeError / SyncWriteError. `toMemoryErrorInfo` folds all
 * of them into a serializable MemoryErrorInfo the UI maps to i18n keys
 * (keep KEYS in state, translate at render).
 */

import type { MemoryErrorCode, MemoryErrorInfo, MemoryQuotaScope } from './memories.types';

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  readonly scope?: MemoryQuotaScope;
  readonly limit?: number;
  readonly used?: number;

  constructor(info: MemoryErrorInfo) {
    super(info.message ?? info.code);
    this.name = 'MemoryError';
    this.code = info.code;
    if (info.scope !== undefined) this.scope = info.scope;
    if (info.limit !== undefined) this.limit = info.limit;
    if (info.used !== undefined) this.used = info.used;
  }

  toInfo(): MemoryErrorInfo {
    const info: MemoryErrorInfo = { code: this.code, message: this.message };
    if (this.scope !== undefined) info.scope = this.scope;
    if (this.limit !== undefined) info.limit = this.limit;
    if (this.used !== undefined) info.used = this.used;
    return info;
  }
}

const SERVER_TOKENS: ReadonlySet<MemoryErrorCode> = new Set<MemoryErrorCode>([
  'quota_exceeded',
  'storage_full',
  'upload_incomplete',
  'not_author',
  'immutable_column',
  'author_mismatch',
  'not_found',
  'invalid_status_transition',
  'not_authenticated',
]);

const SCOPES: ReadonlySet<string> = new Set(['user', 'user_bytes', 'pending', 'trip', 'global']);

const NETWORK_RE = /network|failed to fetch|fetch failed|load failed|timeout|timed out|aborted|offline|ECONNREFUSED|ENOTFOUND|socket/i;

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseDetails(details: unknown): Pick<MemoryErrorInfo, 'scope' | 'limit' | 'used'> {
  let obj: unknown = details;
  if (typeof details === 'string') {
    try {
      obj = JSON.parse(details);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object') return {};
  const o = obj as Record<string, unknown>;
  const out: Pick<MemoryErrorInfo, 'scope' | 'limit' | 'used'> = {};
  if (typeof o['scope'] === 'string' && SCOPES.has(o['scope'])) out.scope = o['scope'] as MemoryQuotaScope;
  if (typeof o['limit'] === 'number') out.limit = o['limit'];
  if (typeof o['used'] === 'number') out.used = o['used'];
  return out;
}

/** Fold any thrown/returned error into a MemoryErrorInfo. Never throws. */
export function toMemoryErrorInfo(err: unknown): MemoryErrorInfo {
  if (err instanceof MemoryError) return err.toInfo();
  if (!err || typeof err !== 'object') {
    return { code: 'unknown', message: String(err) };
  }
  const e = err as Record<string, unknown>;
  const name = str(e['name']);
  const message = str(e['message']) ?? '';

  // Client pipeline (duck-typed: avoids importing the RN-bound modules here).
  if (name === 'PhotoEncodeError') {
    const code = str(e['code']);
    if (code === 'unsupported_image' || code === 'image_too_large' || code === 'exif_strip_failed') {
      return { code, message };
    }
  }
  if (name === 'SyncWriteError' && e['code'] === 'invalid_value') return { code: 'invalid_value', message };

  // PostgREST: message = token (0036/0038 raise exception '<token>').
  const token = message.trim() as MemoryErrorCode;
  if (SERVER_TOKENS.has(token)) {
    return { code: token, message, ...parseDetails(e['details']) };
  }
  const pgCode = str(e['code']);
  if (pgCode === '23503') return { code: 'trip_not_found', message };
  if (pgCode === '42501' || /row-level security/i.test(message)) return { code: 'forbidden', message };
  if (pgCode === 'PGRST301' || /JWT|not authenticated/i.test(message)) return { code: 'not_authenticated', message };

  // Storage (StorageApiError: status number, statusCode string).
  const status = typeof e['status'] === 'number' ? (e['status'] as number) : undefined;
  const statusCode = str(e['statusCode']);
  if (status === 403 || statusCode === '403' || statusCode === 'Unauthorized') return { code: 'forbidden', message };
  if (status === 413 || statusCode === '413' || /too large|exceeded the maximum/i.test(message)) {
    return { code: 'image_too_large', message };
  }
  if ((status !== undefined && (status === 0 || status >= 500)) || NETWORK_RE.test(message) || name === 'StorageUnknownError') {
    return { code: 'network', message };
  }
  return { code: 'unknown', message };
}

/** Storage upload answered "already exists" → the object is there: treat as done. */
export function isStorageAlreadyExists(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const status = e['status'];
  const statusCode = str(e['statusCode']);
  const message = str(e['message']) ?? '';
  return status === 409 || statusCode === '409' || statusCode === 'Duplicate' || /already exists|duplicate/i.test(message);
}

/** Errors the queue retries on its own (with backoff) instead of failing the job. */
export function isTransientMemoryError(info: MemoryErrorInfo): boolean {
  if (info.code === 'network' || info.code === 'unknown' || info.code === 'upload_incomplete') return true;
  return info.code === 'quota_exceeded' && info.scope === 'pending';
}
