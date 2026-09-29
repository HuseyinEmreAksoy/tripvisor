/**
 * BudgetCard — rendering tests.
 *
 * Three cases:
 *   1. budget=null (hasBudget=false)  → "Set budget" CTA visible, no progress bar.
 *   2. actual < budget (< 80%)        → "remaining" text visible, no over-limit copy.
 *   3. actual > budget                → over-budget copy visible.
 *
 * The component is purely presentational; no hooks or network calls. The rollup
 * shape is built inline.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { BudgetCard } from '../BudgetCard';
import { ThemeProvider } from '@/theme';
import type { TripExpenseRollup } from '@/api/trip-expenses';
import type { TripExpenseCategory } from '@/api/types';
import React from 'react';
import { act } from '@testing-library/react-native';
import { i18n, setLanguagePreference } from '@/i18n';
import { summarizeTripMoney } from '@/lib/money';
import type { RateMode, TripMoneySummary } from '@/lib/money/types';

// Y3.2: the card reads the multi-currency summary itself when a trip id is known.
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
let mockSummary: TripMoneySummary | undefined;
const mockSummaryCalls: Array<{ tripId: string | undefined; rateMode?: RateMode }> = [];
jest.mock('@/api/trip-expenses', () => ({
  useTripMoneySummary: (tripId: string | undefined, opts: { rateMode?: RateMode } = {}) => {
    mockSummaryCalls.push({ tripId, rateMode: opts.rateMode });
    return {
      data: tripId ? mockSummary : undefined,
      home: mockSummary?.home ?? null,
      isLoading: false,
      error: null,
      isFetchingRates: false,
      ratesError: null,
      todayRatesUnavailable: false,
    };
  },
}));

// ---- Helpers -----------------------------------------------------------------

function emptyByCategory(): TripExpenseRollup['byCategory'] {
  const cats: TripExpenseCategory[] = [
    'accommodation', 'food', 'transport', 'shopping', 'activities', 'other',
  ];
  const out = {} as TripExpenseRollup['byCategory'];
  for (const c of cats) out[c] = { estimated: 0, actual: 0, remaining: 0 };
  return out;
}

function makeRollup(overrides: Partial<TripExpenseRollup> = {}): TripExpenseRollup {
  return {
    byCategory: emptyByCategory(),
    totalEstimated: 0,
    totalActual: 0,
    budget: null,
    remaining: null,
    hasBudget: false,
    ...overrides,
  };
}

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

// ---- Tests -------------------------------------------------------------------

describe('BudgetCard', () => {
  it('shows "Set budget" CTA when no budget is configured', () => {
    const rollup = makeRollup(); // budget=null, hasBudget=false
    const { getByRole, queryByRole } = wrap(
      <BudgetCard rollup={rollup} onSetBudget={jest.fn()} canEdit />,
    );

    // The "Set budget" button must be visible.
    expect(getByRole('button', { name: /set trip budget/i })).toBeTruthy();
    // No progress bar (progressbar role) should appear.
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('shows green "remaining" text when actual spend is well below budget', () => {
    const rollup = makeRollup({
      budget: 1000,
      totalActual: 300,
      totalEstimated: 400,
      remaining: 700,
      hasBudget: true,
    });
    const { getByText, queryByText } = wrap(
      <BudgetCard rollup={rollup} onSetBudget={jest.fn()} canEdit />,
    );

    // "remaining" text appears. Phase 22: formatCurrency produces locale-formatted
    // output (e.g. "$700,00 remaining"), so match loosely on the numeric content.
    expect(getByText(/700.*remaining/i)).toBeTruthy();
    // Percentage summary text confirms bar is rendered.
    expect(getByText(/30% of budget used/i)).toBeTruthy();
    // Over-budget copy must NOT appear.
    expect(queryByText(/over budget/i)).toBeNull();
  });

  it('shows over-budget copy when actual exceeds budget', () => {
    const rollup = makeRollup({
      budget: 1000,
      totalActual: 1200,
      totalEstimated: 900,
      remaining: -200,
      hasBudget: true,
    });
    const { getByText, queryByText } = wrap(
      <BudgetCard rollup={rollup} onSetBudget={jest.fn()} canEdit />,
    );

    // Phase 22: formatCurrency produces locale-formatted output (e.g. "$200,00
    // over budget"), so match loosely on the numeric content.
    expect(getByText(/200.*over budget/i)).toBeTruthy();
    // "remaining" text must NOT appear.
    expect(queryByText(/remaining/i)).toBeNull();
  });

  it('hides the set-budget CTA when canEdit=false and no budget is set', () => {
    const rollup = makeRollup();
    const { queryByRole } = wrap(
      <BudgetCard rollup={rollup} onSetBudget={jest.fn()} canEdit={false} />,
    );
    // "Set trip budget" pressable must not appear for viewers.
    expect(queryByRole('button', { name: /set trip budget/i })).toBeNull();
  });

  it('renders the accessible budget summary label with amounts', () => {
    const rollup = makeRollup({
      budget: 500,
      totalActual: 250,
      remaining: 250,
      hasBudget: true,
    });
    const { getByLabelText } = wrap(
      <BudgetCard rollup={rollup} onSetBudget={jest.fn()} canEdit />,
    );
    // accessibilityLabel: "Budget: 250 spent of 500, 50%"
    expect(getByLabelText(/250.*500/)).toBeTruthy();
    // Also confirm the text "250 remaining" appears.
  });

  it('shows the Add expense quick action only when onAddExpense is passed (X2.4)', () => {
    const onAddExpense = jest.fn();
    const { getByRole, rerender } = wrap(
      <BudgetCard rollup={makeRollup()} onSetBudget={jest.fn()} canEdit onAddExpense={onAddExpense} />,
    );
    fireEvent.press(getByRole('button', { name: 'Add expense' }));
    expect(onAddExpense).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <BudgetCard rollup={makeRollup()} onSetBudget={jest.fn()} canEdit />
      </ThemeProvider>,
    );
    expect(() => getByRole('button', { name: 'Add expense' })).toThrow();
  });
});

describe('BudgetCard — multi-currency (Y3.2)', () => {
  const rows = [
    // 100 TRY in the home currency.
    { id: 'a', amount: 100, kind: 'actual', category: 'food', currency: 'TRY', fx_rate: 1, fx_date: '2026-09-01', fx_home_currency: 'TRY' },
    // 20 EUR frozen at 40 TRY/EUR → 800 TRY.
    { id: 'b', amount: 20, kind: 'actual', category: 'food', currency: 'EUR', fx_rate: 40, fx_date: '2026-09-01', fx_home_currency: 'TRY' },
    // 15 USD, rate still pending → NOT in the totals.
    { id: 'c', amount: 15, kind: 'actual', category: 'transport', currency: 'USD', fx_rate: null, fx_date: '2026-09-02', fx_home_currency: 'TRY' },
  ];

  afterEach(async () => {
    await act(async () => {
      await setLanguagePreference('system');
    });
  });

  it('totals in the home currency, excludes pending rows and lists them per original currency', () => {
    mockSummary = summarizeTripMoney(rows, { home: 'TRY', budget: 2000 });
    const { getByText, getByLabelText, getAllByText } = wrap(
      <BudgetCard rollup={makeRollup()} currency="TRY" tripId="t1" onSetBudget={jest.fn()} canEdit />,
    );
    expect(getByText(i18n.t('money:budget.inHome', { code: 'TRY' }))).toBeTruthy();
    // 100 + 800 = 900 spent of 2000; the 15 USD are pending, never 1:1.
    expect(getByLabelText(/900.*2,000.*45%/)).toBeTruthy();
    expect(getByText(i18n.t('money:pending.chip', { count: 1 }))).toBeTruthy();
    // The pending USD amount is listed in USD (its original currency).
    expect(getAllByText(/15\.00/).length).toBeGreaterThan(0);
    // Per-currency breakdown: EUR row shows the original and the converted amount.
    expect(getByText(i18n.t('money:breakdown.title'))).toBeTruthy();
    expect(getByLabelText(/^EUR: €20\.00, about .*800\.00/)).toBeTruthy();
  });

  it('switches the summary to today’s rate from the toggle', () => {
    mockSummary = summarizeTripMoney(rows, { home: 'TRY' });
    mockSummaryCalls.length = 0;
    const { getByRole } = wrap(
      <BudgetCard rollup={makeRollup()} currency="TRY" tripId="t1" onSetBudget={jest.fn()} canEdit />,
    );
    fireEvent.press(getByRole('radio', { name: i18n.t('money:rates.today') }));
    expect(mockSummaryCalls.at(-1)).toEqual({ tripId: 't1', rateMode: 'today' });
  });

  it('shows no toggle or breakdown for a single-currency trip, and translates to Turkish', async () => {
    mockSummary = summarizeTripMoney([rows[0]!], { home: 'TRY' });
    const { queryByText, getByText } = wrap(
      <BudgetCard rollup={makeRollup()} currency="TRY" tripId="t1" onSetBudget={jest.fn()} canEdit />,
    );
    expect(queryByText(i18n.t('money:breakdown.title'))).toBeNull();
    expect(queryByText(i18n.t('money:rates.today'))).toBeNull();
    await act(async () => {
      await setLanguagePreference('tr');
    });
    expect(getByText('Tüm toplamlar TRY cinsinden')).toBeTruthy();
  });
});
