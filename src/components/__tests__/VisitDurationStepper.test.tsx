import { render, fireEvent } from '@testing-library/react-native';
import { VisitDurationStepper, formatMinutes } from '../VisitDurationStepper';
import { ThemeProvider } from '@/theme';

function renderS(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('VisitDurationStepper', () => {
  it('announces the current value via adjustable role', () => {
    const { getByRole } = renderS(
      <VisitDurationStepper minutes={60} onChange={() => {}} />,
    );
    const group = getByRole('adjustable');
    expect(group.props.accessibilityValue).toMatchObject({ now: 60, min: 15, max: 720 });
  });

  it('increments by stepMinutes on + press', () => {
    const onChange = jest.fn();
    const { getByRole } = renderS(
      <VisitDurationStepper minutes={60} onChange={onChange} stepMinutes={15} />,
    );
    fireEvent.press(getByRole('button', { name: 'Increase Visit duration by 15 minutes' }));
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('decrements by stepMinutes on − press', () => {
    const onChange = jest.fn();
    const { getByRole } = renderS(
      <VisitDurationStepper minutes={60} onChange={onChange} stepMinutes={15} />,
    );
    fireEvent.press(getByRole('button', { name: 'Decrease Visit duration by 15 minutes' }));
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it('clamps at minMinutes', () => {
    const onChange = jest.fn();
    const { getByRole } = renderS(
      <VisitDurationStepper minutes={15} onChange={onChange} stepMinutes={15} minMinutes={15} />,
    );
    const dec = getByRole('button', { name: 'Decrease Visit duration by 15 minutes' });
    expect(dec.props.accessibilityState.disabled).toBe(true);
  });

  it('clamps at maxMinutes', () => {
    const onChange = jest.fn();
    const { getByRole } = renderS(
      <VisitDurationStepper
        minutes={720}
        onChange={onChange}
        stepMinutes={15}
        maxMinutes={720}
      />,
    );
    const inc = getByRole('button', { name: 'Increase Visit duration by 15 minutes' });
    expect(inc.props.accessibilityState.disabled).toBe(true);
  });

  it('formatMinutes handles common cases', () => {
    expect(formatMinutes(15)).toBe('15 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(180)).toBe('3 h');
  });
});
