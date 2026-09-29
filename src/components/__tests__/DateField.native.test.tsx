/**
 * DateField.native — local-date round trip (no UTC shift), localized display,
 * and theme-following picker.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double captures picker props
const pickerProps: { current: any } = { current: null };
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
    default: (props: any) => {
      pickerProps.current = props;
      return <View testID="picker" />;
    },
  };
});

import { DateField, toLocalIsoDate } from '../DateField.native';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('DateField.native', () => {
  beforeEach(() => {
    pickerProps.current = null;
  });

  it('toLocalIsoDate uses local calendar fields', () => {
    // 00:30 local on 10 Oct — toISOString() would give 9 Oct east of UTC.
    expect(toLocalIsoDate(new Date(2026, 9, 10, 0, 30))).toBe('2026-10-10');
    expect(toLocalIsoDate(new Date(2026, 9, 10, 23, 30))).toBe('2026-10-10');
  });

  it('seeds the picker with LOCAL midnight of the stored date', () => {
    const { getByRole } = wrap(<DateField label="Start" value="2026-10-05" onChange={() => {}} />);
    fireEvent.press(getByRole('button', { name: 'Start' }));
    const d: Date = pickerProps.current.value;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 5]);
  });

  it('emits the picked local date without a UTC shift', () => {
    const onChange = jest.fn();
    const { getByRole } = wrap(<DateField label="Start" value={null} onChange={onChange} />);
    fireEvent.press(getByRole('button', { name: 'Start' }));
    pickerProps.current.onChange({ type: 'set' }, new Date(2026, 9, 10, 0, 30));
    expect(onChange).toHaveBeenCalledWith('2026-10-10');
  });

  it('shows a formatted date, not the raw ISO string', () => {
    const { queryByText } = wrap(<DateField label="Start" value="2026-06-12" onChange={() => {}} />);
    expect(queryByText('2026-06-12')).toBeNull();
  });

  it('passes a theme variant to the picker', () => {
    const { getByRole } = wrap(<DateField label="Start" value={null} onChange={() => {}} />);
    fireEvent.press(getByRole('button', { name: 'Start' }));
    expect(['light', 'dark']).toContain(pickerProps.current.themeVariant);
  });
});
