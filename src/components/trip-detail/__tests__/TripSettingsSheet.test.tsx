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

const mockUpdateMutate = jest.fn(async (_patch: unknown) => 'trip-1');
const mockWarm = jest.fn(async (_vars: unknown) => ({ needs: [], warmed: [], failed: [], quotaExceeded: false, offline: false, home: 'EUR' }));
let mockExpenses: unknown[] = [];
const mockFetchFxRate = jest.fn<(from: string, to: string, date?: string) => Promise<{ rate: number }>>();
jest.mock('@/api/fx', () => ({
  fetchFxRate: (from: string, to: string, date?: string) => mockFetchFxRate(from, to, date),
  useFxCurrencies: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock('@/api/trip-expenses', () => ({
  useTripExpenses: () => ({ data: mockExpenses }),
  useWarmFxForTrip: () => ({ mutateAsync: mockWarm }),
}));
jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn(), error: jest.fn() },
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
  return { DeleteTripError, useUpdateTrip: () => ({ mutate: mockUpdateMutate, mutateAsync: mockUpdateMutate }) };
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

describe('TripSettingsSheet — home currency change (F3 + Y3.2)', () => {
  function renderSheet(totalBudget: number | null, isOwner = true) {
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
          isOwner={isOwner}
          coverPhotoPlaceId={null}
          onDelete={jest.fn()}
          deleting={false}
        />
      </ThemeProvider>,
    );
  }

  function reset() {
    mockUpdateMutate.mockClear();
    mockWarm.mockClear();
    mockFetchFxRate.mockReset();
    mockExpenses = [];
  }

  it('rounds to the target currency minor units', () => {
    expect(convertBudget(50000, 0.02, 'EUR')).toBe(1000);
    expect(convertBudget(100, 1.23456, 'USD')).toBe(123.46);
    expect(convertBudget(10, 161.234, 'JPY')).toBe(1612);
    expect(convertBudget(10, 0.3079, 'KWD')).toBe(3.079);
  });

  it('asks for confirmation, then writes the converted budget with the new currency and warms past rates', async () => {
    reset();
    mockFetchFxRate.mockResolvedValue({ rate: 0.02 });
    mockExpenses = [
      { id: 'a', amount: 20, currency: 'USD', fx_rate: 34, fx_home_currency: 'TRY', fx_date: '2026-09-01' },
      { id: 'b', amount: 5, currency: 'EUR', fx_rate: 40, fx_home_currency: 'TRY', fx_date: '2026-09-02' },
    ];
    const { getByRole, getByText } = renderSheet(50000);
    fireEvent.press(getByRole('radio', { name: 'EUR, Euro' }));
    // Nothing is written before the confirm; the panel explains the re-derivation.
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(getByText(i18n.t('money:homeChange.title', { code: 'EUR' }))).toBeTruthy();
    expect(getByText(i18n.t('money:homeChange.rederive', { count: 1, to: 'EUR' }))).toBeTruthy();
    expect(getByText(i18n.t('money:homeChange.alreadyHome', { count: 1, to: 'EUR' }))).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByRole('button', { name: i18n.t('money:homeChange.confirm', { code: 'EUR' }) }));
    });
    expect(mockFetchFxRate).toHaveBeenCalledWith('TRY', 'EUR', 'latest');
    expect(mockUpdateMutate).toHaveBeenCalledWith({ currency: 'EUR', total_budget: 1000 });
    expect(mockWarm).toHaveBeenCalledWith({ homeCurrency: 'EUR' });
    expect(getByText(i18n.t('money:homeChange.done', { code: 'EUR' }))).toBeTruthy();
  });

  it('keeps the old currency when no rate is reachable for the budget', async () => {
    reset();
    mockFetchFxRate.mockRejectedValue(new Error('offline'));
    const { getByRole, getByText } = renderSheet(50000);
    fireEvent.press(getByRole('radio', { name: 'EUR, Euro' }));
    await act(async () => {
      fireEvent.press(getByRole('button', { name: i18n.t('money:homeChange.confirm', { code: 'EUR' }) }));
    });
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(getByText(i18n.t('trip:settingsSheet.currencyFxFailed')).props.accessibilityRole).toBe('alert');
  });

  it('without a budget only the currency changes; cancel writes nothing', async () => {
    reset();
    const { getByRole, queryByText } = renderSheet(null);
    fireEvent.press(getByRole('radio', { name: 'USD, US Dollar' }));
    fireEvent.press(getByRole('button', { name: 'Cancel' }));
    expect(queryByText(i18n.t('money:homeChange.title', { code: 'USD' }))).toBeNull();
    fireEvent.press(getByRole('radio', { name: 'EUR, Euro' }));
    await act(async () => {
      fireEvent.press(getByRole('button', { name: i18n.t('money:homeChange.confirm', { code: 'EUR' }) }));
    });
    expect(mockFetchFxRate).not.toHaveBeenCalled();
    expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateMutate).toHaveBeenCalledWith({ currency: 'EUR' });
  });

  it('editors and viewers see the home currency read-only', () => {
    reset();
    const { queryByRole, getByText } = renderSheet(null, false);
    expect(queryByRole('radio', { name: 'EUR, Euro' })).toBeNull();
    expect(getByText(i18n.t('money:settings.ownerOnly'))).toBeTruthy();
    expect(getByText('TRY — Turkish Lira')).toBeTruthy();
  });
});
