/**
 * PlaceThumb (M5 Y2.4): the category tile always renders; the metered
 * Google photo lookup never starts for a row that has not been on screen,
 * and never when the user's own memory photo is there.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';

const mockDetails = jest.fn((_args: unknown) => ({ data: undefined, error: null }));
jest.mock('@/api/places', () => ({ usePlaceDetails: (args: unknown) => mockDetails(args) }));
jest.mock('@/api/place-photos', () => ({ usePlacePhotoUrl: () => ({ url: null }) }));

// eslint-disable-next-line import/first
import { PlaceThumb, categoryIcon } from '../PlaceThumb';

describe('categoryIcon', () => {
  it.each([
    ['museum', 'landmark'],
    ['Religious Site', 'landmark'],
    ['tourist_attraction', 'camera'],
    ['Market', 'shopping-bag'],
    ['Seaside Promenade', 'waves'],
    ['Viewpoint', 'binoculars'],
    ['Zoo', 'paw-print'],
    ['family_attraction', 'ferris-wheel'],
    ['Archaeological Site', 'castle'],
    ['restaurant', 'utensils'],
    ['nightlife', 'wine'],
    ['Park', 'trees'],
    ['Transport', 'train-front'],
    ['hotel', 'bed'],
    [null, 'map-pin'],
    ['Something else', 'map-pin'],
  ])('%s → %s', (category, icon) => {
    expect(categoryIcon(category)).toBe(icon);
  });
});

describe('PlaceThumb', () => {
  it('renders the tile without asking Google for an unseen row', () => {
    mockDetails.mockClear();
    const { toJSON } = render(
      <ThemeProvider>
        <PlaceThumb dayIndex={1} category="Market" size={44} googlePlaceId="gp-1" />
      </ThemeProvider>,
    );
    expect(toJSON()).toBeTruthy();
    expect(mockDetails).not.toHaveBeenCalled();
  });

  it('shows the own memory photo and skips Google entirely', () => {
    mockDetails.mockClear();
    const { UNSAFE_root } = render(
      <ThemeProvider>
        <PlaceThumb dayIndex={0} category="museum" size={52} googlePlaceId="gp-1" memoryThumbUri="https://x/thumb.jpg" />
      </ThemeProvider>,
    );
    const uris = UNSAFE_root.findAll(
      (n: { props: { source?: { uri?: string } } }) => n.props.source?.uri === 'https://x/thumb.jpg',
    );
    expect(uris.length).toBeGreaterThan(0);
    expect(mockDetails).not.toHaveBeenCalled();
  });
});
