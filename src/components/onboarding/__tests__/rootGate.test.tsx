/**
 * Root route gate (v2 M4 X3.2): the first-run intro never traps a returning
 * or deep-linked user.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '@/theme';
import { PENDING_REDIRECT_KEY } from '@/lib/pendingRedirect';
import { ONBOARDING_SEEN_KEY } from '@/components/onboarding';
// app/ holds routes only (expo-router bundles every file there), so the root
// gate's test lives with the onboarding module it wires up.
import Root from '../../../../app/index';

let mockSession: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };

jest.mock('@/api', () => ({
  useSession: () => mockSession,
}));
jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  };
});

function renderRoot() {
  return render(
    <ThemeProvider>
      <Root />
    </ThemeProvider>,
  );
}

describe('app/index gate', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockSession = { data: null, isLoading: false };
  });

  it('shows the intro to a signed-out first visit', async () => {
    const { findByRole } = renderRoot();
    expect(await findByRole('button', { name: 'Skip intro' })).toBeTruthy();
  });

  it('sends a signed-out visitor who has seen it straight to login', async () => {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    const { findByText } = renderRoot();
    expect(await findByText('redirect:/login')).toBeTruthy();
  });

  it('skips the intro when an invite redirect is pending', async () => {
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, JSON.stringify({ path: '/invite/tok', at: Date.now() }));
    const { findByText } = renderRoot();
    expect(await findByText('redirect:/login')).toBeTruthy();
  });

  it('a signed-in user (magic-link landing) goes to the pending path, never the intro', async () => {
    mockSession = { data: { user: { id: 'u1' } }, isLoading: false };
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, JSON.stringify({ path: '/invite/tok', at: Date.now() }));
    const { findByText, queryByRole } = renderRoot();
    expect(await findByText('redirect:/invite/tok')).toBeTruthy();
    expect(queryByRole('button', { name: 'Skip intro' })).toBeNull();
    expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1');
  });
});

