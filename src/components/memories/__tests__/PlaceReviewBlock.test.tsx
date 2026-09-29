/**
 * PlaceReviewBlock (M5 Y3.1): the user's own 1–5 stars + text, private by
 * default, with the "Share with trip" switch; trip-mates' shared reviews
 * are listed separately and the owner can remove them.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';

type Review = {
  id: string;
  rating: number | null;
  body: string;
  visibility: 'only_me' | 'trip';
  trip_place_id: string;
};

let mockMine: Review | null = null;
let mockOthers: Review[] = [];
const mockUpsert = jest.fn(async (_input: unknown) => 'r-new');
const mockSetVisibility = jest.fn();
const mockDelete = jest.fn();
const mockRemove = jest.fn();

jest.mock('@/api/memories', () => ({
  usePlaceReviews: () => ({ mine: mockMine, others: mockOthers, isLoading: false }),
  useUpsertPlaceReview: () => ({ mutateAsync: mockUpsert, isPending: false }),
  useSetMemoryVisibility: () => ({ mutate: mockSetVisibility }),
  useDeleteMemory: () => ({ mutate: mockDelete }),
  useRemoveTripMemory: () => ({ mutate: mockRemove }),
}));
jest.mock('@/lib/confirm', () => ({ confirmDestructive: async () => true }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: jest.fn() } }));

// eslint-disable-next-line import/first
import { PlaceReviewBlock } from '../PlaceReviewBlock';

// Untyped view of i18n.t: test keys are built at runtime.
const translate = i18n.t as unknown as (key: string, opts?: Record<string, unknown>) => string;
const tx = (key: string, opts?: Record<string, unknown>) => translate(`memories:${key}`, opts);
const switchLabel = () => tx('visibility.a11y', { item: tx('items.review') });

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function renderBlock(props: Partial<Parameters<typeof PlaceReviewBlock>[0]> = {}) {
  return wrap(<PlaceReviewBlock tripId="trip-1" tripPlaceId="tp-1" canWrite isOwner={false} {...props} />);
}

beforeEach(() => {
  mockMine = null;
  mockOthers = [];
  mockUpsert.mockClear();
  mockSetVisibility.mockClear();
  mockDelete.mockClear();
  mockRemove.mockClear();
});

describe('PlaceReviewBlock', () => {
  it('shows its own heading, separate from Google reviews', () => {
    const { getByText } = renderBlock();
    expect(getByText(tx('review.heading'))).toBeTruthy();
    expect(getByText(tx('review.subheading'))).toBeTruthy();
  });

  it('creates a PRIVATE review when a star is tapped', async () => {
    const { getByLabelText } = renderBlock();
    await act(async () => {
      fireEvent.press(getByLabelText(tx('review.starLabel', { count: 4 })));
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      tripId: 'trip-1',
      tripPlaceId: 'tp-1',
      rating: 4,
      visibility: 'only_me',
    });
  });

  it('creates a SHARED review when the switch is turned on first', async () => {
    const { getByLabelText } = renderBlock();
    fireEvent(getByLabelText(switchLabel()), 'valueChange', true);
    expect(mockSetVisibility).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(getByLabelText(tx('review.starLabel', { count: 5 })));
    });
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ rating: 5, visibility: 'trip' }));
  });

  it('toggles the visibility of an existing review in place', () => {
    mockMine = { id: 'r1', rating: 3, body: 'Nice', visibility: 'only_me', trip_place_id: 'tp-1' };
    const { getByLabelText } = renderBlock();
    fireEvent(getByLabelText(switchLabel()), 'valueChange', true);
    expect(mockSetVisibility).toHaveBeenCalledWith(
      { tripId: 'trip-1', items: [{ kind: 'review', id: 'r1' }], visibility: 'trip' },
      expect.anything(),
    );
  });

  it('saves the text without touching the rating', async () => {
    mockMine = { id: 'r1', rating: 3, body: '', visibility: 'only_me', trip_place_id: 'tp-1' };
    const { getByLabelText } = renderBlock();
    fireEvent.changeText(getByLabelText(tx('review.bodyLabel')), 'Great view');
    await act(async () => {
      fireEvent.press(getByLabelText(tx('actions.save')));
    });
    expect(mockUpsert).toHaveBeenCalledWith({ tripId: 'trip-1', tripPlaceId: 'tp-1', body: 'Great view' });
  });

  it('lists shared trip-mate reviews and lets the owner remove them', async () => {
    mockOthers = [{ id: 'o1', rating: 5, body: 'Loved it', visibility: 'trip', trip_place_id: 'tp-1' }];
    const { getByText, getByLabelText } = renderBlock({ isOwner: true });
    expect(getByText('Loved it')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByLabelText(tx('actions.removeFromTrip')));
    });
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ tripId: 'trip-1', kind: 'review', id: 'o1' }, expect.anything()),
    );
  });

  it('a user who left the trip can still unshare and delete, but not edit', async () => {
    mockMine = { id: 'r1', rating: 2, body: 'Meh', visibility: 'trip', trip_place_id: 'tp-1' };
    const { queryByLabelText, getByLabelText } = renderBlock({ canWrite: false });
    expect(queryByLabelText(tx('actions.save'))).toBeNull();
    expect(queryByLabelText(tx('review.starLabel', { count: 4 }))).toBeNull();
    fireEvent(getByLabelText(switchLabel()), 'valueChange', false);
    expect(mockSetVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'only_me' }),
      expect.anything(),
    );
    await act(async () => {
      fireEvent.press(getByLabelText(tx('actions.delete')));
    });
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({ tripId: 'trip-1', kind: 'review', id: 'r1' }, expect.anything()),
    );
  });
});
