/**
 * TripHeader (compact phone header) + TripMenuSheet (⋯ menu) — v2 M4 X2.2.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import type { Trip, TripLeg } from '@/api';
import { TripHeader, TripMenuSheet } from '../TripHeader';
import { IOS_MODAL_HANDOFF_MS } from '../modalHandoff';

// Keep the real API layer (supabase client, NetInfo listeners) out of a
// presentational test; TripHeader only needs the error class.
jest.mock('@/api', () => ({
  OptimizeError: class OptimizeError extends Error {
    code = 'unknown';
  },
}));
// Barrel components pull in the offline module; use NetInfo's official mock.
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const trip = {
  id: 'trip-1',
  title: 'Lisbon long weekend',
  start_date: '2026-10-01',
  end_date: '2026-10-04',
  daily_hours_budget: 8,
  transport_mode: 'walking',
} as unknown as Trip;

const legs = [
  { id: 'l1', day_index: 0, duration_seconds: 1800, distance_meters: 2000 },
  { id: 'l2', day_index: 1, duration_seconds: 1800, distance_meters: 3000 },
  // Matrix-cache row (day_index -1) must NOT count.
  { id: 'cache', day_index: -1, duration_seconds: 99999, distance_meters: 99999 },
] as unknown as TripLeg[];

describe('TripHeader — compact', () => {
  it('shows title, dates, route chips and a labelled menu button', () => {
    const onOpenMenu = jest.fn();
    const { getByText, getByRole, getByLabelText, queryByLabelText } = wrap(
      <TripHeader
        trip={trip}
        legs={legs}
        placesCount={5}
        optimizePending={false}
        optimizeError={null}
        onBack={jest.fn()}
        onPrint={jest.fn()}
        onOpenMenu={onOpenMenu}
        compact
      />,
    );
    expect(getByText('Lisbon long weekend')).toBeTruthy();
    expect(getByText('2026-10-01 → 2026-10-04')).toBeTruthy();
    expect(getByLabelText('5 places')).toBeTruthy();
    expect(getByLabelText('Total travel time 1h')).toBeTruthy();
    expect(getByLabelText('Total distance 5 kilometres')).toBeTruthy();
    // No full-size Print button on the compact header — it lives in the menu.
    expect(queryByLabelText('Print itinerary')).toBeNull();
    fireEvent.press(getByRole('button', { name: 'Trip menu' }));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('desktop header keeps Print next to the menu', () => {
    const onPrint = jest.fn();
    const { getByRole } = wrap(
      <TripHeader
        trip={trip}
        legs={[]}
        placesCount={0}
        optimizePending={false}
        optimizeError={null}
        onBack={jest.fn()}
        onPrint={onPrint}
        onOpenMenu={jest.fn()}
      />,
    );
    fireEvent.press(getByRole('button', { name: 'Print itinerary' }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(getByRole('button', { name: 'Trip menu' })).toBeTruthy();
  });
});

describe('TripMenuSheet', () => {
  function renderMenu(overrides: Partial<Parameters<typeof TripMenuSheet>[0]> = {}) {
    const props = {
      visible: true,
      onClose: jest.fn(),
      onOpenSettings: jest.fn(),
      onPrint: jest.fn(),
      onShare: jest.fn(),
      onOpenPeople: jest.fn(),
      ...overrides,
    };
    return { props, ...wrap(<TripMenuSheet {...props} />) };
  }

  // iOS runs the chosen action after the modal handoff delay (a second
  // modal presented while this one dismisses is dropped there).
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const flush = () =>
    act(() => {
      jest.advanceTimersByTime(IOS_MODAL_HANDOFF_MS);
    });

  it('closes and runs the chosen action', () => {
    const { props, getByRole } = renderMenu();
    fireEvent.press(getByRole('button', { name: 'Open trip settings' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    if (Platform.OS === 'ios') expect(props.onOpenSettings).not.toHaveBeenCalled();
    flush();
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    fireEvent.press(getByRole('button', { name: 'Print itinerary' }));
    flush();
    expect(props.onPrint).toHaveBeenCalledTimes(1);
    fireEvent.press(getByRole('button', { name: 'Share this trip' }));
    flush();
    expect(props.onShare).toHaveBeenCalledTimes(1);
  });

  it('hides Duplicate unless a handler is passed (owner-only)', () => {
    const { queryByRole } = renderMenu();
    expect(queryByRole('button', { name: 'Duplicate this trip' })).toBeNull();
    const onDuplicate = jest.fn();
    const second = renderMenu({ onDuplicate });
    fireEvent.press(second.getByRole('button', { name: 'Duplicate this trip' }));
    flush();
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });
});
