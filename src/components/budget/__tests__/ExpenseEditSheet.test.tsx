import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme';
import { toLocalDateString } from '@/lib/tripToday';
import { ExpenseEditSheet } from '../ExpenseEditSheet';

const mockCreate = jest.fn(async (_input: unknown) => ({}));
const mockUpdate = jest.fn(async (_input: unknown) => ({}));

jest.mock('@/api', () => ({
  useCreateTripExpense: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTripExpense: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));
// The '@/components' barrel pulls in NetInfo-backed widgets; the sheet only needs BottomSheet.
jest.mock('@/components', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalDateString(d);
}

describe('ExpenseEditSheet quick expense (X2.4)', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockUpdate.mockClear();
  });

  it('defaults to today + actual while the trip is live, in the trip currency', async () => {
    const onClose = jest.fn();
    const { getByLabelText, getByRole } = wrap(
      <ExpenseEditSheet
        tripId="t1"
        expense={null}
        currency="eur"
        visible
        onClose={onClose}
        tripDayCount={4}
        tripStartDate={daysAgo(1)}
      />,
    );
    fireEvent.changeText(getByLabelText('Expense amount in EUR'), '12.5');
    fireEvent.press(getByRole('radio', { name: 'Transport' }));
    fireEvent.press(getByRole('button', { name: 'Add expense' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toEqual({
      trip_id: 't1',
      category: 'transport',
      kind: 'actual',
      amount: 12.5,
      day_index: 1,
      label: null,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the v1 defaults (estimated, whole trip) without trip dates and validates the amount', async () => {
    const { getByRole, findByText } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} visible onClose={jest.fn()} tripDayCount={3} />,
    );
    expect(getByRole('radio', { name: 'Whole trip' }).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(getByRole('button', { name: 'Add expense' }));
    expect(await findByText(/Enter a valid amount/)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
