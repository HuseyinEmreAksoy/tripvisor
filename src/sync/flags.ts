/**
 * flags.ts — Tier-1 sync master switch (v2 S2.2).
 *
 * Tier-1 offline sync is OFF unless one of:
 *   1. build-time:  EXPO_PUBLIC_SYNC_TIER1 === '1' (env default — baked
 *      into the bundle, used for local dev / canary builds), OR
 *   2. runtime:     app_config row `sync_tier1 = 'on'` (the 0022
 *      kill-switch table — flips shipped clients without a build; same
 *      pattern as map_provider_web / routing_provider).
 *
 * When OFF, every export of src/sync is an inert no-op: hydrate.ts checks
 * this flag before attaching any sync/persistence machinery, so users see
 * ZERO behavior change (the TanStack persister remains the only
 * persistence engine until Wave 3 retires it).
 *
 * This is the plain-function (non-React) sibling of useAppConfig
 * (src/api/app-config.ts): the sync engine boots outside the React tree,
 * so it cannot use the hook. Same graceful-degrade contract — a missing
 * table / failed request / logged-out client resolves to "absent key", i.e.
 * the env default. Never throws, never blocks startup.
 */

import { supabase } from '../api/supabase';

const APP_CONFIG_KEY = 'sync_tier1';

function envDefault(): boolean {
  return process.env.EXPO_PUBLIC_SYNC_TIER1 === '1';
}

/** undefined = app_config not consulted yet (treat as env default). */
let remoteValue: string | undefined;
let loadPromise: Promise<boolean> | null = null;

/**
 * Synchronous read of the flag. Before `loadTier1SyncFlag()` resolves this
 * reflects only the env default — callers that must honor the runtime
 * kill-switch (hydrate.ts) await the async form instead.
 */
export function isTier1SyncEnabled(): boolean {
  if (remoteValue !== undefined) return remoteValue === 'on';
  return envDefault();
}

/**
 * Resolve the flag, consulting app_config once and caching for the process
 * lifetime (config flips are rare; a restart picks them up — consistent
 * with useAppConfig's 5-minute staleTime being "eventually" too).
 *
 * Remote semantics: `'on'` enables, any OTHER present value ('off', typo…)
 * force-disables (kill-switch must win over the env default), absence falls
 * back to the env default.
 */
export function loadTier1SyncFlag(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', APP_CONFIG_KEY)
        .maybeSingle();
      if (!error && data && typeof data.value === 'string') {
        remoteValue = data.value;
      }
    } catch {
      // Network down / table missing — keep env default. Deliberately quiet:
      // this runs at every cold start, offline included.
    }
    return isTier1SyncEnabled();
  })();
  return loadPromise;
}

/** Test seam — resets the module-level cache. */
export function _resetTier1SyncFlagForTests(): void {
  remoteValue = undefined;
  loadPromise = null;
}
