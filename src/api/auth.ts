import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

const SESSION_KEY = ['auth', 'session'] as const;

export function useSession() {
  const qc = useQueryClient();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      qc.setQueryData(SESSION_KEY, session ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  return useQuery<Session | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session ?? null;
    },
    staleTime: Infinity,
  });
}

export function useSignInWithMagicLink() {
  return useMutation({
    mutationFn: async (email: string) => {
      // Linking.createURL produces tripvisor://... on native and
      // https://<deployed-host>/... on web — both are accepted by Supabase
      // as long as the URL is in the Supabase project's allow-list.
      const emailRedirectTo = Linking.createURL('/');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo },
      });
      if (error) throw error;
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.setQueryData(SESSION_KEY, null);
      qc.clear();
    },
  });
}
