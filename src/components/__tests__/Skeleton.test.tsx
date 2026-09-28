import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { Skeleton, SkeletonGroup } from '../Skeleton';

describe('Skeleton', () => {
  it('announces one labelled busy group and hides the blocks', () => {
    const { getByRole, getAllByTestId } = render(
      <ThemeProvider>
        <SkeletonGroup label="Loading trips">
          <Skeleton height={20} />
          <Skeleton height={120} radius="xl" />
        </SkeletonGroup>
      </ThemeProvider>,
    );
    const group = getByRole('progressbar', { name: 'Loading trips' });
    expect(group.props.accessibilityState).toMatchObject({ busy: true });
    const blocks = getAllByTestId('skeleton-block', { includeHiddenElements: true });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.props.accessibilityElementsHidden).toBe(true);
  });
});
