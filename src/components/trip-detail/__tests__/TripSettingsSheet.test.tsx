/**
 * TripSettingsSheet — delete-failure copy (2026-09-29 security follow-up).
 *
 * `delete-trip` removes the trip's Storage files before the row; when that
 * fails (`storage_cleanup_failed`) nothing is deleted, and the copy must say
 * so. The sheet itself renders whatever `deleteError` the route passes, so
 * the mapping helper is what's under test, plus one render of the owner's
 * danger zone. The API layer and the heavy cover sections are mocked.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { TripSettingsSheet, deleteTripErrorMessage } from '../TripSettingsSheet';

jest.mock('@/api', () => {
  class DeleteTripError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { DeleteTripError, useUpdateTrip: () => ({ mutate: jest.fn() }) };
});
jest.mock('@/api/ics', () => ({ useDownloadTripIcs: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('../CoverPhotoSection', () => ({ CoverPhotoSection: () => null }));
jest.mock('../CoverPickerModal', () => ({ CoverPickerModal: () => null }));
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

const { DeleteTripError: MockDeleteTripError } = jest.requireMock<{
  DeleteTripError: new (code: string, message: string, status: number) => Error;
}>('@/api');

describe('deleteTripErrorMessage', () => {
  it('storage_cleanup_failed says nothing was deleted', () => {
    expect(deleteTripErrorMessage(new MockDeleteTripError('storage_cleanup_failed', 'x', 500))).toBe(
      "Couldn't remove the trip's files — nothing was deleted. Try again.",
    );
  });

  it('not_owner explains who can delete', () => {
    expect(deleteTripErrorMessage(new MockDeleteTripError('not_owner', 'x', 403))).toBe(
      'Only the trip owner can delete this trip.',
    );
  });

  it('other codes and plain network errors get the generic copy', () => {
    const generic = "Couldn't delete this trip. Check your connection and try again.";
    expect(deleteTripErrorMessage(new MockDeleteTripError('db_error', 'x', 500))).toBe(generic);
    expect(deleteTripErrorMessage(new Error('Failed to fetch'))).toBe(generic);
    expect(deleteTripErrorMessage(undefined)).toBe(generic);
  });
});

describe('TripSettingsSheet — danger zone', () => {
  it('announces the delete error under the owner’s Delete button', () => {
    const message = deleteTripErrorMessage(new MockDeleteTripError('storage_cleanup_failed', 'x', 500));
    const { getByRole, getByText } = render(
      <ThemeProvider>
        <TripSettingsSheet
          visible
          onClose={jest.fn()}
          tripId="trip-1"
          startDate="2026-10-01"
          endDate="2026-10-03"
          dailyHoursBudget={8}
          transportMode="walking"
          currency="EUR"
          hasPlaces
          canEdit
          isOwner
          coverPhotoPlaceId={null}
          onDelete={jest.fn()}
          deleting={false}
          deleteError={message}
        />
      </ThemeProvider>,
    );
    expect(getByRole('button', { name: /delete trip/i })).toBeTruthy();
    expect(getByText(message).props.accessibilityRole).toBe('alert');
  });
});
