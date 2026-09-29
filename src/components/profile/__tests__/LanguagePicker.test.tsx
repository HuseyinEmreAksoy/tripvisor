/**
 * Profile → Language: switching re-renders the UI in the new language without
 * a restart, persists the choice, and System goes back to the device language.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '@/theme';
import { formatMoney, i18n, LOCALE_STORAGE_KEY, setLanguagePreference, useT } from '@/i18n';
import { LanguagePicker } from '../LanguagePicker';

/** Stand-in for any other screen: a translated label plus formatted money. */
function Probe() {
  const { t: tx } = useT('shell');
  return <Text testID="probe">{`${tx('tabs.trips')} ${formatMoney(1234.5, 'TRY')}`}</Text>;
}

function setup() {
  return render(
    <ThemeProvider>
      <LanguagePicker />
      <Probe />
    </ThemeProvider>,
  );
}

const plain = (s: unknown) => String(s).replace(/[  ]/g, ' ');

describe('LanguagePicker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(async () => {
      await setLanguagePreference('system');
    });
  });

  it('starts on System (the device is English in tests)', () => {
    const { getByLabelText, getByRole, getByTestId } = setup();
    expect(getByRole('radio', { name: i18n.t('profile:language.systemA11y', { language: 'English' }) }).props
      .accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText(i18n.t('profile:language.groupA11y')).props.accessibilityRole).toBe('radiogroup');
    expect(plain(getByTestId('probe').props.children)).toBe('Trips TRY 1,234.50');
  });

  it('switches the whole app to Turkish live and persists it', async () => {
    const { getByLabelText, getByRole, getByTestId, findByText } = setup();
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Türkçe' }));
    });
    expect(i18n.language).toBe('tr');
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBe('tr');
    // Labels and number formatting re-render without a restart.
    expect(plain(getByTestId('probe').props.children)).toBe('Geziler ₺1.234,50');
    expect(await findByText('Sistem')).toBeTruthy();
    expect(getByRole('radio', { name: 'Türkçe' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Uygulama dili').props.accessibilityRole).toBe('radiogroup');
  });

  it('System clears the override and follows the device again', async () => {
    const { getByRole, getByTestId } = setup();
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Türkçe' }));
    });
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Sistem dili, şu an English' }));
    });
    expect(i18n.language).toBe('en');
    expect(await AsyncStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(plain(getByTestId('probe').props.children)).toBe('Trips TRY 1,234.50');
  });
});
