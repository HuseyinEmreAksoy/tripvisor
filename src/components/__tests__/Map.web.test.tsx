/**
 * GoogleMap.web — conditional rendering test.
 *
 * v2 Phase N5.1: `Map.web.tsx` became a provider dispatcher (MapLibre default,
 * Google behind a runtime switch) and the Google implementation moved to
 * `GoogleMap.web.tsx`. These assertions cover the Google key-gating behavior,
 * so they now target GoogleMap.web directly — the dispatcher would also drag
 * in useAppConfig (needs a QueryClient) and maplibre-gl (ESM) for no extra
 * coverage. Mechanical repoint only; assertions unchanged.
 *
 * getWebKey() reads process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY on every render,
 * so we can import GoogleMap.web normally and control the key via process.env
 * before each test. No module isolation needed.
 *
 * @vis.gl/react-google-maps is mocked globally.
 * expo-constants is mocked so the Constants.expoConfig.extra branch always returns null.
 */
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { GoogleMap } from '../Map/GoogleMap.web';
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
      <GoogleMap {...props} />
    </ThemeProvider>,
  );
}

describe('GoogleMap.web — key-gated rendering', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
  });

  it('renders MapUnavailable (header labelled "map unavailable") when key is absent', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
    const { getByRole } = renderMap();
    expect(getByRole('header', { name: /map unavailable/i })).toBeTruthy();
  });

  it('renders MapUnavailable when key is empty string', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY = '';
    const { getByRole } = renderMap();
    expect(getByRole('header', { name: /map unavailable/i })).toBeTruthy();
  });

  it('MapUnavailable accessibility label mentions "map unavailable" when key absent', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
    const { getByRole } = renderMap();
    const summary = getByRole('header', { name: /map unavailable/i });
    expect(summary.props.accessibilityLabel).toMatch(/map unavailable/i);
  });

  it('does NOT render MapUnavailable when a non-empty key is set', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY = 'AIzaTestKey123';
    const { queryByRole } = renderMap();
    expect(queryByRole('header', { name: /map unavailable/i })).toBeNull();
  });
});
