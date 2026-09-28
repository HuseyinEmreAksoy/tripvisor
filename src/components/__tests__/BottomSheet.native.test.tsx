/**
 * BottomSheet.native — X3.1 keyboard + edge-to-edge pass. Renders without a
 * SafeAreaProvider (insets degrade to zero), keeps the backdrop-close
 * contract, and draws the modal under translucent system bars.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';
import { ThemeProvider } from '@/theme';
import { BottomSheet } from '../BottomSheet.native';

function sheet(onClose: () => void) {
  return (
    <ThemeProvider>
      <BottomSheet visible onClose={onClose} accessibilityLabel="Test sheet">
        <Text>Body</Text>
      </BottomSheet>
    </ThemeProvider>
  );
}

describe('BottomSheet.native', () => {
  it('renders children without a SafeAreaProvider', () => {
    const { getByText } = render(sheet(() => {}));
    expect(getByText('Body')).toBeTruthy();
  });

  it('backdrop press closes', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(sheet(onClose));
    fireEvent.press(getByLabelText('Close sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('draws edge-to-edge (translucent status + navigation bars)', () => {
    const { UNSAFE_getByType } = render(sheet(() => {}));
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
  });
});
