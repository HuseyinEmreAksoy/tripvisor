import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { storageAdapter } from './storage';

function readEnv(key: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const val = extra[key];
  return typeof val === 'string' ? val : undefined;
}

const SUPABASE_URL =
  readEnv('EXPO_PUBLIC_SUPABASE_URL') ??
  'https://REPLACE_ME.supabase.co';

const SUPABASE_ANON_KEY =
  readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') ??
  'REPLACE_ME_ANON_KEY';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: storageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export const SUPABASE_CONFIGURED =
  SUPABASE_URL !== 'https://REPLACE_ME.supabase.co' &&
  SUPABASE_ANON_KEY !== 'REPLACE_ME_ANON_KEY';
