import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '@/theme';
import { DayJumpStrip } from '../DayJumpStrip';
import { buildDayChips } from '../dayChips';

const TRIP = { id: 't1', start_date: '2026-10-12', end_date: '2026-10-14', archived_at: null };
const DURING = new Date(2026, 9, 13, 9, 0); // day index 1

describe('DayJumpStrip', () => {
  it('renders a tab per section, marks today, and jumps on press', () => {
    const onJump = jest.fn();
    const chips = buildDayChips(TRIP, [-1, 0, 1, 2], DURING);
    const { getByRole, getByText } = render(
      <ThemeProvider>
        <DayJumpStrip chips={chips} activeDayIndex={1} onJump={onJump} trailing={<Text>Assist</Text>} />
      </ThemeProvider>,
    );
    expect(getByText('D2 Tue 13 · Today')).toBeTruthy();
    const today = getByRole('tab', { name: /Jump to Day 2, .*Tuesday.*, today/ });
    expect(today.props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(getByRole('tab', { name: /Jump to Day 3/ }));
    expect(onJump).toHaveBeenCalledWith(2);
    fireEvent.press(getByRole('tab', { name: /Jump to Ideas/ }));
    expect(onJump).toHaveBeenCalledWith(-1);
    expect(getByText('Assist')).toBeTruthy();
  });

  it('renders nothing for a single section without a trailing action', () => {
    const chips = buildDayChips(TRIP, [0], DURING);
    const { toJSON } = render(
      <ThemeProvider>
        <DayJumpStrip chips={chips} activeDayIndex={null} onJump={() => {}} />
      </ThemeProvider>,
    );
    expect(toJSON()).toBeNull();
  });
});
