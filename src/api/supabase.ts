import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { storageAdapter } from './storage';

/**
 * `inlined` must be a literal `process.env.EXPO_PUBLIC_X` member expression
 * at the call site — that exact form is what Expo's babel preset replaces at
 * build time. A computed `process.env[key]` lookup is NOT inlined and
 * resolves to undefined in production web bundles, where no runtime
 * process.env exists (this shipped REPLACE_ME to the first live deploy).
 * The dynamic read stays as a fallback for the dev server and jest.
 */
function readEnv(key: string, inlined: string | undefined): string | undefined {
  if (inlined) return inlined;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess) return fromProcess;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const val = extra[key];
  return typeof val === 'string' ? val : undefined;
}

const SUPABASE_URL =
  readEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL) ??
  'https://REPLACE_ME.supabase.co';

const SUPABASE_ANON_KEY =
  readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ??
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
