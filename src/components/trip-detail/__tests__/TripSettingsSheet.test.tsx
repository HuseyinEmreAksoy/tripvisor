/**
 * TripSettingsSheet — delete-failure copy (2026-09-29 security follow-up).
 *
 * `delete-trip` removes the trip's Storage files before the row; when that
 * fails (`storage_cleanup_failed`) nothing is deleted, and the copy must say
 * so. The route stores the message KEY (`deleteTripErrorKey`) and the sheet
 * translates it, so the mapping helper is what's under test, plus one render
 * of the owner's danger zone in both languages. The API layer and the heavy
 * cover sections are mocked.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n, setLanguagePreference } from '@/i18n';
import {
  TripSettingsSheet,
  convertBudget,
  deleteTripErrorKey,
  type DeleteTripErrorKey,
} from '../TripSettingsSheet';

const mockUpdateMutate = jest.fn();
const mockFetchFxRate = jest.fn<(from: string, to: string, date?: string) => Promise<{ rate: number }>>();
jest.mock('@/api/fx', () => ({
  fetchFxRate: (from: string, to: string, date?: string) => mockFetchFxRate(from, to, date),
}));

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
  return { DeleteTripError, useUpdateTrip: () => ({ mutate: mockUpdateMutate }) };
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

afterEach(async () => {
  await act(async () => {
    await setLanguagePreference('system');
  });
});

describe('deleteTripErrorKey', () => {
  it('storage_cleanup_failed says nothing was deleted', () => {
    const key = deleteTripErrorKey(new MockDeleteTripError('storage_cleanup_failed', 'x', 500));
    expect(key).toBe('delete.errors.storageCleanupFailed');
    expect(i18n.t(`trip:${key}`)).toBe('Couldn’t remove the trip’s files, so nothing was deleted. Try again.');
  });

  it('not_owner explains who can delete', () => {
    const key = deleteTripErrorKey(new MockDeleteTripError('not_owner', 'x', 403));
    expect(i18n.t(`trip:${key}`)).toBe('Only the trip owner can delete this trip.');
  });

  it('other codes and plain network errors get the generic copy', () => {
    const generic: DeleteTripErrorKey = 'delete.errors.generic';
    expect(deleteTripErrorKey(new MockDeleteTripError('db_error', 'x', 500))).toBe(generic);
    expect(deleteTripErrorKey(new Error('Failed to fetch'))).toBe(generic);
    expect(deleteTripErrorKey(undefined)).toBe(generic);
  });
});

describe('TripSettingsSheet — danger zone', () => {
  it('announces the delete error under the owner’s Delete button, in the app language', async () => {
    const key = deleteTripErrorKey(new MockDeleteTripError('storage_cleanup_failed', 'x', 500));
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
          deleteError={key}
        />
      </ThemeProvider>,
    );
    expect(getByRole('button', { name: /delete trip/i })).toBeTruthy();
    expect(getByText(i18n.t(`trip:${key}`)).props.accessibilityRole).toBe('alert');
    // The sheet holds the key, so switching language re-translates it.
    await act(async () => {
      await setLanguagePreference('tr');
    });
    expect(
      getByText('Gezinin dosyaları kaldırılamadı, bu yüzden hiçbir şey silinmedi. Tekrar dene.').props.accessibilityRole,
    ).toBe('alert');
  });
});

describe('TripSettingsSheet — home currency change converts the budget (F3)', () => {
  function renderSheet(totalBudget: number | null) {
    return render(
      <ThemeProvider>
        <TripSettingsSheet
          visible
          onClose={jest.fn()}
          tripId="trip-1"
          startDate="2026-10-01"
          endDate="2026-10-03"
          dailyHoursBudget={8}
          transportMode="walking"
          currency="TRY"
          totalBudget={totalBudget}
          hasPlaces
          canEdit
          isOwner
          coverPhotoPlaceId={null}
          onDelete={jest.fn()}
          deleting={false}
        />
      </ThemeProvider>,
    );
  }

  it('rounds to the target currency minor units', () => {
    expect(convertBudget(50000, 0.02, 'EUR')).toBe(1000);
    expect(convertBudget(100, 1.23456, 'USD')).toBe(123.46);
    expect(convertBudget(10, 161.234, 'JPY')).toBe(1612);
  });

  it('writes the converted budget together with the new currency', async () => {
    mockUpdateMutate.mockReset();
    mockFetchFxRate.mockResolvedValue({ rate: 0.02 });
    const { getByText } = renderSheet(50000);
    await act(async () => {
      fireEvent.press(getByText('EUR'));
    });
    expect(mockFetchFxRate).toHaveBeenCalledWith('TRY', 'EUR', 'latest');
    expect(mockUpdateMutate).toHaveBeenCalledWith({ currency: 'EUR', total_budget: 1000 });
  });

  it('keeps the old currency when no rate is reachable', async () => {
    mockUpdateMutate.mockReset();
    mockFetchFxRate.mockRejectedValue(new Error('offline'));
    const { getByText } = renderSheet(50000);
    await act(async () => {
      fireEvent.press(getByText('EUR'));
    });
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it('without a budget only the currency changes', async () => {
    mockUpdateMutate.mockReset();
    mockFetchFxRate.mockReset();
    const { getByText } = renderSheet(null);
    await act(async () => {
      fireEvent.press(getByText('EUR'));
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(mockUpdateMutate).toHaveBeenCalledWith({ currency: 'EUR' });
  });
});
