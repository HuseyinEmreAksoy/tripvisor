/**
 * ReactionChip — X3.1: Lucide thumbs replace the emoji; radios keep their
 * labels and the tap-active-to-clear contract.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { ReactionChip } from '../ReactionChip';

jest.mock('@/lib/haptics', () => ({ haptics: { select: jest.fn(), tap: jest.fn() } }));

describe('ReactionChip', () => {
  it('rates and un-rates', () => {
    const onChange = jest.fn();
    const { getByLabelText, rerender } = render(
      <ThemeProvider>
        <ReactionChip reaction={null} onChange={onChange} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Like this place'));
    expect(onChange).toHaveBeenLastCalledWith('liked');

    rerender(
      <ThemeProvider>
        <ReactionChip reaction="liked" onChange={onChange} />
      </ThemeProvider>,
    );
    expect(getByLabelText('Like this place').props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(getByLabelText('Like this place'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.press(getByLabelText('Dislike this place'));
    expect(onChange).toHaveBeenLastCalledWith('disliked');
  });
});
