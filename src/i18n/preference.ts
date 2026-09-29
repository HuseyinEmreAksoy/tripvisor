/**
 * Profile → Language: the persisted override (ADR-0011 §3) and the hooks the
 * UI uses to read it, switch it, and follow the device in System mode.
 *
 * Storage is AsyncStorage `tv.locale` (`tr` | `en`; absent = System). On web
 * the value was already read synchronously at boot; on native it is hydrated
 * here, and `useI18nReady` lets the root layout hold the splash until then so
 * a user who picked another language never sees a flash of the device one.
 */
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocales } from 'expo-localization';
import { useTranslation } from 'react-i18next';
import { deviceLocaleFrom } from './device';
import { appLocale, bootPreference, currentLanguage, getDeviceLocale, i18n, setDeviceLocale } from './instance';
import {
  FALLBACK_LANGUAGE,
  LOCALE_STORAGE_KEY,
  isAppLanguage,
  parsePreference,
  resolveLanguage,
  type AppLanguage,
  type LanguagePreference,
} from './languages';
import { SYNC_PREFERENCE_READ } from './platform';

/** Longest the root layout waits for native storage before rendering anyway. */
const HYDRATION_TIMEOUT_MS = 500;

let preference: LanguagePreference = bootPreference;
let ready = SYNC_PREFERENCE_READ;
let changedByUser = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function markReady(): void {
  if (ready) return;
  ready = true;
  emit();
}

async function apply(next: LanguagePreference): Promise<void> {
  preference = next;
  emit();
  const target = resolveLanguage(next, getDeviceLocale().tags);
  if (target !== currentLanguage()) await i18n.changeLanguage(target);
}

export function getLanguagePreference(): LanguagePreference {
  return preference;
}

/** Switches the app language now (no restart) and persists the choice. */
export async function setLanguagePreference(next: LanguagePreference): Promise<void> {
  changedByUser = true;
  await apply(next);
  try {
    if (next === 'system') await AsyncStorage.removeItem(LOCALE_STORAGE_KEY);
    else await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Storage unavailable: the choice holds for this session only.
  }
}

let hydration: Promise<void> | null = null;

/** Reads the persisted choice once. Safe to call repeatedly. */
export function hydrateLanguagePreference(): Promise<void> {
  if (!hydration) {
    const timer = setTimeout(markReady, HYDRATION_TIMEOUT_MS);
    hydration = (async () => {
      try {
        const stored = parsePreference(await AsyncStorage.getItem(LOCALE_STORAGE_KEY));
        // A switch made while we were reading wins over the stored value.
        if (!changedByUser && stored !== preference) await apply(stored);
      } catch {
        // Unreadable storage: stay on the device language.
      } finally {
        clearTimeout(timer);
        markReady();
      }
    })();
  }
  return hydration;
}

void hydrateLanguagePreference();

export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(subscribe, getLanguagePreference, getLanguagePreference);
}

/** False on native until the stored choice is applied (or the timeout hits). */
export function useI18nReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => true,
  );
}

/** The language System mode would pick right now (for the Profile hint). */
export function deviceLanguage(): AppLanguage {
  return resolveLanguage('system', getDeviceLocale().tags);
}

/**
 * Mount once at the root: in System mode, follow OS language changes
 * (Android per-app language, iOS Settings, browser `languagechange`).
 */
export function useSystemLanguageSync(): void {
  const locales = useLocales();
  const current = useLanguagePreference();
  useEffect(() => {
    setDeviceLocale(deviceLocaleFrom(locales));
    if (current !== 'system') return;
    const target = resolveLanguage('system', getDeviceLocale().tags);
    if (target !== currentLanguage()) void i18n.changeLanguage(target);
  }, [locales, current]);
}

/** Active language + its Intl tag; re-renders the caller on a switch. */
export function useAppLocale(): { language: AppLanguage; locale: string } {
  const { i18n: instance } = useTranslation();
  const lng = instance.resolvedLanguage ?? instance.language;
  const language = isAppLanguage(lng) ? lng : FALLBACK_LANGUAGE;
  return { language, locale: appLocale(language) };
}
