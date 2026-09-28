/**
 * usePendingRedirect — once `enabled` (an authenticated session exists),
 * consume the stored post-login redirect (see src/lib/pendingRedirect.ts).
 *
 *   const { ready, path } = usePendingRedirect(!!session);
 *   if (session && !ready) return <Spinner />;
 *   if (session) return <Redirect href={path ?? '/trips'} />;
 */
import { useEffect, useState } from 'react';
import { takePendingRedirect } from '@/lib/pendingRedirect';

export function usePendingRedirect(enabled: boolean): { ready: boolean; path: string | null } {
  const [state, setState] = useState<{ ready: boolean; path: string | null }>({
    ready: false,
    path: null,
  });

  useEffect(() => {
    if (!enabled || state.ready) return;
    let cancelled = false;
    void takePendingRedirect().then((path) => {
      if (!cancelled) setState({ ready: true, path });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, state.ready]);

  return state;
}
