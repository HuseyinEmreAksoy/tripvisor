/**
 * EmptyState component — unit tests.
 *
 * Covers:
 *   - Renders title
 *   - Renders body when provided
 *   - CTA button shown only when both ctaLabel + onPress are provided
 *   - onPress fires when CTA tapped
 *   - accessibilityRole="summary" on root container
 *   - All four emptyStates variants render without throwing
 */
import { render, fireEvent } from '@testing-library/react-native';
import { EmptyState } from '../EmptyState';
import { ThemeProvider } from '@/theme';
import { noTrips, noPlaces, noSearchResults, searchPrompt } from '../emptyStates';

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('EmptyState', () => {
  it('renders the title', () => {
    const { getByText } = wrap(<EmptyState title="Nothing here" />);
    expect(getByText('Nothing here')).toBeTruthy();
  });

  it('renders body text when provided', () => {
    const { getByText } = wrap(<EmptyState title="Nothing" body="Try adding something." />);
    expect(getByText('Try adding something.')).toBeTruthy();
  });

  it('does not render body when omitted', () => {
    const { queryByText } = wrap(<EmptyState title="Nothing" />);
    // Only the title should be present, no other text node
    expect(queryByText(/Try adding/)).toBeNull();
  });

  it('renders legacy description prop as body text', () => {
    const { getByText } = wrap(<EmptyState title="Nothing" description="Legacy body." />);
    expect(getByText('Legacy body.')).toBeTruthy();
  });

  it('renders CTA button when ctaLabel and onPress are both provided', () => {
    const { getByRole } = wrap(
      <EmptyState title="Nothing" ctaLabel="Do something" onPress={() => {}} />,
    );
    expect(getByRole('button', { name: 'Do something' })).toBeTruthy();
  });

  it('does not render CTA button when onPress is missing', () => {
    const { queryByRole } = wrap(
      <EmptyState title="Nothing" ctaLabel="Do something" />,
    );
    expect(queryByRole('button', { name: 'Do something' })).toBeNull();
  });

  it('does not render CTA button when ctaLabel is missing', () => {
    const { queryByRole } = wrap(
      <EmptyState title="Nothing" onPress={() => {}} />,
    );
    // There should be no button (no ctaLabel → the Pressable is not rendered)
    expect(queryByRole('button')).toBeNull();
  });

  it('calls onPress when CTA is tapped', () => {
    const handler = jest.fn();
    const { getByRole } = wrap(
      <EmptyState title="Nothing" ctaLabel="Go" onPress={handler} />,
    );
    fireEvent.press(getByRole('button', { name: 'Go' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('applies accessibilityRole="summary" to the root container', () => {
    const { getByRole } = wrap(<EmptyState title="Empty" />);
    expect(getByRole('summary')).toBeTruthy();
  });

  it('accessibilityLabel on root combines title + body', () => {
    const { getByRole } = wrap(<EmptyState title="Empty" body="Body text." />);
    const summary = getByRole('summary');
    expect(summary.props.accessibilityLabel).toBe('Empty. Body text.');
  });

  it('accessibilityLabel on root is title-only when no body', () => {
    const { getByRole } = wrap(<EmptyState title="Empty" />);
    const summary = getByRole('summary');
    expect(summary.props.accessibilityLabel).toBe('Empty');
  });
});

// ---- emptyStates variants ---------------------------------------------------

describe('emptyStates variants', () => {
  it('noTrips renders without throwing', () => {
    expect(() =>
      wrap(<EmptyState {...noTrips} onPress={() => {}} />),
    ).not.toThrow();
  });

  it('noTrips shows correct title', () => {
    const { getByText } = wrap(<EmptyState {...noTrips} onPress={() => {}} />);
    expect(getByText('Plan your first trip')).toBeTruthy();
  });

  it('noPlaces renders without throwing', () => {
    expect(() =>
      wrap(<EmptyState {...noPlaces} onPress={() => {}} />),
    ).not.toThrow();
  });

  it('noPlaces shows correct title', () => {
    const { getByText } = wrap(<EmptyState {...noPlaces} onPress={() => {}} />);
    expect(getByText('Add your first place')).toBeTruthy();
  });

  it('noSearchResults renders without throwing', () => {
    expect(() =>
      wrap(<EmptyState {...noSearchResults} />),
    ).not.toThrow();
  });

  it('noSearchResults shows correct title', () => {
    const { getByText } = wrap(<EmptyState {...noSearchResults} />);
    expect(getByText('No results')).toBeTruthy();
  });

  it('searchPrompt renders without throwing', () => {
    expect(() =>
      wrap(<EmptyState {...searchPrompt} />),
    ).not.toThrow();
  });

  it('searchPrompt shows correct title', () => {
    const { getByText } = wrap(<EmptyState {...searchPrompt} />);
    expect(getByText('Search for a place')).toBeTruthy();
  });
});
