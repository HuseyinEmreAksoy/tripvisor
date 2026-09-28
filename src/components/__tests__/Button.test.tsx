import { describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';
import { ThemeProvider } from '@/theme';
import { haptics } from '@/lib/haptics';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

function renderB(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('Button', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    const { getByRole } = renderB(<Button label="Go" onPress={onPress} />);
    fireEvent.press(getByRole('button', { name: 'Go' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = renderB(<Button label="Go" onPress={onPress} disabled />);
    fireEvent.press(getByRole('button', { name: 'Go' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire onPress while loading', () => {
    const onPress = jest.fn();
    const { getByRole } = renderB(<Button label="Go" onPress={onPress} loading />);
    fireEvent.press(getByRole('button', { name: 'Go' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ticks a haptic on primary press by default (X3.1)', () => {
    jest.mocked(haptics.tap).mockClear();
    const { getByRole } = renderB(<Button label="Save" onPress={() => {}} />);
    fireEvent.press(getByRole('button', { name: 'Save' }));
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it('stays silent for secondary unless opted in', () => {
    jest.mocked(haptics.tap).mockClear();
    const { getByRole } = renderB(
      <>
        <Button variant="secondary" label="Skip" onPress={() => {}} />
        <Button variant="ghost" label="More" haptic onPress={() => {}} />
      </>,
    );
    fireEvent.press(getByRole('button', { name: 'Skip' }));
    expect(haptics.tap).not.toHaveBeenCalled();
    fireEvent.press(getByRole('button', { name: 'More' }));
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it('announces busy state while loading', () => {
    const { getByRole } = renderB(<Button label="Go" onPress={() => {}} loading />);
    const btn = getByRole('button', { name: 'Go' });
    expect(btn.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
