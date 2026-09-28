import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLLAPSED_DAYS_KEY_PREFIX, useCollapsedDays } from '../useCollapsedDays';

describe('useCollapsedDays', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('collapses past days by default while live, and remembers a toggle', async () => {
    const { result } = renderHook(() => useCollapsedDays('trip-1', 2));
    expect(result.current.isCollapsed(0)).toBe(true);
    expect(result.current.isCollapsed(2)).toBe(false);

    act(() => result.current.toggle(0));
    expect(result.current.isCollapsed(0)).toBe(false);
    await waitFor(async () => {
      expect(await AsyncStorage.getItem(`${COLLAPSED_DAYS_KEY_PREFIX}trip-1`)).toBe('{"0":false}');
    });
  });

  it('restores stored choices for the trip on this device', async () => {
    await AsyncStorage.setItem(`${COLLAPSED_DAYS_KEY_PREFIX}trip-2`, '{"3":true,"bad":true}');
    const { result } = renderHook(() => useCollapsedDays('trip-2', null));
    await waitFor(() => expect(result.current.isCollapsed(3)).toBe(true));
    expect(result.current.isCollapsed(1)).toBe(false);
  });

  it('expand() opens a collapsed day and is a no-op on an open one', () => {
    const { result } = renderHook(() => useCollapsedDays('trip-3', 2));
    act(() => result.current.expand(1));
    expect(result.current.isCollapsed(1)).toBe(false);
    act(() => result.current.expand(3));
    expect(result.current.isCollapsed(3)).toBe(false);
  });
});
