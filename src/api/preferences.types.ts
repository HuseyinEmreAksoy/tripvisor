/**
 * `user_preferences` (migration 0037) — M5 Y2.2 types. Tier-2 (TanStack
 * Query, online), owner-only RLS: a user only ever reads/writes their own row.
 */
import type { CurrencyCode, Uuid } from './types';
import type { AppLanguage } from '@/i18n/languages';

/** The row as PostgREST returns it. */
export interface UserPreferencesRow {
  user_id: Uuid;
  /** NULL = follow the device ("System"). DB CHECK `^[a-z]{2,3}(-[A-Z]{2})?$`. */
  locale: string | null;
  /** Default home currency for NEW trips (ISO 4217), NULL = not chosen. */
  home_currency: CurrencyCode | null;
  /** Lower-case interest keys (≤ 16), e.g. 'history', 'food'. */
  interests: string[];
  created_at: string;
  updated_at: string;
}

/**
 * What `useUserPreferences()` returns. Always a full object (defaults until
 * the user saves anything): no null-checks in the UI.
 */
export interface UserPreferences {
  /** The app language the user picked ('en' | 'tr'), or null for System / not set. */
  locale: AppLanguage | null;
  /** ISO 4217, or null. Pre-fill the new-trip home-currency picker with it. */
  home_currency: CurrencyCode | null;
  /**
   * Interest keys, in the order saved, de-duplicated. Every well-formed key
   * is kept (a newer client may know more than `INTERESTS`); filter with
   * `isInterest` from './recommendations' for the chip set.
   */
  interests: string[];
  /** False until a row exists server-side (first save creates it). */
  saved: boolean;
  updated_at: string | null;
}

/**
 * A partial update: only the keys you pass are written (upsert merges
 * columns). `null` clears a value; `interests` REPLACES the whole list.
 */
export interface UpdateUserPreferencesInput {
  locale?: AppLanguage | null;
  home_currency?: CurrencyCode | null;
  interests?: readonly string[];
}

export const DEFAULT_USER_PREFERENCES: Readonly<UserPreferences> = Object.freeze({
  locale: null,
  home_currency: null,
  interests: [],
  saved: false,
  updated_at: null,
});

/** Max interests per user (DB CHECK cardinality ≤ 16). */
export const MAX_INTERESTS = 16;
