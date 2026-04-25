/**
 * recentPlaces — local AsyncStorage cache of recently picked places.
 *
 * Cross-platform: AsyncStorage uses localStorage on web automatically.
 * No platform split required.
 *
 * Google ToS compliance: only placeId + display strings + timestamp are
 * persisted. Rating, photos, opening_hours, etc. are NEVER stored here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RecentPlace {
  placeId: string;
  mainText: string;
  secondaryText: string;
  lastUsedAt: string; // ISO 8601
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_RECENT_PLACES = 10;
export const STORAGE_KEY = '@tripvisor/recent-places/v1';

// ─── Shape validation ─────────────────────────────────────────────────────────

function isValidEntry(value: unknown): value is RecentPlace {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.placeId === 'string' &&
    v.placeId.length > 0 &&
    typeof v.mainText === 'string' &&
    typeof v.secondaryText === 'string' &&
    typeof v.lastUsedAt === 'string'
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the stored recent places, sorted by lastUsedAt DESC.
 * Returns an empty array on any read/parse error — recents are advisory only.
 */
export async function getRecentPlaces(): Promise<RecentPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidEntry);
    return valid.sort(
      (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
    );
  } catch {
    console.warn('[recentPlaces] Failed to read recent places from storage');
    return [];
  }
}

/**
 * Prepends entry to the recent places list, deduplicating by placeId,
 * and caps the list at MAX_RECENT_PLACES.
 * Errors are swallowed silently (warn-logged only).
 */
export async function addRecentPlace(
  entry: Omit<RecentPlace, 'lastUsedAt'>,
): Promise<void> {
  try {
    const current = await getRecentPlaces();
    const deduplicated = current.filter((r) => r.placeId !== entry.placeId);
    const next: RecentPlace[] = [
      { ...entry, lastUsedAt: new Date().toISOString() },
      ...deduplicated,
    ].slice(0, MAX_RECENT_PLACES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    console.warn('[recentPlaces] Failed to save recent place to storage');
  }
}

/**
 * Removes all stored recent places.
 * Errors are swallowed silently (warn-logged only).
 */
export async function clearRecentPlaces(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    console.warn('[recentPlaces] Failed to clear recent places from storage');
  }
}
