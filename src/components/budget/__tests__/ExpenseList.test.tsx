import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme';
import type { TripExpense } from '@/api/types';
import { ExpenseList } from '../ExpenseList';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

function expense(id: string, overrides: Partial<TripExpense>): TripExpense {
  return {
    id,
    trip_id: 't1',
    category: 'food',
    amount: 10,
    kind: 'actual',
    day_index: null,
    label: null,
    created_at: `2026-05-10T0${id}:00:00Z`,
    updated_at: '2026-05-10T00:00:00Z',
    ...overrides,
  };
}

const expenses = [
  expense('1', { day_index: 0, amount: 20, label: 'Breakfast' }),
  expense('2', { day_index: 1, amount: 35, label: 'Museum', category: 'activities' }),
  expense('3', { day_index: 1, amount: 500, kind: 'estimated', label: 'Hotel plan', category: 'accommodation' }),
];

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('ExpenseList (X2.4 spend strip)', () => {
  it('renders a per-day strip of actual spend and filters the list by day', () => {
    const { getByRole, queryByText, getByText } = wrap(
      <ExpenseList
        expenses={expenses}
        tripId="t1"
        currency="EUR"
        canEdit={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        tripDayCount={3}
        tripStartDate="2026-05-10"
      />,
    );
    // Day 2 (Mon 11) has 35 actual; the 500 estimate is not "spend".
    const day2 = getByRole('radio', { name: /Day 2, Mon 11.*35/ });
    expect(getByRole('radio', { name: /Day 3, Tue 12/ })).toBeTruthy();

    fireEvent.press(day2);
    expect(getByText('Museum')).toBeTruthy();
    expect(getByText('Hotel plan')).toBeTruthy();
    expect(queryByText('Breakfast')).toBeNull();

    fireEvent.press(day2); // tap again clears the filter
    expect(getByText('Breakfast')).toBeTruthy();
  });

  it('hides the strip when there is no actual spend', () => {
    const { queryByLabelText } = wrap(
      <ExpenseList
        expenses={[expenses[2]!]}
        tripId="t1"
        canEdit={false}
        onAdd={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(queryByLabelText('Filter expenses by day')).toBeNull();
  });
});
