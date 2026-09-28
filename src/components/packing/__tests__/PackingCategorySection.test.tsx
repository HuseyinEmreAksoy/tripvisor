import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme';
import type { TripPackingItem } from '@/api';
import { PackingCategorySection } from '../PackingCategorySection';
import type { PackingGroupView } from '../packingView';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

function item(label: string, checked: boolean): TripPackingItem {
  return { id: label, trip_id: 't', label, category: 'clothing', checked, auto: false, created_at: '' } as TripPackingItem;
}

const group: PackingGroupView = {
  key: 'clothing',
  title: 'Clothing',
  items: [item('Socks', false), item('Shirt', true)],
  visible: [item('Socks', false), item('Shirt', true)],
  packed: 1,
  total: 2,
};

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('PackingCategorySection', () => {
  it('shows progress in the header and toggles collapse', () => {
    const onToggleCollapsed = jest.fn();
    const { getByRole, rerender, queryByRole } = wrap(
      <PackingCategorySection
        group={group}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        canEdit
        onToggleItem={jest.fn()}
        onDeleteItem={jest.fn()}
      />,
    );
    const header = getByRole('button', { name: 'Clothing, 1 of 2 packed' });
    expect(header.props.accessibilityState).toMatchObject({ expanded: true });
    expect(getByRole('checkbox', { name: 'Socks' })).toBeTruthy();
    fireEvent.press(header);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <PackingCategorySection
          group={group}
          collapsed
          onToggleCollapsed={onToggleCollapsed}
          canEdit
          onToggleItem={jest.fn()}
          onDeleteItem={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(queryByRole('checkbox', { name: 'Socks' })).toBeNull();
  });

  it('ticks an item with a haptic and reports the new checked state', () => {
    const { haptics } = jest.requireMock('@/lib/haptics') as { haptics: { success: jest.Mock } };
    const onToggleItem = jest.fn();
    const { getByRole } = wrap(
      <PackingCategorySection
        group={group}
        collapsed={false}
        onToggleCollapsed={jest.fn()}
        canEdit
        onToggleItem={onToggleItem}
        onDeleteItem={jest.fn()}
      />,
    );
    fireEvent.press(getByRole('checkbox', { name: 'Socks' }));
    expect(haptics.success).toHaveBeenCalled();
    expect(onToggleItem).toHaveBeenCalledWith(expect.objectContaining({ label: 'Socks' }), true);
  });
});
