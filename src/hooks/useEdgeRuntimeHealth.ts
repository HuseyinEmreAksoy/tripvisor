/**
 * useEdgeRuntimeHealth — Phase 25 Step 25.12.
 *
 * Developer-experience hook that pings the local Supabase Edge Functions
 * runtime on mount. Only active when `EXPO_PUBLIC_SUPABASE_URL` points to
 * localhost / 127.0.0.1 (i.e. the local dev environment). In production
 * the hook short-circuits and always returns `{ status: 'unknown' }` so
 * no network request is made.
 *
 * The "ping" is a GET to the `places-autocomplete` function with a `?ping`
 * query param. The function may return any status — we only care whether
 * the Edge Runtime itself is reachable (no network error / 503 connection
 * refused). A 400 "invalid input" is still "reachable"; a network error or
 * 503 Service Unavailable is "unreachable".
 *
 * Usage:
 *   const { status, dismiss } = useEdgeRuntimeHealth();
 *   // status: 'reachable' | 'unreachable' | 'unknown'
 *   // Call dismiss() to hide the banner for the session.
 */
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';

type HealthStatus = 'reachable' | 'unreachable' | 'unknown';

// `inlined` must be a literal `process.env.EXPO_PUBLIC_X` expression at the
// call site — the only form Expo inlines at build time; computed
// `process.env[key]` is NOT inlined (production web has no runtime
// process.env). Dynamic read kept as dev-server/jest fallback.
function readEnv(key: string, inlined: string | undefined): string | undefined {
  if (inlined) return inlined;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const val = extra[key];
  return typeof val === 'string' ? val : undefined;
}

const SUPABASE_URL =
  readEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL) ?? '';

/** Returns true only when running against local Supabase dev stack. */
function isLocalEnv(): boolean {
  if (!SUPABASE_URL) return false;
  return (
    SUPABASE_URL.includes('127.0.0.1') ||
    SUPABASE_URL.includes('localhost')
  );
}

export function useEdgeRuntimeHealth(): {
  status: HealthStatus;
  dismiss: () => void;
} {
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only ping in local dev environments.
    if (!isLocalEnv()) return;

    let cancelled = false;

    async function ping() {
      try {
        const url = `${SUPABASE_URL}/functions/v1/places-autocomplete?ping`;
        const res = await fetch(url, {
          method: 'GET',
          // Short timeout so the banner appears quickly on failure.
          signal: AbortSignal.timeout(4000),
        });
        if (!cancelled) {
          // Any HTTP response (even 4xx) means the runtime is up.
          // 503 typically means the runtime process itself is down.
          setStatus(res.status === 503 ? 'unreachable' : 'reachable');
        }
      } catch {
        if (!cancelled) {
          setStatus('unreachable');
        }
      }
    }

    void ping();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => setDismissed(true);

  // If dismissed or not in local env, report 'unknown' so the banner hides.
  if (dismissed || !isLocalEnv()) return { status: 'unknown', dismiss };

  return { status, dismiss };
}
