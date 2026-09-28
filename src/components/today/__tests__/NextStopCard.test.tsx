import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { NextStopCard, type NextStopCardProps } from '../NextStopCard';

const place = { id: 'p1', title: 'Colosseum', lat: 41.8902, lng: 12.4922 };

function setup(overrides: Partial<NextStopCardProps> = {}) {
  const props: NextStopCardProps = {
    result: {
      kind: 'next',
      stop: { placeId: 'p1', arrivalMinutes: 10 * 60, departureMinutes: 12 * 60 },
      index: 0,
      phase: 'upcoming',
      minutesLeft: 25,
      minutesLate: 0,
      remainingUnchecked: 3,
    },
    place,
    travelUnknown: false,
    mode: 'walking',
    location: null,
    locationStatus: 'idle',
    onRequestLocation: jest.fn(),
    onNavigate: jest.fn(),
    onDone: jest.fn(),
    onSkip: jest.fn(),
    onOpenMap: jest.fn(),
    onAddPlace: jest.fn(),
    ...overrides,
  };
  const utils = render(
    <ThemeProvider>
      <NextStopCard {...props} />
    </ThemeProvider>,
  );
  return { ...utils, props };
}

describe('NextStopCard', () => {
  it('shows the stop, planned arrival and time left, and wires the actions', () => {
    const { getByText, getByRole, props } = setup();
    expect(getByText('Colosseum')).toBeTruthy();
    expect(getByText('Arrive 10:00 · in 25 min')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: 'Navigate to Colosseum' }));
    fireEvent.press(getByRole('button', { name: 'Mark Colosseum done' }));
    fireEvent.press(getByRole('button', { name: 'Skip Colosseum' }));
    fireEvent.press(getByRole('button', { name: 'Add a place to today' }));
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onAddPlace).toHaveBeenCalledTimes(1);
  });

  it('hides the distance estimate until location is granted', () => {
    const { queryByText, getByRole, props } = setup();
    expect(queryByText(/from you/)).toBeNull();
    fireEvent.press(getByRole('button', { name: 'How far am I?' }));
    expect(props.onRequestLocation).toHaveBeenCalled();
  });

  it('shows an approximate estimate when location is granted', () => {
    const { getByText } = setup({ locationStatus: 'granted', location: { lat: 41.9009, lng: 12.4833 } });
    expect(getByText(/≈ .* from you \(approx\.\)/)).toBeTruthy();
  });

  it('hides the location prompt after denial and add-place for viewers', () => {
    const { queryByRole } = setup({ locationStatus: 'denied', onAddPlace: null });
    expect(queryByRole('button', { name: 'How far am I?' })).toBeNull();
    expect(queryByRole('button', { name: 'Add a place to today' })).toBeNull();
  });

  it('renders the finished state without navigate', () => {
    const { getByText, queryByRole } = setup({ result: { kind: 'finished' }, place: null });
    expect(getByText("That's everything planned for today")).toBeTruthy();
    expect(getByText('Every stop is checked off. Enjoy the evening!')).toBeTruthy();
    expect(queryByRole('button', { name: /Navigate/ })).toBeNull();
  });

  it('a late stop keeps Navigate and shows the running-late hint', () => {
    const { getByText, getByRole, props } = setup({
      result: {
        kind: 'next',
        stop: { placeId: 'p1', arrivalMinutes: 10 * 60, departureMinutes: 12 * 60 },
        index: 0,
        phase: 'late',
        minutesLeft: 0,
        minutesLate: 45,
        remainingUnchecked: 3,
      },
    });
    expect(getByText('Running late')).toBeTruthy();
    expect(getByText('Planned until 12:00 · 45 min behind')).toBeTruthy();
    expect(getByText(/3 stops left today/)).toBeTruthy();
    fireEvent.press(getByRole('button', { name: 'Navigate to Colosseum' }));
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
  });

  it('a late last stop says so', () => {
    const { getByText } = setup({
      result: {
        kind: 'next',
        stop: { placeId: 'p1', arrivalMinutes: 10 * 60, departureMinutes: 12 * 60 },
        index: 2,
        phase: 'late',
        minutesLeft: 0,
        minutesLate: 5,
        remainingUnchecked: 1,
      },
    });
    expect(getByText(/Last stop today/)).toBeTruthy();
  });
});
