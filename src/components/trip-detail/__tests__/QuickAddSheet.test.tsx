/**
 * QuickAddSheet + QuickAddFab — v2 M4 X2.2. The sub-sheets are stubbed so
 * the test checks the hand-off: the menu closes, the chosen sheet opens.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useState, type ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import type { TripPlace } from '@/api';
import { QuickAddFab, QuickAddSheet } from '../QuickAddSheet';

jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

function mockSheet(name: string) {
  return ({ visible }: { visible: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('react-native');
    return visible ? <Text>{`open:${name}`}</Text> : null;
  };
}
jest.mock('@/components/ai-edit', () => ({
  AiEditSheet: mockSheet('ai'),
  ImportPlacesSheet: mockSheet('import'),
}));
jest.mock('@/components/budget/ExpenseEditSheet', () => ({ ExpenseEditSheet: mockSheet('expense') }));

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function Harness({ onSearch }: { onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QuickAddFab onPress={() => setOpen(true)} bottom={16} />
      <QuickAddSheet
        visible={open}
        onClose={() => setOpen(false)}
        tripId="trip-1"
        places={[] as TripPlace[]}
        routeRenderMode="optimized"
        currency="EUR"
        tripDayCount={3}
        tripStartDate="2026-10-01"
        onSearch={onSearch}
      />
    </>
  );
}

describe('QuickAddSheet', () => {
  it('FAB opens the menu; Search closes it and navigates', () => {
    const onSearch = jest.fn();
    const { getByRole, queryByRole } = wrap(<Harness onSearch={onSearch} />);
    expect(queryByRole('button', { name: 'Search a place' })).toBeNull();
    fireEvent.press(getByRole('button', { name: 'Quick add' }));
    fireEvent.press(getByRole('button', { name: 'Search a place' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(queryByRole('button', { name: 'Search a place' })).toBeNull();
  });

  it.each([
    ['Paste a list', 'open:import'],
    ['Ask AI', 'open:ai'],
    ['Add expense', 'open:expense'],
  ])('%s hands off to its sheet', async (label, marker) => {
    const { getByRole, findByText, queryByRole } = wrap(<Harness onSearch={jest.fn()} />);
    fireEvent.press(getByRole('button', { name: 'Quick add' }));
    act(() => {
      fireEvent.press(getByRole('button', { name: label }));
    });
    expect(queryByRole('button', { name: label })).toBeNull();
    // iOS (the jest-expo default platform) waits out the Modal dismissal.
    expect(await findByText(marker, {}, { timeout: 2000 })).toBeTruthy();
  });
});
