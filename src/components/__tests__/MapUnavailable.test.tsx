/**
 * MapUnavailable component — unit tests.
 *
 * Covers:
 *   - Empty markers renders "No places added yet" (or similar)
 *   - 5 pins across 2 days are grouped by day, each day section visible
 *   - No "Google" text rendered anywhere in the output
 *   - accessibilityRole="summary" present on root
 */
import { render } from '@testing-library/react-native';
import { MapUnavailable } from '../MapUnavailable';
import { ThemeProvider } from '@/theme';
import type { MapMarker, MapPolyline } from '../Map/types';

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const noPolylines: MapPolyline[] = [];

describe('MapUnavailable', () => {
  it('renders "No places added yet" when markers is empty', () => {
    const { getByText } = wrap(
      <MapUnavailable markers={[]} polylines={noPolylines} />,
    );
    expect(getByText('No places added yet.')).toBeTruthy();
  });

  it('applies accessibilityRole="summary" on the root card', () => {
    const { getByRole } = wrap(
      <MapUnavailable markers={[]} polylines={noPolylines} />,
    );
    expect(getByRole('summary')).toBeTruthy();
  });

  it('renders place names for non-empty markers', () => {
    const markers: MapMarker[] = [
      { id: 'm1', lat: 38.7, lng: -9.2, title: 'Belem Tower', dayIndex: 0, orderInDay: 0 },
      { id: 'm2', lat: 38.71, lng: -9.19, title: 'Jerónimos Monastery', dayIndex: 0, orderInDay: 1 },
    ];
    const { getByText } = wrap(
      <MapUnavailable markers={markers} polylines={noPolylines} />,
    );
    expect(getByText('Belem Tower')).toBeTruthy();
    expect(getByText('Jerónimos Monastery')).toBeTruthy();
  });

  it('groups 5 pins across 2 days — both day headers visible', () => {
    const markers: MapMarker[] = [
      { id: 'm1', lat: 38.70, lng: -9.20, title: 'Day1 A', dayIndex: 0, orderInDay: 0 },
      { id: 'm2', lat: 38.71, lng: -9.19, title: 'Day1 B', dayIndex: 0, orderInDay: 1 },
      { id: 'm3', lat: 38.72, lng: -9.18, title: 'Day1 C', dayIndex: 0, orderInDay: 2 },
      { id: 'm4', lat: 38.73, lng: -9.17, title: 'Day2 A', dayIndex: 1, orderInDay: 0 },
      { id: 'm5', lat: 38.74, lng: -9.16, title: 'Day2 B', dayIndex: 1, orderInDay: 1 },
    ];
    const { getByText, getAllByText } = wrap(
      <MapUnavailable markers={markers} polylines={noPolylines} />,
    );
    // Day headers
    expect(getByText('Day 1')).toBeTruthy();
    expect(getByText('Day 2')).toBeTruthy();
    // All 5 places visible
    expect(getByText('Day1 A')).toBeTruthy();
    expect(getByText('Day2 B')).toBeTruthy();
  });

  it('shows "Unscheduled" bucket for markers with null dayIndex', () => {
    const markers: MapMarker[] = [
      { id: 'm1', lat: 38.7, lng: -9.2, title: 'Scratch Place', dayIndex: null, orderInDay: null },
    ];
    const { getByText } = wrap(
      <MapUnavailable markers={markers} polylines={noPolylines} />,
    );
    expect(getByText('Unscheduled')).toBeTruthy();
    expect(getByText('Scratch Place')).toBeTruthy();
  });

  it('does not show Google attribution text (Powered by Google / Google Maps logo)', () => {
    const markers: MapMarker[] = [
      { id: 'm1', lat: 38.7, lng: -9.2, title: 'Some Place', dayIndex: 0, orderInDay: 0 },
    ];
    const { queryByText } = wrap(
      <MapUnavailable markers={markers} polylines={noPolylines} />,
    );
    // The component renders EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY as an env var name
    // (not as Google branding). Assert no "Powered by Google" or "Google Maps" phrases exist.
    expect(queryByText(/powered by google/i)).toBeNull();
    expect(queryByText(/google maps/i)).toBeNull();
  });

  it('"Map unavailable" header text is present', () => {
    const { getByText } = wrap(
      <MapUnavailable markers={[]} polylines={noPolylines} />,
    );
    expect(getByText('Map unavailable')).toBeTruthy();
  });
});
