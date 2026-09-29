import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { DayStartTimeControl } from '../DayStartTimeControl';

const mockMutate = jest.fn<(input: unknown) => void>();
jest.mock('@/api', () => ({
  useUpdateTripDay: () => ({ mutate: mockMutate, isError: false }),
}));

function renderC(extra: Partial<React.ComponentProps<typeof DayStartTimeControl>> = {}) {
  return render(
    <ThemeProvider>
      <DayStartTimeControl
        tripId="trip-1"
        dayIndex={1}
        dayRecord={{ notes: 'stale cached note' } as never}
        valueMinutes={9 * 60}
        onChangeMinutes={() => {}}
        {...extra}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockMutate.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('DayStartTimeControl persistence', () => {
  it('writes start_time only — never the cached notes', () => {
    const { getByRole } = renderC();
    fireEvent.press(getByRole('button', { name: /Tap to change the start time/ }));
    fireEvent.press(getByRole('button', { name: 'Start Day 2 30 minutes later' }));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({ trip_id: 'trip-1', day_index: 1, start_time: '09:30' });
    expect(mockMutate.mock.calls[0]?.[0]).not.toHaveProperty('notes');
  });

  it('flushes a pending stepper write on unmount instead of dropping it', () => {
    const { getByRole, unmount } = renderC();
    fireEvent.press(getByRole('button', { name: /Tap to change the start time/ }));
    fireEvent.press(getByRole('button', { name: 'Start Day 2 30 minutes later' }));
    expect(mockMutate).not.toHaveBeenCalled();
    unmount();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ start_time: '09:30' });
  });

  it('Done persists immediately', () => {
    const { getByRole, getByLabelText } = renderC();
    fireEvent.press(getByRole('button', { name: /Tap to change the start time/ }));
    fireEvent.changeText(getByLabelText(/Start time for Day 2/), '10:15');
    fireEvent.press(getByRole('button', { name: 'Done editing Day 2 start time' }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ start_time: '10:15' });
  });

  it('keeps the editor open with an error on a malformed draft', () => {
    const { getByRole, getByLabelText, getByText } = renderC();
    fireEvent.press(getByRole('button', { name: /Tap to change the start time/ }));
    fireEvent.changeText(getByLabelText(/Start time for Day 2/), '9.3x');
    fireEvent.press(getByRole('button', { name: 'Done editing Day 2 start time' }));
    expect(getByText('Use HH:MM, e.g. 09:30')).toBeTruthy();
    expect(getByLabelText(/Start time for Day 2/)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
