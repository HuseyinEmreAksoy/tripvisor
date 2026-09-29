/**
 * DiscoverScreen states (M5 Y3.4): interests pre-selected from preferences,
 * the "searching nearby…" skeleton, results with OSM attribution, the
 * degraded banner, quota error, pick-interests prompt and offline.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import type { PoiItem, RecommendationsResponse } from '@/api/recommendations';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@/hooks/useTripRole', () => ({ useTripRole: () => ({ role: 'owner', canEditTrip: true, isLoading: false }) }));
jest.mock('@/components/Map', () => ({ Map: () => null }));
jest.mock('../RecDetailSheet', () => ({ RecDetailSheet: () => null }));
jest.mock('../useAdoptPendingInterests', () => ({ useAdoptPendingInterests: () => undefined }));

let mockOnline = true;
jest.mock('@/api', () => ({
  useIsOnline: () => mockOnline,
  useTrip: () => ({ data: { id: 'trip-1', title: 'Istanbul', start_date: '2026-10-01', end_date: '2026-10-03' } }),
  useTripPlaces: () => ({ data: [] }),
}));

let mockPrefs: { interests: string[] } | undefined = { interests: ['history'] };
jest.mock('@/api/preferences', () => ({
  useUserPreferences: () => ({ data: mockPrefs, isError: false, fetchStatus: 'idle' }),
  useUpdateUserPreferences: () => ({ mutate: jest.fn(), isPending: false }),
}));

type QueryState = { data?: RecommendationsResponse; isLoading: boolean; error: unknown; refetch: () => void };
let mockQuery: QueryState;
const mockUseRecs = jest.fn();
jest.mock('@/api/recommendations', () => {
  const actual = jest.requireActual('@/api/recommendations') as object;
  return {
    ...actual,
    useRecommendationCenter: () => ({ center: { lat: 41, lng: 29 }, source: 'trip', placeCount: 2, loading: false }),
    useRecommendations: (...args: unknown[]) => {
      mockUseRecs(...args);
      return mockQuery;
    },
  };
});

// eslint-disable-next-line import/first
import { DiscoverScreen } from '../DiscoverScreen';

const t = i18n.t.bind(i18n);
const item: PoiItem = {
  id: 'osm:node/1',
  source: 'osm',
  osm: { type: 'node', id: 1 },
  name: 'Hagia Sophia',
  originalName: null,
  lat: 41.008,
  lng: 28.98,
  distanceM: 400,
  interests: ['history'],
  kind: 'historic=mosque',
  tags: {},
  wikidata: null,
  wiki: null,
  score: 1,
};
const response = (over: Partial<RecommendationsResponse> = {}): RecommendationsResponse => ({
  items: [item],
  center: { lat: 41, lng: 29 },
  radiusM: 1500,
  interests: ['history'],
  lang: 'en',
  attribution: { osm: '© OpenStreetMap contributors', osmUrl: 'https://www.openstreetmap.org/copyright', wikipedia: null, wikipediaUrl: null },
  degraded: null,
  meta: { contractVersion: 1, cache: 'hit', tiles: 1, upstream: 'overpass', instance: null },
  ...over,
});

const renderScreen = () =>
  render(
    <ThemeProvider>
      <DiscoverScreen tripId="trip-1" />
    </ThemeProvider>,
  );

describe('DiscoverScreen', () => {
  beforeEach(() => {
    mockOnline = true;
    mockPrefs = { interests: ['history'] };
    mockQuery = { data: undefined, isLoading: true, error: null, refetch: jest.fn() };
    mockUseRecs.mockClear();
  });

  it('pre-selects saved interests and shows the searching skeleton', async () => {
    const { getByRole, getByText } = renderScreen();
    await waitFor(() =>
      expect(getByRole('checkbox', { name: t('discover:interests.history') }).props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true }),
      ),
    );
    expect(getByText(t('discover:searching'))).toBeTruthy();
    const last = mockUseRecs.mock.calls.at(-1)![0] as { interests: string[]; tripId: string };
    expect(last).toEqual(expect.objectContaining({ tripId: 'trip-1', interests: ['history'] }));
  });

  it('renders results with the OSM attribution and a degraded banner', async () => {
    mockQuery = { data: response({ degraded: 'overpass_unavailable' }), isLoading: false, error: null, refetch: jest.fn() };
    const { findByText, getByText, getByTestId } = renderScreen();
    expect(await findByText('Hagia Sophia')).toBeTruthy();
    expect(getByText(t('discover:results', { count: 1 }))).toBeTruthy();
    expect(getByTestId('discover-attribution')).toBeTruthy();
    expect(getByText(t('discover:degraded.overpass_unavailable'))).toBeTruthy();
  });

  it('shows the empty-state art when nothing matched', async () => {
    mockQuery = { data: response({ items: [] }), isLoading: false, error: null, refetch: jest.fn() };
    const { findByText } = renderScreen();
    expect(await findByText(t('discover:empty.title'))).toBeTruthy();
  });

  it('explains the daily quota without a retry button', async () => {
    const { RecommendationsError } = jest.requireActual('@/api/recommendations') as typeof import('@/api/recommendations');
    mockQuery = { data: undefined, isLoading: false, error: new RecommendationsError('quota_exceeded', 'x', 429), refetch: jest.fn() };
    const { findByText, queryByRole } = renderScreen();
    expect(await findByText(t('discover:error.quota_exceeded'))).toBeTruthy();
    expect(queryByRole('button', { name: t('discover:error.retry') })).toBeNull();
  });

  it('offers a retry for a transient error', async () => {
    const refetch = jest.fn();
    mockQuery = { data: undefined, isLoading: false, error: new Error('network'), refetch };
    const { findByRole } = renderScreen();
    fireEvent.press(await findByRole('button', { name: t('discover:error.retry') }));
    expect(refetch).toHaveBeenCalled();
  });

  it('asks for interests when none are saved, and searches after picking one', async () => {
    jest.useFakeTimers();
    mockPrefs = { interests: [] };
    const { findByText, getByRole } = renderScreen();
    expect(await findByText(t('discover:pickInterests.title'))).toBeTruthy();
    fireEvent.press(getByRole('checkbox', { name: t('discover:interests.food') }));
    act(() => {
      jest.advanceTimersByTime(700);
    });
    const last = mockUseRecs.mock.calls.at(-1)![0] as { interests: string[] };
    expect(last.interests).toEqual(['food']);
    jest.useRealTimers();
  });

  it('shows the offline state instead of searching', async () => {
    mockOnline = false;
    mockQuery = { data: undefined, isLoading: false, error: null, refetch: jest.fn() };
    const { findByText } = renderScreen();
    expect(await findByText(t('discover:error.offline'))).toBeTruthy();
    const opts = mockUseRecs.mock.calls.at(-1)![1] as { enabled: boolean };
    expect(opts.enabled).toBe(false);
  });
});
