/**
 * useSafeBack — back navigation that never strands the user.
 *
 * `router.back()` is a no-op when there is no history (web deep link,
 * bookmark, hard refresh, shared URL). This falls back to `replace(fallback)`
 * in that case — same pattern trip/plan.tsx established in 1.8.
 *
 *   const goBack = useSafeBack(`/trip/${id}`);
 *   <BackButton onPress={goBack} />
 */
import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';

export function useSafeBack(fallback: Href = '/trips'): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
    // `fallback` is usually an inline template string; compare by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, typeof fallback === 'string' ? fallback : JSON.stringify(fallback)]);
}
