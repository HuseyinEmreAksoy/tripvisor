/**
 * Profile → Travel preferences (M5 Y3.4): interests and the default home
 * currency save through useUpdateUserPreferences; the language mirror is
 * mounted.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('../useAdoptPendingInterests', () => ({ useAdoptPendingInterests: () => undefined }));
jest.mock('@/api/fx', () => ({
  useFxCurrencies: () => ({ data: { currencies: [{ code: 'CHF', ecb: true }, { code: 'CZK', ecb: true }] } }),
}));

const mockMutate = jest.fn();
const mockMirror = jest.fn();
jest.mock('@/api/preferences', () => ({
  useUserPreferences: () => ({
    data: { locale: null, home_currency: 'TRY', interests: ['food'], saved: true, updated_at: null },
    isLoading: false,
  }),
  useUpdateUserPreferences: () => ({ mutate: mockMutate, isError: false }),
  useLanguagePreferenceMirror: () => mockMirror(),
}));

// eslint-disable-next-line import/first
import { PreferencesSection } from '../PreferencesSection';

const t = i18n.t.bind(i18n);
const renderIt = () => render(<ThemeProvider><PreferencesSection /></ThemeProvider>);

describe('PreferencesSection', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('mounts the language mirror', () => {
    renderIt();
    expect(mockMirror).toHaveBeenCalled();
  });

  it('saves interests as a whole list', () => {
    const { getByRole } = renderIt();
    expect(getByRole('checkbox', { name: t('discover:interests.food') }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    fireEvent.press(getByRole('checkbox', { name: t('discover:interests.nature') }));
    expect(mockMutate).toHaveBeenCalledWith({ interests: ['food', 'nature'] });
  });

  it('saves the default home currency, including one found by search', () => {
    const { getByRole, getByLabelText } = renderIt();
    expect(getByRole('radio', { name: 'TRY' }).props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    fireEvent.press(getByRole('radio', { name: 'EUR' }));
    expect(mockMutate).toHaveBeenCalledWith({ home_currency: 'EUR' });
    fireEvent.press(getByRole('radio', { name: t('discover:prefs.currencyNone') }));
    expect(mockMutate).toHaveBeenCalledWith({ home_currency: null });
    fireEvent.press(getByRole('button', { name: t('discover:prefs.currencyMore') }));
    fireEvent.changeText(getByLabelText(t('discover:prefs.currencySearchA11y')), 'cz');
    fireEvent.press(getByRole('radio', { name: 'CZK' }));
    expect(mockMutate).toHaveBeenCalledWith({ home_currency: 'CZK' });
  });
});
