import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { DayPicker, MAX_PICKER_DAYS, dayLabel, tripDayCount } from '../DayPicker';

describe('tripDayCount', () => {
  it('counts the inclusive date range', () => {
    expect(tripDayCount('2026-10-01', '2026-10-03')).toBe(3);
    expect(tripDayCount('2026-10-01', '2026-10-01')).toBe(1);
  });

  it('spans DST / month boundaries correctly', () => {
    expect(tripDayCount('2026-10-24', '2026-11-02')).toBe(10);
  });

  it('falls back to scheduled places when dates are missing or inverted', () => {
    expect(tripDayCount(null, null)).toBe(1);
    expect(tripDayCount(null, '2026-10-03', [0, 2, null])).toBe(3);
    expect(tripDayCount('2026-10-05', '2026-10-01', [1])).toBe(2);
  });

  it('never hides a day that already has places', () => {
    expect(tripDayCount('2026-10-01', '2026-10-02', [4])).toBe(5);
  });

  it('clamps absurd ranges', () => {
    expect(tripDayCount('2020-01-01', '2026-01-01')).toBe(MAX_PICKER_DAYS);
  });
});

describe('dayLabel', () => {
  it('labels days 1-based and null as Ideas', () => {
    expect(dayLabel(0)).toBe('Day 1');
    expect(dayLabel(null)).toBe('Ideas');
  });
});

describe('DayPicker', () => {
  function renderPicker(selected: number | null, onSelect = jest.fn()) {
    const utils = render(
      <ThemeProvider>
        <DayPicker dayCount={3} selected={selected} onSelect={onSelect} />
      </ThemeProvider>,
    );
    return { ...utils, onSelect };
  }

  it('offers every trip day plus Ideas, even with no places yet', () => {
    const { getByRole } = renderPicker(0);
    for (const name of ['Day 1', 'Day 2', 'Day 3', 'Ideas']) {
      expect(getByRole('radio', { name })).toBeTruthy();
    }
  });

  it('selects a day chip', () => {
    const { getByRole, onSelect } = renderPicker(0);
    fireEvent.press(getByRole('radio', { name: 'Day 3' }));
    expect(onSelect).toHaveBeenCalledWith(2);
    fireEvent.press(getByRole('radio', { name: 'Ideas' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('stepper advances a day, then switches to Ideas on the last day', () => {
    const first = renderPicker(0);
    fireEvent.press(first.getByRole('button', { name: 'Switch to Day 2' }));
    expect(first.onSelect).toHaveBeenCalledWith(1);
    first.unmount();

    const last = renderPicker(2);
    fireEvent.press(last.getByRole('button', { name: 'Add to Ideas' }));
    expect(last.onSelect).toHaveBeenCalledWith(null);
  });

  it('hides the stepper when Ideas is selected', () => {
    const { queryByRole } = renderPicker(null);
    expect(queryByRole('button')).toBeNull();
  });
});
