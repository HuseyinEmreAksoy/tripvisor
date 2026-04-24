/**
 * Map.web — conditional rendering test.
 *
 * getWebKey() reads process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY on every render,
 * so we can import Map.web normally and control the key via process.env before
 * each test. No module isolation needed.
 *
 * @vis.gl/react-google-maps is mocked globally.
 * expo-constants is mocked so the Constants.expoConfig.extra branch always returns null.
 */
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { Map } from '../Map/Map.web';
import type { MapViewProps } from '../Map/types';

// Prevent real Google Maps loading
jest.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Map: () => null,
  AdvancedMarker: () => null,
  Pin: () => null,
  useMap: () => null,
}));

// Ensure Constants.expoConfig.extra is empty so the env var is the only signal
jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } },
  __esModule: true,
}));

const DEFAULT_PROPS: MapViewProps = { markers: [], polylines: [] };

function renderMap(props: MapViewProps = DEFAULT_PROPS) {
  return render(
    <ThemeProvider>
      <Map {...props} />
    </ThemeProvider>,
  );
}

describe('Map.web — key-gated rendering', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
  });

  it('renders MapUnavailable (accessibilityRole="summary") when key is absent', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
    const { getByRole } = renderMap();
    expect(getByRole('summary')).toBeTruthy();
  });

  it('renders MapUnavailable when key is empty string', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY = '';
    const { getByRole } = renderMap();
    expect(getByRole('summary')).toBeTruthy();
  });

  it('MapUnavailable accessibility label mentions "map unavailable" when key absent', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
    const { getByRole } = renderMap();
    const summary = getByRole('summary');
    expect(summary.props.accessibilityLabel).toMatch(/map unavailable/i);
  });

  it('does NOT render MapUnavailable when a non-empty key is set', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY = 'AIzaTestKey123';
    const { queryByRole } = renderMap();
    expect(queryByRole('summary')).toBeNull();
  });
});
