/**
 * AccommodationEditSheet — Google Places notices (2026-09-29 security
 * follow-up, audit #2 per-user Places quota). A spent daily quota must read
 * as "limit reached, try tomorrow" (manual address still works), never as
 * the maps-setup banner. Places + save hooks are mocked at the boundary.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import { AccommodationEditSheet } from '../AccommodationEditSheet';

let mockAutocompleteError: Error | null = null;
const mockSuggestions = [{ placeId: 'g1', mainText: 'Alfama Flat', secondaryText: 'Lisbon' }];

jest.mock('@/api', () => ({
  useCreateTripAccommodation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateTripAccommodation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/api/places', () => {
  class PlacesError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    PlacesError,
    isPlacesQuotaExceeded: (e: unknown) => e instanceof PlacesError && e.code === 'quota_exceeded',
    usePlacesAutocomplete: () => ({
      data: mockAutocompleteError ? [] : mockSuggestions,
      isFetching: false,
      error: mockAutocompleteError,
    }),
    usePlaceDetails: () => ({ data: undefined, isLoading: false, error: null }),
  };
});
// The native date picker module isn't needed for these notices.
jest.mock('@/components/DateField', () => ({ DateField: () => null }));
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

const { PlacesError: MockPlacesError } = jest.requireMock<{
  PlacesError: new (code: string, message: string, status: number) => Error;
}>('@/api/places');

function renderSheet() {
  return render(
    <ThemeProvider>
      <AccommodationEditSheet tripId="trip-1" accommodation={null} visible onClose={jest.fn()} />
    </ThemeProvider>,
  );
}

function search(utils: ReturnType<typeof renderSheet>) {
  fireEvent.changeText(
    utils.getByLabelText('Search for a hotel or address using Google Places'),
    'alfama',
  );
}

describe('AccommodationEditSheet — Places notices', () => {
  beforeEach(() => {
    mockAutocompleteError = null;
  });

  it('quota_exceeded shows the daily-limit notice, not the setup banner', () => {
    mockAutocompleteError = new MockPlacesError('quota_exceeded', 'Daily limit', 429);
    const utils = renderSheet();
    search(utils);
    const notice = utils.getByText(i18n.t('stays:edit.placesQuota'));
    expect(notice).toBeTruthy();
    expect(utils.queryByText(/not configured/i)).toBeNull();
    expect(utils.queryByRole('button', { name: /choose/i })).toBeNull();
  });

  it('a setup failure still shows the setup banner', () => {
    mockAutocompleteError = new MockPlacesError('server_misconfigured', 'No key', 500);
    const utils = renderSheet();
    search(utils);
    expect(utils.getByText(/Google Places not configured/)).toBeTruthy();
    expect(utils.queryByText(/daily place search limit/i)).toBeNull();
  });

  it('lists suggestions when Places works', () => {
    const utils = renderSheet();
    search(utils);
    expect(utils.getByRole('button', { name: 'Choose Alfama Flat' })).toBeTruthy();
    expect(utils.queryByRole('alert')).toBeNull();
  });
});
