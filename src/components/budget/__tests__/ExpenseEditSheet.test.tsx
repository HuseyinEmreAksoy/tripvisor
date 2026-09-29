import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme';
import { i18n, setLanguagePreference } from '@/i18n';
import { toLocalDateString } from '@/lib/tripToday';
import type { TripExpense } from '@/api/types';
import { ExpenseEditSheet } from '../ExpenseEditSheet';

const mockCreate = jest.fn(async (_input: unknown) => ({}));
const mockUpdate = jest.fn(async (_input: unknown) => ({}));
let mockTripExpenses: Array<Partial<TripExpense>> = [];
const mockPreviewInputs: Array<{ amount: unknown; currency: unknown; home: unknown }> = [];
let mockPreview: Record<string, unknown> = {};

jest.mock('@/api', () => ({
  useCreateTripExpense: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTripExpense: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));
jest.mock('@/api/trip-expenses', () => ({
  useTripExpenses: () => ({ data: mockTripExpenses }),
}));
jest.mock('@/api/expense-fx', () => ({
  useExpenseFxPreview: (input: { amount: unknown; currency: unknown; home: unknown }) => {
    mockPreviewInputs.push(input);
    return {
      converted: null,
      rate: null,
      rateDate: null,
      sameCurrency: input.currency === input.home,
      isLoading: false,
      unavailable: false,
      ...mockPreview,
    };
  },
}));
jest.mock('@/api/fx', () => ({
  useFxCurrencies: () => ({ data: undefined, isLoading: false, isError: false }),
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

beforeEach(() => {
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockTripExpenses = [];
  mockPreview = {};
  mockPreviewInputs.length = 0;
});

afterEach(async () => {
  await act(async () => {
    await setLanguagePreference('system');
  });
});

describe('ExpenseEditSheet quick expense (X2.4)', () => {
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
      currency: 'EUR',
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

describe('ExpenseEditSheet multi-currency (Y3.2)', () => {
  it('starts in the trip’s most recent currency and offers home + recent chips', () => {
    mockTripExpenses = [
      { id: 'a', currency: 'USD', created_at: '2026-09-01T10:00:00Z' },
      { id: 'b', currency: 'EUR', created_at: '2026-09-03T10:00:00Z' },
      { id: 'c', currency: 'TRY', created_at: '2026-09-04T10:00:00Z' },
    ];
    const { getByLabelText, getByRole } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    // Most recent NON-home currency.
    expect(getByLabelText('Expense amount in EUR')).toBeTruthy();
    expect(getByRole('radio', { name: 'TRY, Turkish Lira, trip home currency' })).toBeTruthy();
    expect(getByRole('radio', { name: 'EUR, Euro' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(getByRole('radio', { name: 'USD, US Dollar' })).toBeTruthy();
    expect(getByRole('button', { name: 'Show all currencies' })).toBeTruthy();
  });

  it('shows the live "≈ home" preview for a foreign amount', () => {
    mockPreview = {
      converted: { currency: 'TRY', exact: '500', value: 500 },
      rate: 40,
      rateDate: '2026-09-28',
    };
    const { getByLabelText, getByText } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    fireEvent.press(getByLabelText('USD, US Dollar'));
    fireEvent.changeText(getByLabelText('Expense amount in USD'), '12.5');
    expect(mockPreviewInputs.at(-1)).toMatchObject({ amount: '12.5', currency: 'USD', home: 'TRY' });
    expect(getByText(/^≈ .*500\.00/)).toBeTruthy();
    expect(getByText(/^1 USD = 40 TRY/)).toBeTruthy();
  });

  it('warns that the expense will be saved as rate pending when no rate is available', () => {
    mockPreview = { unavailable: true };
    const { getByLabelText, getByText } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    fireEvent.press(getByLabelText('EUR, Euro'));
    expect(getByText(i18n.t('money:preview.unavailable'))).toBeTruthy();
  });

  it('parses "12,50" in Turkish and saves the picked currency', async () => {
    await act(async () => {
      await setLanguagePreference('tr');
    });
    const { getByLabelText, getByRole } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    fireEvent.press(getByLabelText('EUR, Euro'));
    fireEvent.changeText(getByLabelText('EUR cinsinden harcama tutarı'), '12,50');
    fireEvent.press(getByRole('button', { name: 'Harcama ekle' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ amount: 12.5, currency: 'EUR' });
  });

  it('finds a currency through "More…" search and enforces its minor units', async () => {
    const { getByLabelText, getByRole, findByText } = wrap(
      <ExpenseEditSheet tripId="t1" expense={null} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    fireEvent.press(getByRole('button', { name: 'Show all currencies' }));
    fireEvent.changeText(getByLabelText('Search currencies'), 'yen');
    fireEvent.press(getByRole('radio', { name: 'JPY, Japanese Yen' }));
    fireEvent.changeText(getByLabelText('Expense amount in JPY'), '12.5');
    fireEvent.press(getByRole('button', { name: 'Add expense' }));
    expect(await findByText(/JPY has no decimal places/)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('editing keeps the frozen rate unless the currency changes', async () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      trip_id: 't1',
      category: 'food',
      kind: 'actual',
      amount: 9.5,
      currency: 'EUR',
      day_index: null,
      label: null,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
    } as TripExpense;
    const { getByLabelText, getByRole } = wrap(
      <ExpenseEditSheet tripId="t1" expense={row} currency="TRY" visible onClose={jest.fn()} tripDayCount={0} />,
    );
    expect(getByLabelText('Expense amount in EUR').props.value).toBe('9.5');
    fireEvent.press(getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0]?.[0]).not.toHaveProperty('currency');

    fireEvent.press(getByLabelText('TRY, Turkish Lira, trip home currency'));
    fireEvent.press(getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect(mockUpdate.mock.calls[1]?.[0]).toMatchObject({ currency: 'TRY', amount: 9.5 });
  });
});
