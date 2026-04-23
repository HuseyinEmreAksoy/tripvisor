import { render } from '@testing-library/react-native';
import { EmptyState } from '../EmptyState';
import { ThemeProvider } from '@/theme';

describe('EmptyState', () => {
  it('renders title and description', () => {
    const { getByText } = render(
      <ThemeProvider>
        <EmptyState title="No trips yet" description="Create your first trip." />
      </ThemeProvider>,
    );
    expect(getByText('No trips yet')).toBeTruthy();
    expect(getByText('Create your first trip.')).toBeTruthy();
  });
});
