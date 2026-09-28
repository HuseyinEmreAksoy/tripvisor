/**
 * AppTabBar — bottom bar (phones) / left rail (desktop) for the (tabs) group.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { ThemeProvider } from '@/theme';
import { AppTabBar } from '../AppTabBar';

let mockBreakpoint: 'mobile' | 'tablet' | 'desktop' = 'mobile';
jest.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: () => mockBreakpoint,
}));

const ROUTES = [
  { key: 'trips-k', name: 'trips', title: 'Trips' },
  { key: 'today-k', name: 'today', title: 'Today' },
  { key: 'analytics-k', name: 'analytics', title: 'Insights' },
  { key: 'settings-k', name: 'settings', title: 'Profile' },
];

function makeProps(index = 0, defaultPrevented = false) {
  const emit = jest.fn(() => ({ defaultPrevented }));
  const navigate = jest.fn();
  const descriptors = Object.fromEntries(
    ROUTES.map((r) => [r.key, { options: { title: r.title } }]),
  );
  // Minimal navigator props — only the fields AppTabBar reads. The full
  // React Navigation descriptor/state types are far wider than needed here.
  const props = {
    state: { index, routes: ROUTES.map(({ key, name }) => ({ key, name, params: undefined })) },
    descriptors,
    navigation: { emit, navigate },
    insets: { top: 0, bottom: 20, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  return { props, emit, navigate };
}

function renderBar(props: BottomTabBarProps) {
  return render(
    <ThemeProvider>
      <AppTabBar {...props} />
    </ThemeProvider>,
  );
}

describe('AppTabBar', () => {
  beforeEach(() => {
    mockBreakpoint = 'mobile';
  });

  it('renders the four tabs with the focused one selected', () => {
    const { props } = makeProps(1);
    const { getAllByRole, getByRole } = renderBar(props);
    expect(getAllByRole('tab')).toHaveLength(4);
    expect(getByRole('tab', { name: 'Today' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(getByRole('tab', { name: 'Trips' }).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('navigates to an unfocused tab after emitting tabPress', () => {
    const { props, emit, navigate } = makeProps(0);
    const { getByRole } = renderBar(props);
    fireEvent.press(getByRole('tab', { name: 'Insights' }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tabPress', target: 'analytics-k' }));
    expect(navigate).toHaveBeenCalledWith('analytics', undefined);
  });

  it('does not navigate when the tab is already focused or the press is prevented', () => {
    const focused = makeProps(0);
    fireEvent.press(renderBar(focused.props).getByRole('tab', { name: 'Trips' }));
    expect(focused.navigate).not.toHaveBeenCalled();

    const prevented = makeProps(0, true);
    fireEvent.press(renderBar(prevented.props).getByRole('tab', { name: 'Profile' }));
    expect(prevented.navigate).not.toHaveBeenCalled();
  });

  it('shows the brand mark only in the desktop rail', () => {
    const { props } = makeProps(0);
    expect(renderBar(props).queryByLabelText('Tripvisor')).toBeNull();
    mockBreakpoint = 'desktop';
    const rail = renderBar(props);
    expect(rail.getByLabelText('Tripvisor')).toBeTruthy();
    expect(rail.getAllByRole('tab')).toHaveLength(4);
  });
});
