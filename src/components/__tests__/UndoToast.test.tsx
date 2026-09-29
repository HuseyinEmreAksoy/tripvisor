import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, act } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { ThemeProvider } from '@/theme';
import { getSessionUndoStack, _resetSessionUndoStackForTests } from '@/sync/undo';
import { UndoToast } from '../UndoToast';

jest.mock('@/sync/flags', () => ({ isTier1SyncEnabled: () => true, loadTier1SyncFlag: async () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

function renderToast() {
  return render(
    <ThemeProvider>
      <UndoToast />
    </ThemeProvider>,
  );
}

beforeEach(() => _resetSessionUndoStackForTests());
afterEach(() => {
  setOS(originalOS);
  jest.restoreAllMocks();
});

describe('UndoToast accessibility', () => {
  it('iOS: announces the toast explicitly (RN live regions are Android-only)', () => {
    setOS('ios');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    renderToast();
    act(() => {
      getSessionUndoStack().push({ label: 'Remove place', inverse: async () => {} });
    });
    expect(announce).toHaveBeenCalledWith('Remove place. Undo available.');
  });

  it('web: keeps a persistent live region mounted and swaps only its text', () => {
    setOS('web');
    const { getByTestId, getAllByText } = renderToast();
    // Mounted (empty) before any toast exists.
    expect(getByTestId('undo-toast-live')).toBeTruthy();
    act(() => {
      getSessionUndoStack().push({ label: 'Remove place', inverse: async () => {} });
    });
    expect(getAllByText('Remove place. Undo available.').length).toBe(1);
  });
});
