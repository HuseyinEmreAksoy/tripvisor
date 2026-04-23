import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';
import { ThemeProvider } from '@/theme';

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

  it('announces busy state while loading', () => {
    const { getByRole } = renderB(<Button label="Go" onPress={() => {}} loading />);
    const btn = getByRole('button', { name: 'Go' });
    expect(btn.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
