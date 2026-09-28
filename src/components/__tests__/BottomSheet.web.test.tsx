/**
 * @jest-environment jsdom
 *
 * BottomSheet.web — focus/keyboard effect must key on `visible` only.
 * Call sites pass inline `onClose` arrows; re-running the effect on every
 * parent render used to re-focus the sheet and steal the caret.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '@/theme';
import { BottomSheet } from '../BottomSheet.web';

function sheet(onClose: () => void, visible = true) {
  return (
    <ThemeProvider>
      <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Test sheet">
        <Text>Body</Text>
      </BottomSheet>
    </ThemeProvider>
  );
}

const keydownAdds = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => c[0] === 'keydown').length;

describe('BottomSheet.web', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not re-run the focus effect when only onClose identity changes', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const { rerender } = render(sheet(() => {}));
    expect(keydownAdds(add)).toBe(1);
    rerender(sheet(() => {}));
    rerender(sheet(() => {}));
    expect(keydownAdds(add)).toBe(1);
  });

  it('Escape calls the latest onClose', () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = render(sheet(first));
    rerender(sheet(latest));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('backdrop press closes', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(sheet(onClose));
    fireEvent.press(getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
