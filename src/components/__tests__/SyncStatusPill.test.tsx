import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';

const mockStatus: { current: Record<string, unknown> } = { current: {} };

jest.mock('@/sync/telemetry', () => ({
  useSyncStatus: () => mockStatus.current,
}));
jest.mock('@/sync/hydrate', () => ({ resyncTier1: jest.fn() }));
jest.mock('@/api/offline', () => ({ useIsOnline: () => true }));
jest.mock('@/api', () => ({
  tripsKeys: { all: ['trips'] },
  tripPlacesKeys: { all: ['trip-places'] },
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// eslint-disable-next-line import/first
import { SyncStatusPill, relativeAge, isOtherTabLockReason } from '../SyncStatusPill';

function baseStatus(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    degraded: false,
    degradedReason: null,
    tosViolations: 0,
    lastSyncAgeMs: 0,
    entities: {},
    ...overrides,
  };
}

const renderPill = () =>
  render(
    <ThemeProvider>
      <SyncStatusPill />
    </ThemeProvider>,
  );

describe('relativeAge', () => {
  it('phrases ages naturally', () => {
    expect(relativeAge(10_000)).toBe('just now');
    expect(relativeAge(5 * 60_000)).toBe('5 min ago');
    expect(relativeAge(2 * 3_600_000)).toBe('2 h ago');
    expect(relativeAge(24 * 3_600_000)).toBe('1 day ago');
    expect(relativeAge(3 * 24 * 3_600_000)).toBe('3 days ago');
  });
});

describe('isOtherTabLockReason', () => {
  it('recognises the OPFS access-handle lock', () => {
    expect(
      isOtherTabLockReason(
        "expo-sqlite web (wa-sqlite/OPFS) init failed: NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle",
      ),
    ).toBe(true);
    expect(isOtherTabLockReason('SharedArrayBuffer unavailable')).toBe(false);
    expect(isOtherTabLockReason(null)).toBe(false);
  });
});

describe('SyncStatusPill', () => {
  beforeEach(() => {
    mockStatus.current = baseStatus();
  });

  it('says "Last synced just now" (not "now ago") in the a11y label', () => {
    const { getByRole } = renderPill();
    expect(getByRole('button', { name: 'Synced. Last synced just now. Tap for details.' })).toBeTruthy();
  });

  it('uses minutes phrasing for older syncs', () => {
    mockStatus.current = baseStatus({ lastSyncAgeMs: 5 * 60_000 });
    const { getByRole } = renderPill();
    expect(getByRole('button', { name: 'Synced. Last synced 5 min ago. Tap for details.' })).toBeTruthy();
  });

  it('explains the second-tab lock instead of generic local-only copy', () => {
    mockStatus.current = baseStatus({
      degraded: true,
      degradedReason: 'init failed: NoModificationAllowedError: another open Access Handle',
    });
    const { getByText, getByRole, queryByText } = renderPill();
    expect(getByText('Open in another tab')).toBeTruthy();
    expect(queryByText('Local-only mode')).toBeNull();
    expect(
      getByRole('button', {
        name: /Tripvisor is open in another tab — changes here sync while online but aren't saved on this device until you close the other tab\./,
      }),
    ).toBeTruthy();
  });

  it('keeps generic local-only copy for other degrade reasons', () => {
    mockStatus.current = baseStatus({ degraded: true, degradedReason: 'SharedArrayBuffer unavailable' });
    const { getByText } = renderPill();
    expect(getByText('Local-only mode')).toBeTruthy();
  });
});
