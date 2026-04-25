/**
 * Unit tests for src/lib/recentPlaces.ts
 *
 * Covers:
 *   - getRecentPlaces: empty storage, invalid JSON, invalid shape, sort by lastUsedAt
 *   - addRecentPlace: prepend, dedup by placeId, LRU cap at MAX_RECENT_PLACES
 *   - clearRecentPlaces: empties storage
 *
 * AsyncStorage is mocked at the module boundary via jest-expo's built-in
 * @react-native-async-storage/async-storage mock (auto-resolved by
 * jest.config.js transformIgnorePatterns).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getRecentPlaces,
  addRecentPlace,
  clearRecentPlaces,
  MAX_RECENT_PLACES,
  STORAGE_KEY,
  type RecentPlace,
} from '../recentPlaces';

// jest-expo provides an in-memory mock of AsyncStorage automatically.
// We cast it to jest.Mocked to get typed access to the mock methods.
const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Helper: seed storage with a raw JSON string.
function seedStorage(items: RecentPlace[]) {
  mockStorage.getItem.mockResolvedValueOnce(JSON.stringify(items));
}

function makePlace(
  overrides: Partial<RecentPlace> & { placeId: string },
): RecentPlace {
  return {
    mainText: `Place ${overrides.placeId}`,
    secondaryText: 'Some city',
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.setItem.mockResolvedValue(undefined);
  mockStorage.removeItem.mockResolvedValue(undefined);
});

// ─── getRecentPlaces ─────────────────────────────────────────────────────────

describe('getRecentPlaces', () => {
  it('returns empty array when storage is empty', async () => {
    mockStorage.getItem.mockResolvedValueOnce(null);
    const result = await getRecentPlaces();
    expect(result).toEqual([]);
  });

  it('returns empty array when storage contains invalid JSON', async () => {
    mockStorage.getItem.mockResolvedValueOnce('not-json');
    const result = await getRecentPlaces();
    expect(result).toEqual([]);
  });

  it('returns empty array when storage value is not an array', async () => {
    mockStorage.getItem.mockResolvedValueOnce(JSON.stringify({ foo: 'bar' }));
    const result = await getRecentPlaces();
    expect(result).toEqual([]);
  });

  it('filters out entries with missing required fields', async () => {
    const invalid = [
      { placeId: '', mainText: 'a', secondaryText: 'b', lastUsedAt: '2025-01-01T00:00:00Z' }, // empty placeId
      { mainText: 'a', secondaryText: 'b', lastUsedAt: '2025-01-01T00:00:00Z' }, // missing placeId
      { placeId: 123, mainText: 'a', secondaryText: 'b', lastUsedAt: '2025-01-01T00:00:00Z' }, // wrong type
    ];
    const valid = makePlace({ placeId: 'valid-1', lastUsedAt: '2025-06-01T00:00:00Z' });
    mockStorage.getItem.mockResolvedValueOnce(JSON.stringify([...invalid, valid]));
    const result = await getRecentPlaces();
    expect(result).toHaveLength(1);
    expect(result[0]!.placeId).toBe('valid-1');
  });

  it('sorts by lastUsedAt descending (most recent first)', async () => {
    const older = makePlace({ placeId: 'old', lastUsedAt: '2025-01-01T00:00:00Z' });
    const newer = makePlace({ placeId: 'new', lastUsedAt: '2025-06-01T00:00:00Z' });
    seedStorage([older, newer]);
    const result = await getRecentPlaces();
    expect(result[0]!.placeId).toBe('new');
    expect(result[1]!.placeId).toBe('old');
  });

  it('uses STORAGE_KEY as the storage key', async () => {
    mockStorage.getItem.mockResolvedValueOnce(null);
    await getRecentPlaces();
    expect(mockStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

// ─── addRecentPlace ───────────────────────────────────────────────────────────

describe('addRecentPlace', () => {
  it('prepends a new place to an empty list', async () => {
    mockStorage.getItem.mockResolvedValueOnce(null); // getRecentPlaces → []
    await addRecentPlace({ placeId: 'p1', mainText: 'Place 1', secondaryText: 'City' });

    expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = mockStorage.setItem.mock.calls[0]!;
    expect(key).toBe(STORAGE_KEY);
    const saved: RecentPlace[] = JSON.parse(value as string);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.placeId).toBe('p1');
    // lastUsedAt should be a recent ISO timestamp
    expect(typeof saved[0]!.lastUsedAt).toBe('string');
    expect(new Date(saved[0]!.lastUsedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('deduplicates: moves existing placeId to the front', async () => {
    const existing = [
      makePlace({ placeId: 'p1', lastUsedAt: '2025-05-01T00:00:00Z' }),
      makePlace({ placeId: 'p2', lastUsedAt: '2025-04-01T00:00:00Z' }),
    ];
    seedStorage(existing);

    await addRecentPlace({ placeId: 'p2', mainText: 'Updated p2', secondaryText: 'New city' });

    const [, value] = mockStorage.setItem.mock.calls[0]!;
    const saved: RecentPlace[] = JSON.parse(value as string);
    expect(saved).toHaveLength(2);
    expect(saved[0]!.placeId).toBe('p2');
    expect(saved[0]!.mainText).toBe('Updated p2');
    expect(saved[1]!.placeId).toBe('p1');
  });

  it('caps the list at MAX_RECENT_PLACES', async () => {
    const existing: RecentPlace[] = Array.from({ length: MAX_RECENT_PLACES }, (_, i) =>
      makePlace({ placeId: `p${i}`, lastUsedAt: new Date(2025, 0, i + 1).toISOString() }),
    );
    seedStorage(existing);

    await addRecentPlace({ placeId: 'new-place', mainText: 'New', secondaryText: '' });

    const [, value] = mockStorage.setItem.mock.calls[0]!;
    const saved: RecentPlace[] = JSON.parse(value as string);
    expect(saved).toHaveLength(MAX_RECENT_PLACES);
    expect(saved[0]!.placeId).toBe('new-place');
  });

  it('dedup + cap: adding an existing item from the tail does not grow the list', async () => {
    const existing: RecentPlace[] = Array.from({ length: MAX_RECENT_PLACES }, (_, i) =>
      makePlace({ placeId: `p${i}`, lastUsedAt: new Date(2025, 0, i + 1).toISOString() }),
    );
    seedStorage(existing);
    const lastPlaceId = `p${MAX_RECENT_PLACES - 1}`;

    await addRecentPlace({ placeId: lastPlaceId, mainText: 'Re-added', secondaryText: '' });

    const [, value] = mockStorage.setItem.mock.calls[0]!;
    const saved: RecentPlace[] = JSON.parse(value as string);
    expect(saved).toHaveLength(MAX_RECENT_PLACES);
    expect(saved[0]!.placeId).toBe(lastPlaceId);
  });
});

// ─── clearRecentPlaces ───────────────────────────────────────────────────────

describe('clearRecentPlaces', () => {
  it('calls AsyncStorage.removeItem with STORAGE_KEY', async () => {
    await clearRecentPlaces();
    expect(mockStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('does not throw even if removeItem rejects', async () => {
    mockStorage.removeItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(clearRecentPlaces()).resolves.not.toThrow();
  });
});
