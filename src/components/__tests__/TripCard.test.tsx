import { describe, it, expect, jest } from '@jest/globals';
import { act, render, fireEvent } from '@testing-library/react-native';
import { formatDateRange, setLanguagePreference } from '@/i18n';
import { TripCard } from '../TripCard';
import { ThemeProvider } from '@/theme';
import type { Trip } from '@/api';
import { fallbackCoverIndex, TRIP_FALLBACK_COVERS } from '../tripCovers';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't-1',
    user_id: 'u-1',
    title: 'Lisbon 3 days',
    start_date: '2026-05-01',
    end_date: '2026-05-03',
    daily_hours_budget: 8,
    anchor_place_id: null,
    transport_mode: 'walking',
    timezone: 'Europe/Lisbon',
    archived_at: null,
    currency: 'USD',
    total_budget: null,
    route_render_mode: 'optimized',
    cover_photo_google_place_id: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function renderWithTheme(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('TripCard', () => {
  it('renders title and date range', () => {
    const trip = makeTrip();
    const { getByText } = renderWithTheme(<TripCard trip={trip} onPress={() => {}} />);
    expect(getByText('Lisbon 3 days')).toBeTruthy();
    // M5 Y2.4: dates go through the app-language formatter (was raw ISO).
    expect(getByText(formatDateRange('2026-05-01', '2026-05-03')!)).toBeTruthy();
    expect(getByText('8h/day · Walk')).toBeTruthy();
  });

  it('follows the app language (Turkish meta pill)', async () => {
    const { getByText } = renderWithTheme(<TripCard trip={makeTrip()} onPress={() => {}} />);
    await act(async () => {
      await setLanguagePreference('tr');
    });
    expect(getByText('Günde 8 sa · Yürüyüş')).toBeTruthy();
    await act(async () => {
      await setLanguagePreference('system');
    });
  });

  it('shows the trip status chip on the cover', () => {
    const { getByLabelText } = renderWithTheme(
      <TripCard trip={makeTrip({ start_date: '2000-01-01', end_date: '2000-01-02' })} onPress={() => {}} />,
    );
    expect(getByLabelText('Trip status: Relive')).toBeTruthy();
  });

  it('omits date range when both dates are null', () => {
    const trip = makeTrip({ start_date: null, end_date: null });
    const { queryByText, getByText } = renderWithTheme(<TripCard trip={trip} onPress={() => {}} />);
    expect(queryByText(/→/)).toBeNull();
    // Y2.4: an explicit placeholder keeps grid cards the same height.
    expect(getByText('No dates set')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const trip = makeTrip();
    const { getByRole } = renderWithTheme(<TripCard trip={trip} onPress={onPress} />);
    // Role is 'link' (not 'button') so that RN Web renders the card as <a>
    // rather than <button>, avoiding the nested-button DOM nesting violation
    // (Problem 3, Phase 20). The accessible name is unchanged.
    fireEvent.press(getByRole('link', { name: 'Open trip Lisbon 3 days' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a bundled destination cover (not a letter) when no Google cover is set', () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <TripCard trip={makeTrip()} onPress={() => {}} />,
    );
    expect(getByTestId('trip-card-fallback-cover', { includeHiddenElements: true })).toBeTruthy();
    expect(queryByText('L')).toBeNull();
  });
});

describe('fallbackCoverIndex', () => {
  it('is deterministic per trip id and in range', () => {
    const ids = ['t-1', 't-2', '9f1c2b7e-aaaa-bbbb-cccc-000000000001', ''];
    for (const id of ids) {
      const i = fallbackCoverIndex(id);
      expect(i).toBe(fallbackCoverIndex(id));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(TRIP_FALLBACK_COVERS.length);
    }
  });

  it('spreads different ids across covers', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, n) => fallbackCoverIndex(`trip-${n}`)));
    expect(seen.size).toBeGreaterThan(3);
  });
});
