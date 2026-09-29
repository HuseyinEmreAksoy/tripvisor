import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
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
    // No window = server render (static web export / every page request on the
    // dev server). auth-js would start a never-ending 30 s refresh interval that
    // keeps each request's app instance alive (dev-server memory leak). Browsers
    // and native (RN defines window) keep auto-refresh.
    autoRefreshToken: typeof window !== 'undefined',
    persistSession: true,
    // auth-js only reads the URL in a browser (isBrowser() checks `document`),
    // so on native this flag is inert; the deep-link handler below completes
    // the PKCE exchange there instead (F11-1).
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

export const SUPABASE_CONFIGURED =
  SUPABASE_URL !== 'https://REPLACE_ME.supabase.co' &&
  SUPABASE_ANON_KEY !== 'REPLACE_ME_ANON_KEY';

// ------------------------------------------------------------
// Native auth deep links (F11-1)
// ------------------------------------------------------------
// Magic link and Google OAuth both redirect to Linking.createURL('/')
// (tripvisor:///?code=…) with flowType 'pkce'. On web auth-js exchanges the
// code itself (detectSessionInUrl); on iOS/Android nothing did, so the user
// landed back on /login with no session. This handler reads the launch URL
// and every later 'url' event and exchanges the code for a session; the auth
// listener in auth.ts then picks up SIGNED_IN as usual.

export interface AuthCallbackParams {
  code: string | null;
  /** error_description (or error) from the provider/Supabase redirect. */
  error: string | null;
}

/** Pull `code` / `error_description` out of a redirect URL's query or fragment. */
export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  const params = new Map<string, string>();
  const collect = (part: string | undefined) => {
    if (!part) return;
    new URLSearchParams(part).forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  };
  const hashIdx = url.indexOf('#');
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = beforeHash.indexOf('?');
  collect(qIdx >= 0 ? beforeHash.slice(qIdx + 1) : undefined);
  collect(hashIdx >= 0 ? url.slice(hashIdx + 1) : undefined);
  return {
    code: params.get('code') ?? null,
    error: params.get('error_description') ?? params.get('error') ?? null,
  };
}

/** Codes already exchanged or in flight. getInitialURL and the 'url' event can
 * both deliver the same link, and a PKCE code is single-use. */
const handledAuthCodes = new Set<string>();

export type AuthDeepLinkResult = 'none' | 'duplicate' | 'signed_in' | 'error';

/** Exchange the PKCE code in `url` (if any) for a session. Never throws. */
export async function completeAuthFromUrl(url: string | null | undefined): Promise<AuthDeepLinkResult> {
  if (!url) return 'none';
  const { code, error } = parseAuthCallbackUrl(url);
  if (error && !code) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[auth] sign-in redirect error: ${error}`);
    return 'error';
  }
  if (!code) return 'none';
  if (handledAuthCodes.has(code)) return 'duplicate';
  handledAuthCodes.add(code);
  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return 'signed_in';
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[auth] could not complete sign-in from link', err);
    }
    return 'error';
  }
}

let authDeepLinkInstalled = false;

/** Native only: complete sign-in from the launch URL and every later deep link. */
export function installNativeAuthDeepLinkHandler(): void {
  if (authDeepLinkInstalled || Platform.OS === 'web') return;
  authDeepLinkInstalled = true;
  try {
    Linking.addEventListener('url', ({ url }) => {
      void completeAuthFromUrl(url);
    });
    void Linking.getInitialURL()
      .then((url) => completeAuthFromUrl(url))
      .catch(() => {});
  } catch {
    // Linking unavailable (exotic runtime): sign-in links just won't auto-complete.
  }
}

// Installed at module load so a cold start from the link is handled before
// any screen mounts. Skipped under jest (tests call it explicitly).
if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
  installNativeAuthDeepLinkHandler();
}
