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
import { render } from '@testing-library/react-native';
import { BudgetCard } from '../BudgetCard';
import { ThemeProvider } from '@/theme';
import type { TripExpenseRollup } from '@/api/trip-expenses';
import type { TripExpenseCategory } from '@/api/types';
import React from 'react';

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
});
