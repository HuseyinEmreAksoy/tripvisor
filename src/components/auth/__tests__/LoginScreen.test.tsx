/**
 * Sign-in screen (app/(auth)/login.tsx) in the app language: a Turkish device
 * opens it in Turkish, and server errors are shown translated.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { i18n, setLanguagePreference } from '@/i18n';
// app/ holds routes only (expo-router bundles every file there), so the
// screen's test lives with the auth helpers it uses.
import Login from '../../../../app/(auth)/login';

const mockMutateAsync = jest.fn<(email: string) => Promise<void>>();
let mockError: unknown = null;

jest.mock('@/api', () => ({
  useAuthCallbackError: () => ({ error: null, clear: jest.fn() }),
  useSignInWithMagicLink: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: mockError,
    reset: jest.fn(),
  }),
}));
jest.mock('@/hooks/useGoogleSignIn', () => ({
  useGoogleSignIn: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));
// The @/components barrel pulls in sync-status UI that reads NetInfo.
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => 'mobile' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

function renderLogin() {
  return render(
    <ThemeProvider>
      <Login />
    </ThemeProvider>,
  );
}

afterEach(async () => {
  mockError = null;
  mockMutateAsync.mockReset();
  await act(async () => {
    await setLanguagePreference('system');
  });
});

describe('Login screen', () => {
  it('renders in English on an English device, with a single "or" divider', () => {
    const { getByText, getAllByText, getByRole } = renderLogin();
    expect(getByText(i18n.t('auth:login.title'))).toBeTruthy();
    expect(getByRole('button', { name: i18n.t('auth:google.continue') })).toBeTruthy();
    // The divider is decorative (hidden from screen readers), hence includeHiddenElements.
    expect(getAllByText(i18n.t('auth:google.orEmail'), { includeHiddenElements: true })).toHaveLength(1);
  });

  it('renders in Turkish when the app language is Turkish', async () => {
    await act(async () => {
      await setLanguagePreference('tr');
    });
    const { getByText, getByRole } = renderLogin();
    expect(getByText('Giriş yap')).toBeTruthy();
    expect(getByText('Planla')).toBeTruthy();
    expect(getByRole('button', { name: 'Google ile devam et' })).toBeTruthy();
    expect(getByRole('button', { name: 'Giriş bağlantısını gönder' })).toBeTruthy();
    expect(getByRole('link', { name: 'Gizlilik politikasını' })).toBeTruthy();
  });

  it('shows a translated message instead of the raw Supabase error', async () => {
    mockError = { status: 429, message: 'For security purposes, you can only request this after 60 seconds.' };
    await act(async () => {
      await setLanguagePreference('tr');
    });
    const { getByText, queryByText } = renderLogin();
    expect(getByText('Çok fazla deneme yapıldı. Bir dakika bekleyip tekrar dene.')).toBeTruthy();
    expect(queryByText(/security purposes/)).toBeNull();
  });

  it('confirms the sent link with the address in the sentence', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const { getByLabelText, getByRole, findByText } = renderLogin();
    fireEvent.changeText(getByLabelText(i18n.t('auth:email.label')), 'ada@example.com');
    const submit = getByRole('button', { name: i18n.t('auth:login.submit') });
    await waitFor(() => expect(submit.props.accessibilityState?.disabled).not.toBe(true));
    await act(async () => {
      fireEvent.press(submit);
    });
    expect(await findByText(i18n.t('auth:inbox.title'))).toBeTruthy();
    expect(await findByText('ada@example.com')).toBeTruthy();
  });
});
