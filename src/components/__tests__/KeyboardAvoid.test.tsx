/**
 * KeyboardAvoid — the KAV frame is measured relative to <Screen>'s
 * SafeAreaView, so the vertical offset must include the top inset (plus any
 * caller-supplied fixed header) or the view under-lifts on native.
 */
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { KeyboardAvoidingView, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../KeyboardAvoid';

const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

describe('KeyboardAvoid', () => {
  it('renders children without a SafeAreaProvider (offset degrades to 0)', () => {
    const { getByText, UNSAFE_getByType } = render(
      <KeyboardAvoid>
        <Text>Field</Text>
      </KeyboardAvoid>,
    );
    expect(getByText('Field')).toBeTruthy();
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(0);
  });

  it('offsets by the top safe-area inset', () => {
    const { UNSAFE_getByType } = render(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <KeyboardAvoid>
          <Text>Field</Text>
        </KeyboardAvoid>
      </SafeAreaInsetsContext.Provider>,
    );
    const kav = UNSAFE_getByType(KeyboardAvoidingView);
    expect(kav.props.keyboardVerticalOffset).toBe(47);
    expect(kav.props.behavior).toBe('padding');
  });

  it('adds headerOffset for callers with a fixed header', () => {
    const { UNSAFE_getByType } = render(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <KeyboardAvoid headerOffset={56}>
          <Text>Field</Text>
        </KeyboardAvoid>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(103);
  });
});
