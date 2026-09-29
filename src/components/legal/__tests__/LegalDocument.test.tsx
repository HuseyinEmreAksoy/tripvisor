/**
 * Legal pages (M5 Y1.4): English is binding. In Turkish the page is translated,
 * says so visibly, and can show the English original in place.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n, setLanguagePreference } from '@/i18n';
import { LegalDocument, toLegalSections } from '../LegalDocument';
import { LegalLinks } from '../LegalLinks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => false, replace: jest.fn() }),
}));

function renderDoc(doc: 'privacy' | 'terms') {
  return render(
    <ThemeProvider>
      <LegalDocument doc={doc} />
    </ThemeProvider>,
  );
}

async function useTurkish() {
  await act(async () => {
    await setLanguagePreference('tr');
  });
}

afterEach(async () => {
  mockPush.mockClear();
  await act(async () => {
    await setLanguagePreference('system');
  });
});

describe('LegalDocument', () => {
  it('renders the English original with no translation notice', () => {
    const { getByText, queryByTestId, getByRole } = renderDoc('privacy');
    expect(getByText(i18n.t('legal:privacy.title'))).toBeTruthy();
    expect(getByText('Who we are')).toBeTruthy();
    expect(getByText('Last updated September 29, 2026')).toBeTruthy();
    // The contact address is interpolated into the "Ask" bullet.
    expect(getByText(/emailing h\.emreaksoy@gmail\.com/)).toBeTruthy();
    expect(queryByTestId('legal-translation-note')).toBeNull();
    fireEvent.press(getByRole('link', { name: i18n.t('legal:privacy.related') }));
    expect(mockPush).toHaveBeenCalledWith('/legal/terms');
  });

  it('shows the Turkish translation with a visible "English prevails" notice', async () => {
    const { getByText, getByTestId } = renderDoc('terms');
    await useTurkish();
    expect(getByText('Kullanım koşulları')).toBeTruthy();
    expect(getByText('Son güncelleme: 29 Eylül 2026')).toBeTruthy();
    expect(getByTestId('legal-translation-note')).toBeTruthy();
    expect(getByText(/İngilizce sürüm geçerlidir/)).toBeTruthy();
    expect(getByText('Geri')).toBeTruthy();
  });

  it('toggles to the English original without changing the app language', async () => {
    const { getByRole, getByText } = renderDoc('privacy');
    await useTurkish();
    fireEvent.press(getByRole('link', { name: 'İngilizce aslını oku' }));
    expect(getByText('Privacy policy')).toBeTruthy();
    expect(getByText('Who we are')).toBeTruthy();
    expect(getByText('Şu anda İngilizce aslını okuyorsun.')).toBeTruthy();
    expect(i18n.language).toBe('tr');
    fireEvent.press(getByRole('link', { name: 'Türkçe çeviriye dön' }));
    expect(getByText('Gizlilik politikası')).toBeTruthy();
  });

  it('has the same number of sections in both languages', () => {
    for (const doc of ['privacy', 'terms'] as const) {
      const en = toLegalSections(i18n.t(`legal:${doc}.sections`, { lng: 'en', returnObjects: true, email: 'x' }));
      const tr = toLegalSections(i18n.t(`legal:${doc}.sections`, { lng: 'tr', returnObjects: true, email: 'x' }));
      expect(en.length).toBeGreaterThan(5);
      expect(tr).toHaveLength(en.length);
      tr.forEach((s, i) => {
        expect(s.bullets?.length ?? 0).toBe(en[i]!.bullets?.length ?? 0);
        expect(s.paragraphs?.length ?? 0).toBe(en[i]!.paragraphs?.length ?? 0);
      });
    }
  });

  it('ignores malformed translation data instead of crashing', () => {
    expect(toLegalSections('nope')).toEqual([]);
    expect(toLegalSections([{ heading: 'A', bullets: ['x', 3, ''] }, { nope: true }])).toEqual([
      { heading: 'A', bullets: ['x'], paragraphs: undefined },
    ]);
  });
});

describe('LegalLinks', () => {
  it('reads as one sentence with both links, in either language', async () => {
    const { getByRole, rerender } = render(
      <ThemeProvider>
        <LegalLinks variant="signUp" />
      </ThemeProvider>,
    );
    fireEvent.press(getByRole('link', { name: 'Privacy policy' }));
    expect(mockPush).toHaveBeenCalledWith('/legal/privacy');
    await useTurkish();
    rerender(
      <ThemeProvider>
        <LegalLinks variant="signUp" />
      </ThemeProvider>,
    );
    fireEvent.press(getByRole('link', { name: 'Kullanım koşullarını' }));
    expect(mockPush).toHaveBeenLastCalledWith('/legal/terms');
  });
});
