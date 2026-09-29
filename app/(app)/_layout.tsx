import { useEffect, useState } from 'react';
import { Redirect, Stack, useGlobalSearchParams, usePathname, useSegments } from 'expo-router';
import { useSession } from '@/api';
import { setPendingRedirect } from '@/lib/pendingRedirect';
import { UndoToast } from '@/components/UndoToast';

// v2 M4 X1.1: the (tabs) group (Trips · Today · Insights · Profile) is the
// base of this Stack, so a deep link straight to /trip/:id still has the tabs
// underneath and "back" lands on Trips instead of a dead end.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Tab roots are where a sign-out usually happens — remembering them would just
// re-open e.g. Settings after the next sign-in, so they are not stored.
const NON_DEEP_PATHS = new Set(['/', '/trips', '/settings', '/analytics']);

/**
 * Serialise the current route (pathname + non-segment query params) so a
 * signed-out deep link (e.g. /trip/<id>?tab=map) survives the sign-in round
 * trip. Returns null for tab roots. Exported for tests.
 */
export function buildPendingPath(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
  segments: readonly string[],
): string | null {
  if (!pathname || NON_DEEP_PATHS.has(pathname)) return null;
  const dynamic = new Set(
    segments
      .map((s) => /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(s)?.[1])
      .filter((k): k is string => Boolean(k)),
  );
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (dynamic.has(k) || v == null) continue;
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
  }
  const query = qs.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function AppLayout() {
  const { data: session, isLoading } = useSession();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = useSegments();
  const needsLogin = !isLoading && !session;
  const [redirectStored, setRedirectStored] = useState(false);
  const pendingPath = needsLogin ? buildPendingPath(pathname, params, segments) : null;

  // Signed-out deep link: remember the destination (as invite/[token] does)
  // before bouncing to /login; the (auth) layout / root index consume it.
  useEffect(() => {
    if (!needsLogin) return;
    let cancelled = false;
    const done = () => {
      if (!cancelled) setRedirectStored(true);
    };
    if (pendingPath) void setPendingRedirect(pendingPath).finally(done);
    else done();
    return () => {
      cancelled = true;
    };
  }, [needsLogin, pendingPath]);

  if (isLoading) return null;
  if (!session) return redirectStored ? <Redirect href="/login" /> : null;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {/* v2 S2.8.8: global undo toast — absolute-positioned sibling of the
          Stack so it floats over every signed-in screen. Renders null while
          the Tier-1 sync flag is off (undo entries are only pushed by sync
          mutations), so the v1 tree is unchanged. */}
      <UndoToast />
    </>
  );
}
