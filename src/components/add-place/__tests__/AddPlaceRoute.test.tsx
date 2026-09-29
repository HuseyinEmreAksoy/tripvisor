/**
 * Add-place route (app/(app)/trip/[id]/add.tsx) — Places quota states
 * (2026-09-29 security follow-up, audit #2 per-user daily Places quota).
 *
 * A spent quota must read as "limit reached, try tomorrow": never "No
 * results", never the maps-setup banner, and never an endless spinner when
 * the details call (the lower cap) is the one that hits it.
 *
 * Lives outside app/ so Expo Router never picks the test up as a route.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import AddPlace from '../../../../app/(app)/trip/[id]/add';

const QUOTA_COPY = i18n.t('errors:places.quotaExceeded');

let mockAutocomplete: { data: unknown[]; error: Error | null; fetchStatus?: string } = {
  data: [],
  error: null,
};
let mockDetailsError: Error | null = null;
let mockDetailsFetchStatus = 'idle';
let mockRole = { canEditTrip: true, isLoading: false };
const mockRefetchAutocomplete = jest.fn();
const mockCreate = jest.fn();

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'trip-1' }) }));
jest.mock('@/hooks/useTripRole', () => ({ useTripRole: () => mockRole }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => 'phone' }));
jest.mock('@/api/offline', () => ({ useIsOnline: () => true }));
jest.mock('@/sync/mutations', () => ({ isTier1SyncActive: () => false }));
jest.mock('@/lib/recentPlaces', () => ({
  addRecentPlace: jest.fn(),
  clearRecentPlaces: jest.fn(),
  getRecentPlaces: () => Promise.resolve([]),
}));
jest.mock('@/api', () => {
  class PlacesError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    PlacesError,
    isPlacesQuotaExceeded: (e: unknown) => e instanceof PlacesError && e.code === 'quota_exceeded',
    useAutocompleteSession: () => ({ sessionToken: 'tok', rotate: jest.fn() }),
    useCreateTripPlace: () => ({ mutateAsync: mockCreate }),
    useMoveToDay: () => ({ mutateAsync: jest.fn() }),
    usePlacesAutocomplete: () => ({
      fetchStatus: 'idle',
      ...mockAutocomplete,
      isFetching: false,
      refetch: mockRefetchAutocomplete,
    }),
    usePlaceDetails: ({ placeId }: { placeId?: string }) => ({
      data: undefined,
      isLoading: false,
      error: placeId ? mockDetailsError : null,
      fetchStatus: placeId ? mockDetailsFetchStatus : 'idle',
      refetch: jest.fn(),
    }),
    useTrip: () => ({ data: { id: 'trip-1', start_date: '2026-10-01', end_date: '2026-10-03' } }),
    useTripPlaces: () => ({ data: [] }),
  };
});
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
// Safe-area wrappers aren't under test; keep the rest of the barrel real.
jest.mock('@/components', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/components'),
  Screen: ({ children }: { children: ReactNode }) => children,
  KeyboardAvoid: ({ children }: { children: ReactNode }) => children,
}));

const { PlacesError: MockPlacesError } = jest.requireMock<{
  PlacesError: new (code: string, message: string, status: number) => Error;
}>('@/api');

async function renderAndSearch() {
  jest.useFakeTimers();
  const utils = render(
    <ThemeProvider>
      <AddPlace />
    </ThemeProvider>,
  );
  fireEvent.changeText(utils.getByLabelText('Search places'), 'belem');
  // 250 ms search debounce + the recents effect.
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  jest.useRealTimers();
  return utils;
}

describe('AddPlace — Places quota', () => {
  beforeEach(() => {
    mockAutocomplete = { data: [], error: null };
    mockDetailsError = null;
  });

  it('autocomplete quota_exceeded shows the daily-limit notice instead of "No results"', async () => {
    mockAutocomplete = { data: [], error: new MockPlacesError('quota_exceeded', 'Daily limit', 429) };
    const { getByText, queryByText } = await renderAndSearch();
    expect(getByText(QUOTA_COPY)).toBeTruthy();
    expect(queryByText('No results')).toBeNull();
    expect(queryByText(/maps integration needs setup/i)).toBeNull();
  });

  it('with no error and no matches, "No results" still shows', async () => {
    const { getByText, queryByText } = await renderAndSearch();
    expect(getByText('No results')).toBeTruthy();
    expect(queryByText(QUOTA_COPY)).toBeNull();
  });

  it('details quota_exceeded offers a way back instead of an endless spinner', async () => {
    mockAutocomplete = {
      data: [{ placeId: 'g1', mainText: 'Belém Tower', secondaryText: 'Lisbon' }],
      error: null,
    };
    mockDetailsError = new MockPlacesError('quota_exceeded', 'Daily limit', 429);
    const utils = await renderAndSearch();
    fireEvent.press(utils.getByRole('button', { name: 'Choose Belém Tower' }));
    expect(utils.getByText(QUOTA_COPY)).toBeTruthy();
    const back = utils.getByRole('button', { name: 'Pick a different place' });
    fireEvent.press(back);
    expect(utils.getByRole('button', { name: 'Choose Belém Tower' })).toBeTruthy();
    expect(utils.queryByText(QUOTA_COPY)).toBeNull();
  });
});

describe('AddPlace — search / details failure states', () => {
  beforeEach(() => {
    mockAutocomplete = { data: [], error: null };
    mockDetailsError = null;
    mockDetailsFetchStatus = 'idle';
    mockRole = { canEditTrip: true, isLoading: false };
    mockRefetchAutocomplete.mockClear();
  });

  it('an upstream autocomplete error shows a retry, not "No results"', async () => {
    mockAutocomplete = { data: [], error: new MockPlacesError('upstream_timeout', 'Timeout', 504) };
    const { getByText, queryByText, getByRole } = await renderAndSearch();
    expect(getByText(i18n.t('errors:places.searchFailed'))).toBeTruthy();
    expect(queryByText('No results')).toBeNull();
    fireEvent.press(getByRole('button', { name: i18n.t('errors:places.retry') }));
    expect(mockRefetchAutocomplete).toHaveBeenCalled();
  });

  it('a search paused offline shows the offline notice, not "No results"', async () => {
    mockAutocomplete = { data: [], error: null, fetchStatus: 'paused' };
    const { getByText, queryByText } = await renderAndSearch();
    expect(getByText(i18n.t('errors:places.searchOffline'))).toBeTruthy();
    expect(queryByText('No results')).toBeNull();
  });

  it('a details query paused offline offers a way back instead of a spinner', async () => {
    mockAutocomplete = {
      data: [{ placeId: 'g1', mainText: 'Belém Tower', secondaryText: 'Lisbon' }],
      error: null,
    };
    mockDetailsFetchStatus = 'paused';
    const utils = await renderAndSearch();
    fireEvent.press(utils.getByRole('button', { name: 'Choose Belém Tower' }));
    expect(utils.getByText(i18n.t('errors:places.detailsOffline'))).toBeTruthy();
    fireEvent.press(utils.getByRole('button', { name: 'Pick a different place' }));
    expect(utils.getByRole('button', { name: 'Choose Belém Tower' })).toBeTruthy();
  });

  it('typing a new query leaves the details view', async () => {
    mockAutocomplete = {
      data: [{ placeId: 'g1', mainText: 'Belém Tower', secondaryText: 'Lisbon' }],
      error: null,
    };
    mockDetailsFetchStatus = 'paused';
    const utils = await renderAndSearch();
    fireEvent.press(utils.getByRole('button', { name: 'Choose Belém Tower' }));
    fireEvent.changeText(utils.getByLabelText('Search places'), 'belem t');
    expect(utils.queryByText(i18n.t('errors:places.detailsOffline'))).toBeNull();
    expect(utils.getByRole('button', { name: 'Choose Belém Tower' })).toBeTruthy();
  });

  it('a viewer sees a read-only notice and no search box', async () => {
    mockRole = { canEditTrip: false, isLoading: false };
    const { getByText, queryByLabelText } = render(
      <ThemeProvider>
        <AddPlace />
      </ThemeProvider>,
    );
    expect(getByText(i18n.t('errors:places.readOnly'))).toBeTruthy();
    expect(queryByLabelText('Search places')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
