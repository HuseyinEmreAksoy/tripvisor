/**
 * preferences.ts — `user_preferences` (0037) as Tier-2 TanStack hooks (M5 Y2.2).
 *
 * One row per user: app language (`locale`, NULL = System), default home
 * currency for new trips, recommendation interests. Owner-only RLS; the
 * client upserts its own row (`user_id` defaults to auth.uid()). NOT Tier-1:
 * nothing here syncs offline, and it is not persisted by the query persister
 * (a tiny online read; the language itself lives in AsyncStorage via
 * src/i18n/preference.ts).
 *
 *   const { data: prefs } = useUserPreferences();        // always a full object
 *   const save = useUpdateUserPreferences();
 *   save.mutate({ interests: ['history', 'food'] });      // partial; optimistic
 *   useLanguagePreferenceMirror();                        // keep locale in sync (mount once)
 *
 * Query keys are local (shared-file rule): root 'user-preferences'.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from './supabase';
import { useSession } from './auth';
import {
  DEFAULT_USER_PREFERENCES,
  MAX_INTERESTS,
  type UpdateUserPreferencesInput,
  type UserPreferences,
  type UserPreferencesRow,
} from './preferences.types';
import { isAppLanguage, type AppLanguage, type LanguagePreference } from '@/i18n/languages';
import {
  getLanguagePreference,
  setLanguagePreference,
  useI18nReady,
  useLanguagePreference,
} from '@/i18n/preference';

export type { UpdateUserPreferencesInput, UserPreferences, UserPreferencesRow } from './preferences.types';
export { DEFAULT_USER_PREFERENCES, MAX_INTERESTS } from './preferences.types';

// ===========================================================================
// Keys, errors, mapping
// ===========================================================================

export const userPreferencesKeys = {
  all: ['user-preferences'] as const,
  mine: (userId: string | null) => [...userPreferencesKeys.all, userId ?? 'anonymous'] as const,
};

export type PreferencesErrorCode = 'not_authenticated';

export class PreferencesError extends Error {
  constructor(
    public readonly code: PreferencesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PreferencesError';
  }
}

const SELECT_COLUMNS = 'locale, home_currency, interests, updated_at';

const INTEREST_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

function freshDefaults(): UserPreferences {
  return { ...DEFAULT_USER_PREFERENCES, interests: [] };
}

function dedupe(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

/** Row (or null = no row yet) → the always-complete view. Unknown locales read as System. */
export function toUserPreferences(
  row: Partial<Pick<UserPreferencesRow, 'locale' | 'home_currency' | 'interests' | 'updated_at'>> | null | undefined,
): UserPreferences {
  if (!row) return freshDefaults();
  const locale = isAppLanguage(row.locale) ? row.locale : null;
  const home = typeof row.home_currency === 'string' && /^[A-Z]{3}$/.test(row.home_currency) ? row.home_currency : null;
  const interests = Array.isArray(row.interests)
    ? dedupe(row.interests.filter((k): k is string => typeof k === 'string' && INTEREST_KEY_RE.test(k)))
    : [];
  return { locale, home_currency: home, interests, saved: true, updated_at: row.updated_at ?? null };
}

// Mirrors of the 0037 CHECKs so a bad value fails here, not as a 400.
const updateSchema = z
  .object({
    locale: z.enum(['en', 'tr']).nullable().optional(),
    home_currency: z
      .string()
      .transform((s) => s.trim().toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/, 'home_currency must be an ISO 4217 code like "EUR"'))
      .nullable()
      .optional(),
    interests: z
      .array(z.string().regex(INTEREST_KEY_RE, 'interest keys are lower-case identifiers like "history"'))
      .transform(dedupe)
      .pipe(z.array(z.string()).max(MAX_INTERESTS, `at most ${MAX_INTERESTS} interests`))
      .optional(),
  })
  .strict();

type ParsedUpdate = z.output<typeof updateSchema>;

function sessionUserIdFromCache(qc: QueryClient): string | null {
  const session = qc.getQueryData<{ user?: { id?: string } } | null>(['auth', 'session']);
  return session?.user?.id ?? null;
}

async function currentUserId(qc: QueryClient): Promise<string | null> {
  const cached = sessionUserIdFromCache(qc);
  if (cached) return cached;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

// ===========================================================================
// Fetch + hooks
// ===========================================================================

/** The caller's preferences (defaults when no row exists yet). */
export async function fetchUserPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return toUserPreferences(data as Partial<UserPreferencesRow> | null);
}

/**
 * The signed-in user's preferences. `data` is always a complete object once
 * loaded (`saved: false` until the first save); disabled while signed out.
 */
export function useUserPreferences(options: { enabled?: boolean } = {}) {
  const session = useSession();
  const userId = session.data?.user?.id ?? null;
  return useQuery<UserPreferences, Error>({
    queryKey: userPreferencesKeys.mine(userId),
    enabled: (options.enabled ?? true) && userId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchUserPreferences(userId as string),
  });
}

interface UpdateContext {
  key: readonly unknown[];
  previous: UserPreferences | undefined;
}

/**
 * Partial update (upsert of the own row): only the keys passed are written;
 * `interests` replaces the list (de-duplicated, ≤ 16). Optimistic, rolled
 * back on error. Online mutation (TanStack pauses it offline and resumes on
 * reconnect).
 */
export function useUpdateUserPreferences() {
  const qc = useQueryClient();
  return useMutation<UserPreferences, Error, UpdateUserPreferencesInput, UpdateContext | undefined>({
    mutationFn: async (input) => {
      const patch: ParsedUpdate = updateSchema.parse(input);
      const userId = await currentUserId(qc);
      if (!userId) throw new PreferencesError('not_authenticated', 'Sign in to save preferences');
      const key = userPreferencesKeys.mine(userId);
      if (Object.keys(patch).length === 0) {
        return qc.getQueryData<UserPreferences>(key) ?? fetchUserPreferences(userId);
      }
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      const saved = toUserPreferences(data as Partial<UserPreferencesRow>);
      qc.setQueryData(key, saved);
      return saved;
    },
    onMutate: async (input) => {
      const userId = sessionUserIdFromCache(qc);
      if (!userId) return undefined;
      const key = userPreferencesKeys.mine(userId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UserPreferences>(key);
      const parsed = updateSchema.safeParse(input);
      if (parsed.success) {
        qc.setQueryData<UserPreferences>(key, { ...(previous ?? freshDefaults()), ...parsed.data } as UserPreferences);
      }
      return { key, previous };
    },
    onError: (_err, _input, context) => {
      if (context) qc.setQueryData(context.key, context.previous);
    },
  });
}

// ===========================================================================
// Language mirror (Y3.4 mounts it; src/i18n/preference.ts stays the source of truth)
// ===========================================================================

/** The `user_preferences.locale` value for an i18n preference ('system' → null). */
export function localeForLanguagePreference(preference: LanguagePreference): AppLanguage | null {
  return preference === 'system' ? null : preference;
}

/** The account language is adopted at most once per app session. */
let adoptedThisSession = false;

/** Test seam. */
export function _resetLanguageMirrorForTests(): void {
  adoptedThisSession = false;
}

export interface LanguagePreferenceMirrorOptions {
  /**
   * Adopt the account's saved language once per session when THIS device
   * follows the system language (a new phone opens in the language the user
   * chose elsewhere). Default true.
   */
  adoptAccountLocale?: boolean;
}

/**
 * Keeps `user_preferences.locale` and the device's language choice
 * (src/i18n/preference.ts, AsyncStorage `tv.locale`) in step:
 *   - device → account: when the user CHANGES Profile → Language
 *     (System/Türkçe/English), the choice is saved (System = NULL). Mount
 *     never writes, so two devices never ping-pong.
 *   - account → device: once per session, if this device is on System and
 *     the account has a language, switch to it.
 * Known limit: "System" and "never chosen" look the same on a device
 * (both = no stored value), so a device set to System adopts a language
 * picked later on another device.
 * Mount ONCE, high in the signed-in tree (e.g. the app layout); mounting it
 * only in Profile keeps device → account but adopts only when Profile opens.
 */
export function useLanguagePreferenceMirror(options: LanguagePreferenceMirrorOptions = {}): void {
  const adopt = options.adoptAccountLocale ?? true;
  const ready = useI18nReady();
  const preference = useLanguagePreference();
  const session = useSession();
  const signedIn = Boolean(session.data?.user?.id);
  const prefs = useUserPreferences({ enabled: ready });
  const update = useUpdateUserPreferences();
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;
  const lastSeen = useRef<LanguagePreference | null>(null);

  // device → account, on change only.
  useEffect(() => {
    if (!ready) return;
    if (lastSeen.current === null) {
      lastSeen.current = preference;
      return;
    }
    if (lastSeen.current === preference) return;
    lastSeen.current = preference;
    if (!signedIn) return;
    const locale = localeForLanguagePreference(preference);
    // Already stored (or System with no row yet: nothing worth creating a row for).
    if (prefs.data && prefs.data.locale === locale && (prefs.data.saved || locale === null)) return;
    mutateRef.current({ locale });
  }, [ready, preference, signedIn, prefs.data]);

  // account → device, once per session.
  useEffect(() => {
    if (!adopt || !ready || adoptedThisSession || !prefs.data?.saved) return;
    adoptedThisSession = true;
    const account = prefs.data.locale;
    if (account && getLanguagePreference() === 'system') {
      lastSeen.current = account; // do not echo the adoption back
      void setLanguagePreference(account);
    }
  }, [adopt, ready, prefs.data]);
}
