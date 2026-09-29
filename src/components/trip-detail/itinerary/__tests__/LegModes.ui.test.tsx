/**
 * M5 Y3.3 per-leg modes UI: the leg chip, the leg-mode sheet, the day
 * default control and the write hook (C1: only arrival_* / trip_days mode).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { formatDuration, i18n } from '@/i18n';
import type { TripLeg } from '@/api/types';

const mockUpdatePlace = jest.fn(async (_input: unknown) => ({}));
const mockUpdateDay = jest.fn(async (_input: unknown) => ({}));
const mockOptimize = jest.fn((_input: unknown, _opts?: unknown) => {});

jest.mock('@/api', () => ({
  useUpdateTripPlace: () => ({ mutateAsync: mockUpdatePlace, isPending: false }),
  useUpdateTripDay: () => ({ mutateAsync: mockUpdateDay, isPending: false }),
  useOptimizeTrip: () => ({ mutate: mockOptimize, isPending: false }),
}));
jest.mock('@/lib/directions', () => ({ openDirections: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import { TravelConnector } from '../TravelConnector';
// eslint-disable-next-line import/first
import { LegModeSheet } from '../LegModeSheet';
// eslint-disable-next-line import/first
import { DayModeControl, KeptOrderNote } from '../DayModeControl';
// eslint-disable-next-line import/first
import { useLegModeActions } from '../useLegModeActions';
// eslint-disable-next-line import/first
import { buildLegChipModel } from '../legModes';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const LEG = {
  id: 'l1',
  day_index: 0,
  from_place_id: 'a',
  to_place_id: 'b',
  transport_mode: 'transit',
  duration_seconds: 1200,
  distance_meters: 8000,
  source: 'estimate',
  polyline: null,
  transit_steps: null,
} as unknown as TripLeg;
const FROM = { lat: 1, lng: 1, placeId: 'ga', label: 'Louvre' };
const TO = { lat: 2, lng: 2, placeId: 'gb', label: 'Orsay' };

beforeEach(() => {
  mockUpdatePlace.mockClear();
  mockUpdateDay.mockClear();
  mockOptimize.mockClear();
});

describe('TravelConnector leg chip', () => {
  const model = buildLegChipModel({ leg: LEG, toPlace: {}, dayMode: 'transit', tripMode: 'driving' });

  it('shows ≈ for an estimated leg and opens the sheet for editors', () => {
    const onEditMode = jest.fn();
    const { getByText, getByRole } = wrap(
      <TravelConnector legAfter={LEG} model={model} from={FROM} to={TO} onEditMode={onEditMode} />,
    );
    expect(getByText(`≈ ${formatDuration(20)}`)).toBeTruthy();
    fireEvent.press(getByRole('button', { name: /Transit to the next stop, about .* \(estimated\)/ }));
    expect(onEditMode).toHaveBeenCalledTimes(1);
  });

  it('is read-only for viewers', () => {
    const { queryByRole, getByLabelText } = wrap(
      <TravelConnector legAfter={LEG} model={model} from={FROM} to={TO} />,
    );
    expect(queryByRole('button')).toBeNull();
    expect(getByLabelText(/Transit to the next stop/)).toBeTruthy();
  });
});

describe('LegModeSheet', () => {
  function renderSheet(extra: Partial<React.ComponentProps<typeof LegModeSheet>> = {}) {
    const onSave = jest.fn(async (_m: unknown, _n: unknown) => true);
    const onClose = jest.fn();
    const utils = wrap(
      <LegModeSheet
        visible
        onClose={onClose}
        fromTitle="Louvre"
        toTitle="Nice"
        currentMode={null}
        currentMinutes={null}
        inheritedMode="driving"
        scheduled
        onSave={onSave}
        {...extra}
      />,
    );
    return { ...utils, onSave, onClose };
  }

  it('saves a flight with the typed minutes', async () => {
    const { getByRole, getByLabelText, onSave, onClose } = renderSheet();
    fireEvent.press(getByRole('radio', { name: 'Flight' }));
    fireEvent.changeText(getByLabelText('Travel time in minutes (optional)'), '120');
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Save' }));
    });
    expect(onSave).toHaveBeenCalledWith('flight', 120);
    expect(onClose).toHaveBeenCalled();
  });

  it('"same as the day" clears the override (mode and minutes together)', async () => {
    const { getByRole, onSave } = renderSheet({ currentMode: 'ferry', currentMinutes: 45 });
    fireEvent.press(getByRole('radio', { name: 'Same as the day (Drive)' }));
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Save' }));
    });
    expect(onSave).toHaveBeenCalledWith(null, null);
  });

  it('rejects out-of-range minutes without saving', async () => {
    const { getByRole, getByLabelText, getByText, onSave } = renderSheet({ currentMode: 'transit' });
    fireEvent.changeText(getByLabelText('Travel time in minutes (optional)'), '2000');
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Save' }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(getByText('Enter a whole number from 1 to 1440.')).toBeTruthy();
  });

  it('hides flight and ferry between unscheduled stops', () => {
    const { queryByRole } = renderSheet({ scheduled: false });
    expect(queryByRole('radio', { name: 'Flight' })).toBeNull();
    expect(queryByRole('radio', { name: 'Ferry' })).toBeNull();
  });

  it('renders in Turkish', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    try {
      const { getByRole } = renderSheet();
      expect(getByRole('radio', { name: 'Vapur' })).toBeTruthy();
      expect(getByRole('button', { name: 'Kaydet' })).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });
});

describe('DayModeControl', () => {
  it('shows the inherited mode read-only for viewers', () => {
    const { getByLabelText, queryByRole } = wrap(
      <DayModeControl dayNumber={2} dayMode={null} tripMode="walking" canEdit={false} online onChange={async () => true} />,
    );
    expect(getByLabelText('Day 2 travels by Walk')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('lets editors pick a day default; offline the options are disabled', async () => {
    const onChange = jest.fn(async (_m: unknown) => true);
    const { getByRole, rerender } = wrap(
      <DayModeControl dayNumber={2} dayMode={null} tripMode="driving" canEdit online onChange={onChange} />,
    );
    fireEvent.press(getByRole('button', { name: 'Day 2 travels by Drive' }));
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Transit' }));
    });
    expect(onChange).toHaveBeenCalledWith('transit');

    onChange.mockClear();
    rerender(
      <ThemeProvider>
        <DayModeControl dayNumber={2} dayMode={null} tripMode="driving" canEdit online={false} onChange={onChange} />
      </ThemeProvider>,
    );
    fireEvent.press(getByRole('button', { name: 'Day 2 travels by Drive' }));
    fireEvent.press(getByRole('radio', { name: 'Walk' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('kept-order note names the flight', () => {
    const { getByText } = wrap(<KeptOrderNote reason="flight" />);
    expect(getByText('Kept your order because this day has a flight.')).toBeTruthy();
  });
});

describe('useLegModeActions (C1 write path)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes only arrival_mode + arrival_minutes, then recomputes in the trip render mode', async () => {
    const { result } = renderHook(() => useLegModeActions({ id: 'trip-1', route_render_mode: 'manual' }, true));
    await act(async () => {
      await result.current.setLegMode('place-9', 'flight', 120);
    });
    expect(mockUpdatePlace).toHaveBeenCalledWith({
      id: 'place-9',
      trip_id: 'trip-1',
      arrival_mode: 'flight',
      arrival_minutes: 120,
    });
    expect(mockOptimize).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockOptimize).toHaveBeenCalledWith({ tripId: 'trip-1', mode: 'manual' }, expect.anything());
  });

  it('clears both columns together and drops minutes for modes without them', async () => {
    const { result } = renderHook(() => useLegModeActions({ id: 'trip-1', route_render_mode: 'optimized' }, true));
    await act(async () => {
      await result.current.setLegMode('p', null, 50);
      await result.current.setLegMode('p', 'walking', 50);
    });
    expect(mockUpdatePlace.mock.calls[0]?.[0]).toMatchObject({ arrival_mode: null, arrival_minutes: null });
    expect(mockUpdatePlace.mock.calls[1]?.[0]).toMatchObject({ arrival_mode: 'walking', arrival_minutes: null });
  });

  it('day default: online-only trip_days write', async () => {
    const offline = renderHook(() => useLegModeActions({ id: 'trip-1', route_render_mode: 'optimized' }, false));
    let ok = true;
    await act(async () => {
      ok = await offline.result.current.setDayMode(1, 'transit');
    });
    expect(ok).toBe(false);
    expect(mockUpdateDay).not.toHaveBeenCalled();
    expect(offline.result.current.errorKey).toBe('errors.dayOffline');

    const online = renderHook(() => useLegModeActions({ id: 'trip-1', route_render_mode: 'optimized' }, true));
    await act(async () => {
      await online.result.current.setDayMode(1, 'transit');
    });
    expect(mockUpdateDay).toHaveBeenCalledWith({ trip_id: 'trip-1', day_index: 1, transport_mode: 'transit' });
  });
});
