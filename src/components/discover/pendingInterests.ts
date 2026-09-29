/**
 * Interests picked on the onboarding card (M5 Y3.4) before an account
 * exists. They wait in local storage and are written to
 * `user_preferences.interests` the first time a signed-in screen that mounts
 * `useAdoptPendingInterests` (./useAdoptPendingInterests.ts) sees preferences with no interests saved yet
 * (Discover and Profile mount it). Nothing else is stored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInterests, type Interest } from './discoverModel';

export const PENDING_INTERESTS_KEY = 'tripvisor.pendingInterests.v1';

export async function savePendingInterests(interests: readonly Interest[]): Promise<void> {
  try {
    if (interests.length === 0) await AsyncStorage.removeItem(PENDING_INTERESTS_KEY);
    else await AsyncStorage.setItem(PENDING_INTERESTS_KEY, JSON.stringify(interests));
  } catch {
    // Storage unavailable: the picks are simply not remembered. Harmless.
  }
}

export async function readPendingInterests(): Promise<Interest[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_INTERESTS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const list = normalizeInterests(parsed.filter((v): v is string => typeof v === 'string'));
    return list.length ? list : null;
  } catch {
    return null;
  }
}

export async function clearPendingInterests(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_INTERESTS_KEY);
  } catch {
    // ignore
  }
}
