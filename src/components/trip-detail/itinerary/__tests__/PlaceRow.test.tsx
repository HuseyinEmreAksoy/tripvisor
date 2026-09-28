/**
 * PlaceRow (v2 M4 X2.3): full-card open-details target without nested
 * interactive elements, long-press forwarding, and the transit link's real
 * destination.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import type { TripLeg, TripPlace } from '@/api';
import type { DirectionsOptions } from '@/lib/directions';

const mockOpenDirections = jest.fn(async (_opts: DirectionsOptions) => true);

jest.mock('@/lib/directions', () => ({
  openDirections: (opts: DirectionsOptions) => mockOpenDirections(opts),
}));
// Tier-2 thumbnail hooks + the notes editor's mutation hooks are out of
// scope here — stub them so the row renders without a QueryClient.
jest.mock('@/api/places', () => ({ usePlaceDetails: () => ({ data: undefined }) }));
jest.mock('@/api/place-photos', () => ({ usePlacePhotoUrl: () => ({ url: null }) }));
jest.mock('../../NotesEditors', () => ({ PlaceNotesEditor: () => null }));

// eslint-disable-next-line import/first
import { PlaceRow } from '../../PlaceRow';

function makePlace(overrides: Partial<TripPlace> = {}): TripPlace {
  return {
    id: 'row-1',
    trip_id: 'trip-1',
    google_place_id: 'gp-1',
    user_title: 'Louvre',
    category: 'Museum',
    lat: 48.86,
    lng: 2.33,
    visit_duration_minutes: 120,
    day_index: 0,
    order_in_day: 0,
    notes: null,
    details_refreshed_at: null,
    arrive_after: null,
    leave_before: null,
    pinned_start: null,
    ...overrides,
  } as TripPlace;
}

const LEG = {
  day_index: 0,
  from_place_id: 'row-1',
  to_place_id: 'row-2',
  duration_seconds: 900,
  distance_meters: 2500,
  transit_steps: null,
} as unknown as TripLeg;

function renderRow(props: Partial<React.ComponentProps<typeof PlaceRow>> = {}) {
  const onOpenDetails = jest.fn();
  const utils = render(
    <ThemeProvider>
      <PlaceRow
        place={makePlace()}
        dragging={false}
        legAfter={LEG}
        hasNext
        transportMode="transit"
        onOpenDetails={onOpenDetails}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ...utils, onOpenDetails };
}

describe('PlaceRow', () => {
  beforeEach(() => {
    mockOpenDirections.mockClear();
  });

  it('opens details from the full-card target', () => {
    const { getByRole, onOpenDetails } = renderRow();
    fireEvent.press(getByRole('button', { name: /Open details for Louvre/ }));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  it('forwards long-press on the card (drag pickup)', () => {
    const onLongPress = jest.fn();
    const { getByRole } = renderRow({ onLongPress });
    fireEvent(getByRole('button', { name: /Open details for Louvre/ }), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('keeps the comment chip a sibling — it does not open details', () => {
    const onOpenComments = jest.fn();
    const { getByRole, onOpenDetails } = renderRow({ onOpenComments, commentCount: 2 });
    const chip = getByRole('button', { name: /2 comments on Louvre/ });
    fireEvent.press(chip);
    expect(onOpenComments).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).not.toHaveBeenCalled();
    // Not nested inside the open-details button.
    const card = getByRole('button', { name: /Open details for Louvre/ });
    let node = chip.parent;
    while (node) {
      expect(node).not.toBe(card);
      node = node.parent;
    }
  });

  it('plans transit to the NEXT stop, from this stop', () => {
    const { getByRole } = renderRow({
      nextStop: { lat: 48.85, lng: 2.35, placeId: 'gp-2', label: 'Notre-Dame' },
    });
    fireEvent.press(getByRole('link', { name: /Plan transit to Notre-Dame/ }));
    expect(mockOpenDirections).toHaveBeenCalledWith({
      origin: { lat: 48.86, lng: 2.33, placeId: 'gp-1', label: 'Louvre' },
      destination: { lat: 48.85, lng: 2.35, placeId: 'gp-2', label: 'Notre-Dame' },
      mode: 'transit',
    });
  });

  it('hides the transit link when the next stop is unknown', () => {
    const { queryByRole } = renderRow({ nextStop: null });
    expect(queryByRole('link', { name: /Plan transit/ })).toBeNull();
  });
});
