/**
 * MapTab — v2 M4 X2.2 review leftovers:
 *   1. A persisted "From my location" intent fetches a fix on mount ONLY
 *      when the permission is already granted (never an unprompted OS ask).
 *   2. Marker taps report both the Google id and the trip_places row id so
 *      place detail opens with trip context (reactions).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import type { Trip, TripPlace } from '@/api';
import { MapTab } from '../MapTab';

const mockRequest = jest.fn(async () => undefined);
let mockPermission: 'granted' | 'prompt' = 'prompt';

jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('@/api', () => ({
  useUpdateRouteRenderMode: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useCurrentLocation', () => ({
  useCurrentLocation: () => ({ location: null, status: 'idle', request: mockRequest }),
}));
jest.mock('@/hooks/useTripUseMyLocation', () => ({
  useTripUseMyLocation: () => ({ enabled: true, setEnabled: jest.fn() }),
}));
jest.mock('../locationPermission', () => ({
  getLocationPermissionState: async () => mockPermission,
}));
jest.mock('@/components/Map', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require('react-native');
  return {
    decodePolyline: () => [],
    dayColor: () => '#000000',
    Map: ({
      markers,
      onMarkerPress,
    }: {
      markers: Array<{ id: string; title: string }>;
      onMarkerPress: (id: string) => void;
    }) =>
      markers.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          accessibilityLabel={`marker ${m.title}`}
          onPress={() => onMarkerPress(m.id)}
        >
          <Text>{m.title}</Text>
        </Pressable>
      )),
  };
});

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const trip = { id: 'trip-1', route_render_mode: 'optimized', transport_mode: 'walking' } as unknown as Trip;
const places = [
  {
    id: 'row-1',
    google_place_id: 'gid-1',
    user_title: 'Belém Tower',
    lat: 38.69,
    lng: -9.21,
    day_index: 0,
    order_in_day: 0,
  },
] as unknown as TripPlace[];

describe('MapTab', () => {
  beforeEach(() => {
    mockRequest.mockClear();
  });

  it('does not request location on mount when permission is not yet granted', async () => {
    mockPermission = 'prompt';
    wrap(<MapTab tripId="trip-1" places={places} legs={[]} trip={trip} canEdit onMarker={jest.fn()} />);
    // Let the permission promise settle.
    await waitFor(() => Promise.resolve());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('fetches a fix on mount when permission is already granted', async () => {
    mockPermission = 'granted';
    wrap(<MapTab tripId="trip-1" places={places} legs={[]} trip={trip} canEdit onMarker={jest.fn()} />);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
  });

  it('marker taps pass the trip_places row id for trip context', () => {
    const onMarker = jest.fn();
    const { getByRole } = wrap(
      <MapTab tripId="trip-1" places={places} legs={[]} trip={trip} canEdit onMarker={onMarker} />,
    );
    fireEvent.press(getByRole('button', { name: 'marker Belém Tower' }));
    expect(onMarker).toHaveBeenCalledWith('gid-1', 'row-1');
  });
});
