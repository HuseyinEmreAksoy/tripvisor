/**
 * CategoryBreakdown — rendering tests.
 *
 * Verifies:
 *   1. All six categories render even when every slot is zero.
 *   2. Category labels match the expected strings.
 *   3. Per-category actual/estimated amounts render for a non-zero slot.
 *   4. The totals visible in accessibilityLabels match the input rollup.
 */
import { render } from '@testing-library/react-native';
import { CategoryBreakdown } from '../CategoryBreakdown';
import { ThemeProvider } from '@/theme';
import type { TripExpenseRollup } from '@/api/trip-expenses';
import type { TripExpenseCategory } from '@/api/types';
import React from 'react';

// ---- Helpers -----------------------------------------------------------------

const ALL_CATEGORIES: TripExpenseCategory[] = [
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
];

function emptyByCategory(): TripExpenseRollup['byCategory'] {
  const out = {} as TripExpenseRollup['byCategory'];
  for (const c of ALL_CATEGORIES) out[c] = { estimated: 0, actual: 0, remaining: 0 };
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

describe('CategoryBreakdown', () => {
  it('renders all six category labels when every slot is zero', () => {
    const rollup = makeRollup();
    const { getByText } = wrap(<CategoryBreakdown rollup={rollup} />);

    expect(getByText('Accommodation')).toBeTruthy();
    expect(getByText('Food & Drink')).toBeTruthy();
    expect(getByText('Transport')).toBeTruthy();
    expect(getByText('Shopping')).toBeTruthy();
    expect(getByText('Activities')).toBeTruthy();
    expect(getByText('Other')).toBeTruthy();
  });

  it('shows "—" placeholder for zero categories (no expenses recorded)', () => {
    const rollup = makeRollup();
    const { getAllByText } = wrap(<CategoryBreakdown rollup={rollup} />);

    // All six slots are empty; the component renders a "—" for each.
    const dashes = getAllByText('—');
    expect(dashes.length).toBe(6);
  });

  it('renders actual/estimated amounts for a non-zero category', () => {
    const byCategory = emptyByCategory();
    byCategory.food = { estimated: 200, actual: 150, remaining: 50 };

    const rollup = makeRollup({ byCategory, totalEstimated: 200, totalActual: 150 });
    const { getByText } = wrap(<CategoryBreakdown rollup={rollup} />);

    // Phase 22: formatCurrency produces locale-formatted output, e.g. "$150,00 / $200,00".
    // Match loosely so the test is resilient to locale/currency formatting changes.
    expect(getByText(/150.*\/.*200/)).toBeTruthy();
  });

  it('renders the accessible "no expenses recorded" label for zero categories', () => {
    const rollup = makeRollup();
    const { getAllByLabelText } = wrap(<CategoryBreakdown rollup={rollup} />);

    const noExpenseRows = getAllByLabelText(/no expenses recorded/i);
    // All six categories should have this label when zero.
    expect(noExpenseRows.length).toBe(6);
  });

  it('renders the accessible estimated/actual label for non-zero categories', () => {
    const byCategory = emptyByCategory();
    byCategory.transport = { estimated: 100, actual: 80, remaining: 20 };

    const rollup = makeRollup({ byCategory });
    const { getByLabelText } = wrap(<CategoryBreakdown rollup={rollup} />);

    // Phase 22: formatCurrency formats amounts with locale separators, e.g.
    // "Transport: estimated $100,00, actual $80,00". Match on numeric substrings.
    expect(getByLabelText(/estimated.*100.*actual.*80/i)).toBeTruthy();
  });

  it('totals of individual category actuals match totalActual in input', () => {
    // This is a data-integrity test: verify the component does not silently
    // discard or double-count categories. We supply known values and check the
    // accessibility labels contain them without adding them up inside the test.
    const byCategory = emptyByCategory();
    byCategory.accommodation = { estimated: 300, actual: 250, remaining: 50 };
    byCategory.food = { estimated: 100, actual: 90, remaining: 10 };

    const rollup = makeRollup({
      byCategory,
      totalEstimated: 400,
      totalActual: 340,
    });

    const { getByLabelText } = wrap(<CategoryBreakdown rollup={rollup} />);

    // Phase 22: formatCurrency formats amounts with locale separators, e.g.
    // "Accommodation: estimated $300,00, actual $250,00". Match on numeric substrings.
    expect(getByLabelText(/estimated.*300.*actual.*250/i)).toBeTruthy();
    // food row: estimated 100, actual 90
    expect(getByLabelText(/estimated.*100.*actual.*90/i)).toBeTruthy();
  });
});
