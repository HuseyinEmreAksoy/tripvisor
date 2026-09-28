import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../supabase', () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { useAutocompleteSession, useAutocompleteSessionToken } from '../places';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('useAutocompleteSession', () => {
  it('is stable across renders until rotated', () => {
    const { result, rerender } = renderHook(() => useAutocompleteSession());
    const first = result.current.sessionToken;
    expect(first).toMatch(UUID_V4);
    rerender({});
    expect(result.current.sessionToken).toBe(first);

    act(() => result.current.rotate());
    expect(result.current.sessionToken).toMatch(UUID_V4);
    expect(result.current.sessionToken).not.toBe(first);
  });

  it('useAutocompleteSessionToken keeps returning a stable string', () => {
    const { result, rerender } = renderHook(() => useAutocompleteSessionToken());
    const first = result.current;
    expect(typeof first).toBe('string');
    rerender({});
    expect(result.current).toBe(first);
  });
});
