/**
 * TripHubTab (the phone "Trip" tab) + tab-param helpers — v2 M4 X2.2.
 *
 * The data hooks and the heavy child sections (budget, stays, docs, share)
 * are mocked at the module boundary: this suite checks the hub's own
 * behavior — summaries, accordion expand, link routing and role gating.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import { TripHubTab, summarizeStays } from '../TripHubTab';
import { parseTripTab, resolveTripTab } from '../tripTabs';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

let mockPacking: Array<{ id: string; checked: boolean; deleted?: boolean }> = [];
let mockRollup = {
  byCategory: {},
  totalEstimated: 0,
  totalActual: 250,
  budget: 1000 as number | null,
  remaining: 750 as number | null,
  hasBudget: true,
};

jest.mock('@/api', () => ({
  useDeleteTripExpense: () => ({ mutate: jest.fn() }),
  useTripPlaces: () => ({ data: [] }),
}));
jest.mock('@/api/trip-expenses', () => ({
  useTripExpenseRollup: () => mockRollup,
  useTripExpenses: () => ({ data: [] }),
}));
jest.mock('@/api/trip-accommodations', () => ({
  useTripAccommodations: () => ({ data: [] }),
  useDeleteTripAccommodation: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/api/trip-packing', () => ({ useTripPackingItems: () => ({ data: mockPacking }) }));
jest.mock('@/api/trip-documents', () => ({ useTripDocuments: () => ({ data: [{ id: 'd1' }] }) }));
jest.mock('@/api/trip-collaborators', () => ({ useTripCollaborators: () => ({ data: [] }) }));
jest.mock('@/api/trip-place-reactions', () => ({ useTripReactions: () => ({ data: [] }) }));
jest.mock('@/api/auth', () => ({ useSession: () => ({ data: null }) }));

// Child sections → labelled stubs.
function mockStub(name: string) {
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require('react-native');
    return <RNText>{name}</RNText>;
  };
}
jest.mock('@/components/budget/BudgetCard', () => ({ BudgetCard: mockStub('stub:BudgetCard') }));
jest.mock('@/components/budget/BudgetEditSheet', () => ({ BudgetEditSheet: () => null }));
jest.mock('@/components/budget/CategoryBreakdown', () => ({ CategoryBreakdown: () => null }));
jest.mock('@/components/budget/ExpenseList', () => ({ ExpenseList: () => null }));
jest.mock('@/components/budget/ExpenseEditSheet', () => ({ ExpenseEditSheet: () => null }));
jest.mock('@/components/accommodation/AccommodationList', () => ({ AccommodationList: () => null }));
jest.mock('@/components/accommodation/AccommodationEditSheet', () => ({ AccommodationEditSheet: () => null }));
jest.mock('../DocumentsSection', () => ({ DocumentsSection: () => null }));
jest.mock('@/components/ShareLinkCard', () => ({ ShareLinkCard: mockStub('stub:ShareLinkCard') }));

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function renderHub(overrides: Partial<Parameters<typeof TripHubTab>[0]> = {}) {
  return wrap(
    <TripHubTab
      tripId="trip-1"
      tripStartDate="2026-10-01"
      currency="EUR"
      tripDayCount={4}
      canEdit
      isOwner
      onOpenPlace={jest.fn()}
      {...overrides}
    />,
  );
}

describe('TripHubTab', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockPacking = [
      { id: 'a', checked: true },
      { id: 'b', checked: false },
      { id: 'gone', checked: true, deleted: true },
    ];
    mockRollup = { ...mockRollup, totalActual: 250, budget: 1000, hasBudget: true };
  });

  it('summarizes packing (ignoring tombstones) and links to the packing route', () => {
    const { getByRole } = renderHub();
    const packing = getByRole('button', { name: /packing list, 1 of 2 packed/i });
    fireEvent.press(packing);
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1/packing');
  });

  it('expands the budget section in place', () => {
    const { getByRole, queryByText, getByText } = renderHub();
    const budget = getByRole('button', { name: /^Budget, .*spent/ });
    expect(budget.props.accessibilityState).toMatchObject({ expanded: false });
    expect(queryByText('stub:BudgetCard')).toBeNull();
    fireEvent.press(budget);
    expect(getByText('stub:BudgetCard')).toBeTruthy();
  });

  it('opens People on the collaborators route', () => {
    const { getByRole } = renderHub();
    fireEvent.press(getByRole('button', { name: /manage collaborators/i }));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1/collaborators');
  });

  // Security audit #5: public links are owner-only (share-trip → 403 not_owner).
  it.each([
    ['viewers', { canEdit: false, isOwner: false }],
    ['editors', { canEdit: true, isOwner: false }],
  ])('%s cannot expand Share and are told to ask the owner', (_who, role) => {
    const { getByRole, getByText, queryByText } = renderHub(role);
    const share = getByRole('button', { name: /^Share, only the trip owner can create a share link/i });
    // A link row, not an accordion: no expanded state to announce.
    expect(share.props.accessibilityState?.expanded).toBeUndefined();
    expect(getByText('Only the trip owner can create a share link. Ask them to send you one.')).toBeTruthy();
    fireEvent.press(share);
    expect(queryByText('stub:ShareLinkCard')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1/collaborators');
  });

  it('the owner can expand Share to the link card', () => {
    const { getByRole, getByText } = renderHub({ canEdit: true, isOwner: true });
    const share = getByRole('button', { name: /^Share, read-only public link/i });
    expect(share.props.accessibilityState).toMatchObject({ expanded: false });
    fireEvent.press(share);
    expect(getByText('stub:ShareLinkCard')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('summarizeStays', () => {
  const stays = [
    { name: 'Alfama flat', check_in_date: '2026-10-01', check_out_date: '2026-10-03' },
    { name: 'Sintra B&B', check_in_date: '2026-10-03', check_out_date: '2026-10-05' },
  ];
  it('prefers tonight, then the next check-in, then a count', () => {
    expect(summarizeStays([], '2026-10-02')).toBe('No stays yet');
    expect(summarizeStays(stays, '2026-10-02')).toBe('Tonight: Alfama flat');
    expect(summarizeStays(stays, '2026-09-20')).toBe('Next check-in 2026-10-01 · Alfama flat');
    expect(summarizeStays(stays, '2026-11-01')).toBe('2 stays');
  });
});

describe('trip tab param', () => {
  it('maps current and legacy names', () => {
    expect(parseTripTab('plan')).toBe('plan');
    expect(parseTripTab('itinerary')).toBe('plan');
    expect(parseTripTab('settings')).toBe('trip');
    expect(parseTripTab(['map'])).toBe('map');
    expect(parseTripTab('nope')).toBeNull();
  });
  it('defaults to Plan with places, else Map', () => {
    expect(resolveTripTab(undefined, 3)).toBe('plan');
    expect(resolveTripTab(undefined, 0)).toBe('map');
    expect(resolveTripTab('trip', 0)).toBe('trip');
  });
});
