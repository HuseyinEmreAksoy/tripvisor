/**
 * useGoogleSignIn — Google OAuth sign-in via Supabase Auth
 * (v2 Phase N1 step 1.6; provider config lands in N2 step 2.5).
 *
 * Web-first: `signInWithOAuth` redirects the current page to Google and back
 * to `redirectTo` (the web origin via Linking.createURL — same mechanism the
 * magic-link flow already uses, so the Supabase URL allow-list is shared).
 *
 * Native: supabase-js can't redirect a native "page", so it returns the
 * provider URL instead; we open it in the system browser and the deep link
 * (tripvisor://) completes the session — Supabase's default flow, accepted
 * as-is for this phase.
 *
 * Until the Google provider is configured in Supabase (N2), the call errors —
 * consumers should show a friendly "not configured yet, use email" note
 * (GoogleSignInButton does this).
 */
import { useMutation } from '@tanstack/react-query';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from '@/api/supabase';

export function useGoogleSignIn() {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const redirectTo = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
      // Native: open the returned provider URL in the system browser
      // (on web supabase-js has already navigated the page away).
      if (Platform.OS !== 'web' && data?.url) {
        await Linking.openURL(data.url);
      }
    },
  });
}
