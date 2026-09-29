/** Adopts the onboarding interest picks into user_preferences (M5 Y3.4). */
import { useEffect, useRef } from 'react';
import { useUpdateUserPreferences, useUserPreferences } from '@/api/preferences';
import { clearPendingInterests, readPendingInterests } from './pendingInterests';

/**
 * Writes onboarding picks to the account once (only when the account has no
 * interests yet, so it never overwrites a choice made on another device).
 */
export function useAdoptPendingInterests(): void {
  const prefs = useUserPreferences();
  const update = useUpdateUserPreferences();
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;
  const done = useRef(false);
  const loaded = prefs.data !== undefined;
  const hasInterests = useRef(false);
  hasInterests.current = (prefs.data?.interests.length ?? 0) > 0;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    void readPendingInterests().then((pending) => {
      if (!mounted.current || !pending) return;
      if (hasInterests.current) {
        void clearPendingInterests();
        return;
      }
      mutateRef.current({ interests: pending }, { onSuccess: () => void clearPendingInterests() });
    });
  }, [loaded]);
}
