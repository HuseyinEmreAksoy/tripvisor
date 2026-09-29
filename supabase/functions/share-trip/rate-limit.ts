// share-trip — rate limits for the ANONYMOUS ops (read / photo_url / meta).
//
// Why: `read` runs several service-role queries and signs up to 100 photo
// thumbnails; `photo_url` signs a full-size image (Storage egress). Anyone
// holding a link could loop them. Migration 0040 adds
// consume_share_read(token_key, ip_key, token_cap, ip_cap) (service role
// only): an atomic per-LINK counter (UTC day) plus an optional per-IP
// counter (UTC hour). Past a cap -> 429 `rate_limited` with Retry-After.
//
// Keys never hold a token or a raw IP:
//   link: '<p>t:<trip_shares.id>'   (the share row id, known only after the
//         token lookup, so an unknown token never creates a counter row)
//   ip:   '<p>i:<first 32 hex of HMAC-SHA256(secret, ip)>'; IPv6 is cut to
//         its /64 (one subscriber usually owns a whole /64).
// The client IP is the FIRST hop of x-forwarded-for (the Supabase gateway's
// view of the caller), else cf-connecting-ip / x-real-ip, else 'unknown'
// (one shared bucket). A spoofed header can at worst move a caller to
// another IP bucket; the per-link cap still bounds every link.
//
// Pure except for `consumeShareRead` (one RPC through the passed client).

export type ShareOpKind = 'read' | 'photo_url' | 'meta';

export interface ShareRateLimit {
  /** Per link, per UTC day. */
  tokenCap: number;
  /** Per client IP, per UTC hour; null = no IP limit. */
  ipCap: number | null;
  tokenPrefix: string;
  ipPrefix: string | null;
}

/**
 * Caps (BUILD-LOG Wave-2 gate #2): ~300 reads per link per day, ~60 per IP
 * per hour. The client caches a read for 40 min, so a real viewer uses a
 * handful. Full-size photos are opened one at a time from the lightbox.
 * `meta` is the link-preview call of the Cloudflare Pages function (it runs
 * server-side, so every unfurl shares a few Cloudflare IPs: no IP limit, and
 * it signs nothing).
 */
export const SHARE_RATE_LIMITS: Readonly<Record<ShareOpKind, ShareRateLimit>> = Object.freeze({
  read: { tokenCap: 300, ipCap: 60, tokenPrefix: 'rt', ipPrefix: 'ri' },
  photo_url: { tokenCap: 1000, ipCap: 300, tokenPrefix: 'pt', ipPrefix: 'pi' },
  meta: { tokenCap: 200, ipCap: null, tokenPrefix: 'mt', ipPrefix: null },
});

/** Retry-After when the counter itself is unavailable (fail closed). */
export const UNAVAILABLE_RETRY_AFTER_S = 60;

/** Normalised client IP ('unknown' when there is no usable header). */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff ? xff.split(',')[0] : null;
  for (const raw of [first, headers.get('cf-connecting-ip'), headers.get('x-real-ip')]) {
    const ip = normaliseIp(raw);
    if (ip) return ip;
  }
  return 'unknown';
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 as-is (port stripped), IPv6 cut to its /64; null when unparseable. */
export function normaliseIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // [v6]:port / v4:port
  const bracket = /^\[([0-9a-f:.]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  const v4 = IPV4.exec(s);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255) ? v4.slice(1).map(Number).join('.') : null;
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(':')) return null;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is the IPv4 caller.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return normaliseIp(mapped[1]);
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Counter keys for one call (see the header). */
export async function rateKeys(
  kind: ShareOpKind,
  shareId: string,
  ip: string,
  secret: string,
): Promise<{ tokenKey: string; ipKey: string | null }> {
  const limit = SHARE_RATE_LIMITS[kind];
  const tokenKey = `${limit.tokenPrefix}:${shareId.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
  if (!limit.ipPrefix) return { tokenKey, ipKey: null };
  const ipKey = `${limit.ipPrefix}:${(await hmacHex(secret, ip)).slice(0, 32)}`;
  return { tokenKey, ipKey };
}

export type RateOutcome =
  | { allowed: true }
  | { allowed: false; scope: 'token' | 'ip' | 'unavailable'; retryAfter: number };

/** Minimal client surface (tests pass a fake). */
export interface RpcLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * One atomic check-and-count through 0040 consume_share_read. Fails CLOSED:
 * an RPC error or a malformed answer is `unavailable` (the caller answers
 * 503), never a free pass.
 */
export async function consumeShareRead(
  admin: RpcLike,
  kind: ShareOpKind,
  keys: { tokenKey: string; ipKey: string | null },
): Promise<RateOutcome> {
  const limit = SHARE_RATE_LIMITS[kind];
  try {
    const { data, error } = await admin.rpc('consume_share_read', {
      p_token_key: keys.tokenKey,
      p_ip_key: keys.ipKey,
      p_token_cap: limit.tokenCap,
      p_ip_cap: keys.ipKey ? limit.ipCap : null,
    });
    if (error || !data || typeof data !== 'object') {
      return { allowed: false, scope: 'unavailable', retryAfter: UNAVAILABLE_RETRY_AFTER_S };
    }
    const d = data as { allowed?: unknown; scope?: unknown; retry_after?: unknown };
    if (d.allowed === true) return { allowed: true };
    if (d.allowed === false && (d.scope === 'token' || d.scope === 'ip')) {
      const retry = typeof d.retry_after === 'number' && Number.isFinite(d.retry_after) ? Math.ceil(d.retry_after) : 3600;
      return { allowed: false, scope: d.scope, retryAfter: Math.max(1, retry) };
    }
    return { allowed: false, scope: 'unavailable', retryAfter: UNAVAILABLE_RETRY_AFTER_S };
  } catch {
    return { allowed: false, scope: 'unavailable', retryAfter: UNAVAILABLE_RETRY_AFTER_S };
  }
}
