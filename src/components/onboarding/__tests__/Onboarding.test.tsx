import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView } from 'react-native';
import { ThemeProvider } from '@/theme';
import { PENDING_REDIRECT_KEY, PENDING_REDIRECT_TTL_MS } from '@/lib/pendingRedirect';
import { Onboarding } from '../Onboarding';
import { ONBOARDING_SEEN_KEY, markOnboardingSeen, shouldShowOnboarding } from '../onboardingFlag';

function setup() {
  const onFinish = jest.fn();
  const utils = render(
    <ThemeProvider>
      <Onboarding onFinish={onFinish} />
    </ThemeProvider>,
  );
  // The pager renders once it knows its width.
  fireEvent(utils.getByTestId('onboarding-pager'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 600, x: 0, y: 0 } },
  });
  return { ...utils, onFinish };
}

describe('Onboarding', () => {
  it('walks through the three cards and exits to signup', () => {
    const { getByRole, getByText, onFinish, queryByRole } = setup();
    expect(getByText('A first draft in seconds')).toBeTruthy();
    expect(queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.press(getByRole('button', { name: 'Next' }));
    expect(getByRole('button', { name: 'Back' })).toBeTruthy();
    fireEvent.press(getByRole('button', { name: 'Next' }));
    expect(queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.press(getByRole('button', { name: 'Create a free account' }));
    expect(onFinish).toHaveBeenCalledWith('signup');
  });

  it('Skip is always available and exits to login', () => {
    const { getByRole, onFinish } = setup();
    fireEvent.press(getByRole('button', { name: 'Skip intro' }));
    expect(onFinish).toHaveBeenCalledWith('login');
  });

  it('dots jump straight to a card', () => {
    const { getByRole, onFinish } = setup();
    fireEvent.press(getByRole('button', { name: /Go to card 3 of 3/ }));
    fireEvent.press(getByRole('button', { name: 'I already have an account' }));
    expect(onFinish).toHaveBeenCalledWith('login');
  });
});

describe('Onboarding dots during programmatic scroll', () => {
  const scrollEvent = (x: number) => ({
    nativeEvent: {
      contentOffset: { x, y: 0 },
      contentSize: { width: 1200, height: 600 },
      layoutMeasurement: { width: 400, height: 600 },
    },
  });

  it('ignores intermediate onScroll offsets after a dot jump, then follows user drags', () => {
    const { getByRole, UNSAFE_getByType } = setup();
    const dot3 = () => getByRole('button', { name: /Go to card 3 of 3/ });
    fireEvent.press(dot3());
    const pager = UNSAFE_getByType(ScrollView);
    // The animated scroll passes card 2 on its way — the dots must not flicker back.
    fireEvent.scroll(pager, scrollEvent(400));
    expect(dot3().props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    fireEvent(pager, 'momentumScrollEnd', scrollEvent(800));
    expect(dot3().props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    // A real swipe back is tracked again.
    fireEvent(pager, 'scrollBeginDrag', scrollEvent(800));
    fireEvent.scroll(pager, scrollEvent(400));
    expect(getByRole('button', { name: /Go to card 2 of 3/ }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });
});

describe('onboarding gate', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('shows on a fresh device', async () => {
    await expect(shouldShowOnboarding()).resolves.toBe(true);
  });

  it('never shows again once seen', async () => {
    await markOnboardingSeen();
    expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1');
    await expect(shouldShowOnboarding()).resolves.toBe(false);
  });

  it('is skipped while an invite/share redirect is pending', async () => {
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, JSON.stringify({ path: '/invite/abc', at: Date.now() }));
    await expect(shouldShowOnboarding()).resolves.toBe(false);
  });

  it('still shows when the pending redirect has expired or is garbage', async () => {
    await AsyncStorage.setItem(
      PENDING_REDIRECT_KEY,
      JSON.stringify({ path: '/invite/abc', at: Date.now() - PENDING_REDIRECT_TTL_MS - 1000 }),
    );
    await expect(shouldShowOnboarding()).resolves.toBe(true);
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, 'not-json');
    await expect(shouldShowOnboarding()).resolves.toBe(true);
    await AsyncStorage.setItem(PENDING_REDIRECT_KEY, JSON.stringify({ path: '//evil.com', at: Date.now() }));
    await expect(shouldShowOnboarding()).resolves.toBe(true);
  });
});
