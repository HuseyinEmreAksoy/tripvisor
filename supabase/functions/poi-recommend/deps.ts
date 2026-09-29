// poi-recommend — supabase-js wiring for PoiDeps (see handler.ts).
//
// Client: one service-role client with a 5 s per-request timeout
// (_shared/service-usage.ts has the justification). poi_cache writes and the
// consume_service_usage / consume_poi_quota RPCs are service-role only
// (0037); the user id passed to consume_poi_quota is the GoTrue-verified
// caller from requireUser. Reads are public OSM/Wikipedia data + app_config.
//
// OVERPASS_URLS (optional secret): comma-separated https interpreter URLs,
// tried in order. Unset = DEFAULT_OVERPASS_URLS in handler.ts.

import {
  type AdminLike,
  consumePoiQuota,
  consumeServiceUsage,
  makeConfigReader,
  timedAdminClient,
  // @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
} from '../_shared/service-usage.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { DEFAULT_OVERPASS_URLS, type PoiDeps } from './handler.ts';

/** Parse OVERPASS_URLS; invalid or non-https entries are dropped. */
export function parseOverpassUrls(raw: string | undefined): string[] {
  const urls = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => {
      try {
        return new URL(s).protocol === 'https:';
      } catch {
        return false;
      }
    });
  return urls.length > 0 ? urls : [...DEFAULT_OVERPASS_URLS];
}

export function supabaseDeps(): PoiDeps {
  // @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
  const env = (k: string): string | undefined => Deno.env.get(k);
  let admin: AdminLike | null = null;
  const client = (): AdminLike => {
    if (admin) return admin;
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Supabase admin env vars missing');
    admin = timedAdminClient(url, key);
    return admin;
  };
  let readConfig: ((key: string) => Promise<string | null>) | null = null;

  return {
    async cacheGet(keys) {
      const rows = new Map<string, { payload: unknown; fetchedAt: number }>();
      if (keys.length === 0) return { rows, error: null };
      try {
        const { data, error } = await client()
          .from('poi_cache')
          .select('key, payload, fetched_at')
          .in('key', keys);
        if (error) return { rows, error: String(error.message) };
        for (const r of (data ?? []) as Array<{ key: string; payload: unknown; fetched_at: string }>) {
          const t = Date.parse(r.fetched_at);
          if (Number.isFinite(t)) rows.set(r.key, { payload: r.payload, fetchedAt: t });
        }
        return { rows, error: null };
      } catch (e) {
        return { rows, error: String(e) };
      }
    },

    async cachePut(rows) {
      try {
        const fetchedAt = new Date().toISOString();
        const { error } = await client()
          .from('poi_cache')
          .upsert(
            rows.map((r) => ({ key: r.key, payload: r.payload, fetched_at: fetchedAt })),
            { onConflict: 'key' },
          );
        return { error: error ? String(error.message) : null };
      } catch (e) {
        return { error: String(e) };
      }
    },

    async readConfig(key) {
      try {
        readConfig ??= makeConfigReader(client());
        return await readConfig(key);
      } catch {
        return null;
      }
    },

    async consumeService(service, units, cap) {
      try {
        return await consumeServiceUsage(client(), service, units, cap);
      } catch {
        return 'unavailable';
      }
    },

    async consumeUserQuota(userId, units, cap) {
      try {
        return await consumePoiQuota(client(), userId, units, cap);
      } catch {
        return 'unavailable';
      }
    },

    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    overpassUrls: parseOverpassUrls(env('OVERPASS_URLS')),
    contact: env('UPSTREAM_CONTACT'),
  };
}
