/**
 * app_config — runtime remote-config / kill-switches (v2 Phase N5.4).
 *
 * Tiny key/value table read ONCE at startup and cached. Lets us steer shipped
 * clients (web map provider, routing provider) without an EAS build or OTA
 * push — `EXPO_PUBLIC_*` env vars are baked at build time and become DEFAULTS
 * only (panel decision, docs/v2/risks-and-decisions.md).
 *
 * Known keys (absence = fall back to the env default):
 *   - `map_provider_web`   — 'maplibre' | 'google'
 *   - `routing_provider`   — 'ors' | 'google' (read server-side by the
 *                            routing Edge Functions; mirrored here for
 *                            observability/debug surfaces only)
 *
 * Graceful by design: if the table doesn't exist yet (migration 0022 not
 * applied) or the request fails, the hook resolves to `{}` and every consumer
 * falls back to its env default. Never throws, never blocks startup.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export const appConfigKeys = {
  all: ['app-config'] as const,
};

export function useAppConfig() {
  return useQuery<Record<string, string>>({
    queryKey: appConfigKeys.all,
    // Config changes are rare; refetch at most every 5 minutes, keep last
    // known value for a day so offline starts still get the cached switch.
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('app_config').select('key,value');
        if (error) return {};
        const out: Record<string, string> = {};
        for (const row of data ?? []) {
          if (typeof row.key === 'string' && typeof row.value === 'string') {
            out[row.key] = row.value;
          }
        }
        return out;
      } catch {
        return {};
      }
    },
  });
}
