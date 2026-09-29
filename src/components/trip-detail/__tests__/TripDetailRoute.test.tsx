/**
 * Trip detail route shell (app/(app)/trip/[id]/index.tsx) — role gates added
 * in the 2026-09-29 security follow-up (commit 827bc5b):
 *   - auto-optimize runs for the owner / editors only (optimize-trip returns
 *     403 `not_editor` to viewers, audit #6);
 *   - the ⋯ → Share sheet offers the public link to the OWNER only
 *     (share-trip returns 403 `not_owner` to editors, audit #5);
 *   - a typed delete failure reaches the settings sheet with its own copy.
 *
 * Lives outside app/ so Expo Router never picks the test up as a route. Every
 * data hook and child surface is mocked at the module boundary; the stubs
 * expose just enough (labelled text / buttons) to drive the shell.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '@/theme';
import TripDetail from '../../../../app/(app)/trip/[id]/index';

const mockOptimize = jest.fn();
const mockDeleteMutateAsync = jest.fn<(id: string) => Promise<string>>();
let mockRole: { role: 'owner' | 'editor' | 'viewer' | null; canEditTrip: boolean } = {
  role: 'owner',
  canEditTrip: true,
};

const mockTrip = {
  id: 'trip-1',
  title: 'Lisbon long weekend',
  start_date: '2026-10-01',
  end_date: '2026-10-03',
  daily_hours_budget: 8,
  transport_mode: 'walking',
  route_render_mode: 'optimized',
  currency: 'EUR',
  cover_photo_google_place_id: null,
};
const mockPlaces = [
  { id: 'p1', google_place_id: 'g1', visit_duration_minutes: 60, day_index: 0, order_in_day: 0 },
  { id: 'p2', google_place_id: 'g2', visit_duration_minutes: 90, day_index: 0, order_in_day: 1 },
];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'trip-1', tab: 'trip' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), setParams: jest.fn() }),
}));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => 'phone' }));
jest.mock('@/lib/haptics', () => ({
  haptics: { select: jest.fn(), error: jest.fn(), success: jest.fn() },
}));
jest.mock('@/sync/mutations', () => ({ isTier1SyncActive: () => false }));
jest.mock('@/hooks/useTripRole', () => ({ useTripRole: () => mockRole }));
jest.mock('@/api/trip-accommodations', () => ({ useTripAccommodations: () => ({ data: [] }) }));
jest.mock('@/api', () => ({
  orderPlacesForDisplay: (places: unknown[]) => places,
  useTrip: () => ({ data: mockTrip, isLoading: false, error: null, refetch: jest.fn() }),
  useTripPlaces: () => ({ data: mockPlaces, isLoading: false }),
  useTripLegs: () => ({ data: [] }),
  useOptimizeTrip: () => ({ mutate: mockOptimize, isPending: false, error: null }),
  useDeleteTrip: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
  useDuplicateTrip: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// ── Presentational stubs ────────────────────────────────────────────────────
function mockText(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return <Text>{text}</Text>;
}
function mockButton(label: string, onPress: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require('react-native');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Text>{label}</Text>
    </Pressable>
  );
}
jest.mock('@/components', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
  Heading: ({ children }: { children: ReactNode }) => mockText(String(children)),
  TabBar: () => null,
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => mockButton(label, onPress),
  BottomSheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? children : null,
}));
jest.mock('@/components/ShareLinkCard', () => ({ ShareLinkCard: () => mockText('stub:ShareLinkCard') }));
// Header → a "⋯" button; the menu → Share / Settings rows.
jest.mock('@/components/trip-detail/TripHeader', () => ({
  TripHeader: ({ onOpenMenu }: { onOpenMenu: () => void }) => mockButton('header:menu', onOpenMenu),
  TripMenuSheet: ({ visible, onShare, onOpenSettings }: {
    visible: boolean;
    onShare: () => void;
    onOpenSettings: () => void;
  }) =>
    visible ? (
      <>
        {mockButton('menu:share', onShare)}
        {mockButton('menu:settings', onOpenSettings)}
      </>
    ) : null,
}));
jest.mock('@/components/trip-detail/MapTab', () => ({ MapTab: () => null }));
jest.mock('@/components/trip-detail/ItineraryTab', () => ({ ItineraryTab: () => null }));
jest.mock('@/components/trip-detail/TripHubTab', () => ({ TripHubTab: () => null }));
jest.mock('@/components/trip-detail/TripSettingsSheet', () => ({
  deleteTripErrorMessage: (err: unknown) =>
    `mapped:${(err as { code?: string }).code ?? 'unknown'}`,
  TripSettingsSheet: ({ visible, onDelete, deleteError }: {
    visible: boolean;
    onDelete: () => void;
    deleteError: string | null;
  }) =>
    visible ? (
      <>
        {mockButton('settings:delete', onDelete)}
        {deleteError ? mockText(deleteError) : null}
      </>
    ) : null,
}));
jest.mock('@/components/trip-detail/QuickAddSheet', () => ({
  QuickAddFab: () => null,
  QuickAddSheet: () => null,
}));
jest.mock('@/components/trip-detail/ActionErrorBanner', () => ({ ActionErrorBanner: () => null }));
jest.mock('@/components/trip-detail/TripDetailSkeleton', () => ({
  TripDetailSkeleton: () => null,
  PlanSkeleton: () => null,
}));

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockOptimize.mockReset();
  mockDeleteMutateAsync.mockReset();
  mockRole = { role: 'owner', canEditTrip: true };
});
afterEach(() => {
  jest.useRealTimers();
});

const flushDebounce = () =>
  act(() => {
    jest.advanceTimersByTime(600);
  });

describe('TripDetail — auto-optimize role gate', () => {
  it('auto-optimizes for an editor after the debounce', () => {
    mockRole = { role: 'editor', canEditTrip: true };
    wrap(<TripDetail />);
    flushDebounce();
    expect(mockOptimize).toHaveBeenCalledTimes(1);
    expect(mockOptimize).toHaveBeenCalledWith({ tripId: 'trip-1', mode: 'optimized' });
  });

  it('never auto-optimizes for a viewer (server would 403 not_editor)', () => {
    mockRole = { role: 'viewer', canEditTrip: false };
    wrap(<TripDetail />);
    flushDebounce();
    expect(mockOptimize).not.toHaveBeenCalled();
  });

  it('waits for the role to resolve, then runs once', () => {
    mockRole = { role: null, canEditTrip: false };
    const utils = wrap(<TripDetail />);
    flushDebounce();
    expect(mockOptimize).not.toHaveBeenCalled();
    mockRole = { role: 'owner', canEditTrip: true };
    utils.rerender(
      <ThemeProvider>
        <TripDetail />
      </ThemeProvider>,
    );
    flushDebounce();
    expect(mockOptimize).toHaveBeenCalledTimes(1);
  });
});

describe('TripDetail — share sheet owner gate', () => {
  function openShare() {
    const utils = wrap(<TripDetail />);
    fireEvent.press(utils.getByRole('button', { name: 'header:menu' }));
    fireEvent.press(utils.getByRole('button', { name: 'menu:share' }));
    return utils;
  }

  it('the owner gets the share-link card', () => {
    const { getByText, queryByText } = openShare();
    expect(getByText('stub:ShareLinkCard')).toBeTruthy();
    expect(queryByText(/only the trip owner/i)).toBeNull();
  });

  it.each([
    ['an editor', { role: 'editor' as const, canEditTrip: true }],
    ['a viewer', { role: 'viewer' as const, canEditTrip: false }],
  ])('%s is told to ask the owner', (_who, role) => {
    mockRole = role;
    const { getByText, queryByText } = openShare();
    expect(
      getByText('Only the trip owner can create a share link. Ask them to send you one.'),
    ).toBeTruthy();
    expect(queryByText('stub:ShareLinkCard')).toBeNull();
  });
});

describe('TripDetail — delete failure copy', () => {
  it('passes the typed delete error through deleteTripErrorMessage', async () => {
    mockDeleteMutateAsync.mockRejectedValue(
      Object.assign(new Error('files'), { code: 'storage_cleanup_failed' }),
    );
    const { getByRole, findByText } = wrap(<TripDetail />);
    fireEvent.press(getByRole('button', { name: 'header:menu' }));
    fireEvent.press(getByRole('button', { name: 'menu:settings' }));
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'settings:delete' }));
    });
    expect(await findByText('mapped:storage_cleanup_failed')).toBeTruthy();
  });
});
