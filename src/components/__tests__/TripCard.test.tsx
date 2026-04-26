import { render, fireEvent } from '@testing-library/react-native';
import { TripCard } from '../TripCard';
import { ThemeProvider } from '@/theme';
import type { Trip } from '@/api';

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
    cost_per_km: 0.2,
    total_budget: null,
    route_render_mode: 'optimized',
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
    expect(getByText('2026-05-01 → 2026-05-03')).toBeTruthy();
    expect(getByText('8h / day · walking')).toBeTruthy();
  });

  it('omits date range when both dates are null', () => {
    const trip = makeTrip({ start_date: null, end_date: null });
    const { queryByText } = renderWithTheme(<TripCard trip={trip} onPress={() => {}} />);
    expect(queryByText(/→/)).toBeNull();
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
});
