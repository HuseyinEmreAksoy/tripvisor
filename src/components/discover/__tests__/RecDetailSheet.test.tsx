/**
 * RecDetailSheet (M5 Y3.4): Google rating on tap with "Powered by Google",
 * add → "Added to Day N" / "Added to Ideas" (scheduled === false), and
 * AddPoiError codes → discover:addError strings. The match is passed to the
 * add so it costs no second search.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import type { PoiItem } from '@/api/recommendations';
import { RecDetailSheet } from '../RecDetailSheet';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const mockMatch = { placeId: 'g-1', mainText: 'Galata Kulesi', secondaryText: 'Istanbul', query: 'Galata Tower' };
jest.mock('../useRecGoogleMatch', () => ({
  useRecGoogleMatch: () => ({ data: mockMatch, isLoading: false, error: null }),
}));

jest.mock('@/api/places', () => ({
  newAutocompleteSessionToken: () => 'session-1',
  usePlaceDetails: () => ({
    data: {
      placeId: 'g-1',
      displayName: 'Galata Kulesi',
      rating: 4.6,
      userRatingCount: 1234,
      reviews: [
        {
          name: 'r1',
          rating: 5,
          text: { text: 'Great view' },
          authorAttribution: { displayName: 'Ayşe', uri: 'https://maps.google.com/u/1' },
          publishTime: '2026-01-01',
          relativePublishTimeDescription: 'a month ago',
        },
      ],
      googleMapsUri: 'https://maps.google.com/?cid=1',
    },
    isLoading: false,
    error: null,
  }),
}));

type MutateOpts = { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void };
const mockMutate = jest.fn<(input: unknown, opts: MutateOpts) => void>();
jest.mock('@/api/recommendations', () => {
  const actual = jest.requireActual('@/api/recommendations') as object;
  return { ...actual, useAddPoiToTrip: () => ({ mutate: mockMutate, isPending: false }) };
});

const t = i18n.t.bind(i18n);
const wrap = (node: ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

const item: PoiItem = {
  id: 'osm:way/1',
  source: 'osm',
  osm: { type: 'way', id: 1 },
  name: 'Galata Tower',
  originalName: null,
  lat: 41.0256,
  lng: 28.9742,
  distanceM: 850,
  interests: ['history'],
  kind: 'historic=tower',
  tags: {},
  wikidata: null,
  wiki: null,
  score: 0.9,
};

function sheet(props: Partial<Parameters<typeof RecDetailSheet>[0]> = {}) {
  return wrap(
    <RecDetailSheet
      item={item}
      tripId="trip-1"
      dayCount={3}
      defaultDayIndex={1}
      canEdit
      existingGooglePlaceIds={['g-9']}
      onClose={jest.fn()}
      {...props}
    />,
  );
}

describe('RecDetailSheet', () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('shows the Google rating, a review with its author and Powered by Google', () => {
    const { getByText, getByLabelText } = sheet();
    expect(getByLabelText(t('discover:detail.ratingA11y', { rating: '4.6' }))).toBeTruthy();
    expect(getByText('Great view')).toBeTruthy();
    expect(getByText('Ayşe')).toBeTruthy();
    expect(getByLabelText('Powered by Google')).toBeTruthy();
  });

  it('adds to the pre-selected day with the resolved match', async () => {
    mockMutate.mockImplementation((_input, opts) =>
      opts.onSuccess?.({ place: {}, googlePlaceId: 'g-1', matchedName: 'Galata Kulesi', scheduled: true }),
    );
    const { getByRole, findByText } = sheet();
    expect(getByRole('radio', { name: t('discover:detail.day', { n: 2 }) }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    fireEvent.press(getByRole('button', { name: t('discover:detail.add') }));
    const input = mockMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toEqual(
      expect.objectContaining({ dayIndex: 1, match: mockMatch, existingGooglePlaceIds: ['g-9'], sessionToken: 'session-1' }),
    );
    expect(await findByText(t('discover:detail.addedDay', { n: 2 }))).toBeTruthy();
    expect(await findByText(t('discover:detail.matchedAs', { name: 'Galata Kulesi' }))).toBeTruthy();
  });

  it('says "Added to Ideas" when the move to the day failed (scheduled === false)', async () => {
    mockMutate.mockImplementation((_input, opts) =>
      opts.onSuccess?.({ place: {}, googlePlaceId: 'g-1', matchedName: 'Galata Tower', scheduled: false }),
    );
    const { getByRole, findByText } = sheet();
    fireEvent.press(getByRole('button', { name: t('discover:detail.add') }));
    expect(await findByText(t('discover:detail.movedToIdeas', { n: 2 }))).toBeTruthy();
  });

  it('adds to Ideas when Ideas is picked', async () => {
    mockMutate.mockImplementation((_input, opts) =>
      opts.onSuccess?.({ place: {}, googlePlaceId: 'g-1', matchedName: 'Galata Tower', scheduled: null }),
    );
    const { getByRole, findByText } = sheet();
    fireEvent.press(getByRole('radio', { name: t('discover:detail.ideas') }));
    fireEvent.press(getByRole('button', { name: t('discover:detail.add') }));
    expect((mockMutate.mock.calls[0]![0] as { dayIndex: unknown }).dayIndex).toBeNull();
    expect(await findByText(t('discover:detail.addedIdeas'))).toBeTruthy();
  });

  it('maps an AddPoiError code to its message', async () => {
    const { AddPoiError } = jest.requireActual('@/api/recommendations') as typeof import('@/api/recommendations');
    mockMutate.mockImplementation((_input, opts) => opts.onError?.(new AddPoiError('already_in_trip', 'dup')));
    const { getByRole } = sheet();
    fireEvent.press(getByRole('button', { name: t('discover:detail.add') }));
    await waitFor(() => expect(getByRole('alert')).toBeTruthy());
    expect(getByRole('alert').props.children).toBe(t('discover:addError.already_in_trip'));
  });

  it('viewers see details but no add button', () => {
    const { queryByRole, getByText } = sheet({ canEdit: false });
    expect(queryByRole('button', { name: t('discover:detail.add') })).toBeNull();
    expect(getByText(t('discover:detail.viewOnly'))).toBeTruthy();
  });
});
