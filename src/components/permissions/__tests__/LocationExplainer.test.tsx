import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/theme';
import { __resetLocationExplainerSession, useLocationExplainer } from '../LocationExplainer';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

let mockState: 'granted' | 'prompt' | 'denied' | 'unknown' = 'prompt';
jest.mock('@/components/trip-detail/locationPermission', () => ({
  getLocationPermissionState: async () => mockState,
}));

function Harness({ onProceed }: { onProceed: () => void }) {
  const explainer = useLocationExplainer({ reason: 'distance', onProceed });
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask" onPress={explainer.ask}>
        <Text>Ask</Text>
      </Pressable>
      {explainer.sheet}
    </>
  );
}

function setup() {
  const onProceed = jest.fn();
  const utils = render(
    <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider>
      <Harness onProceed={onProceed} />
    </ThemeProvider>
    </SafeAreaProvider>,
  );
  return { ...utils, onProceed };
}

describe('useLocationExplainer', () => {
  beforeEach(() => {
    __resetLocationExplainerSession();
  });

  it('explains first, then runs the real request on Continue', async () => {
    mockState = 'prompt';
    const { getByRole, findByRole, onProceed } = setup();
    fireEvent.press(getByRole('button', { name: 'Ask' }));
    fireEvent.press(await findByRole('button', { name: 'Continue' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('"Not now" closes without prompting', async () => {
    mockState = 'prompt';
    const { getByRole, findByRole, queryByRole, onProceed } = setup();
    fireEvent.press(getByRole('button', { name: 'Ask' }));
    fireEvent.press(await findByRole('button', { name: 'Not now' }));
    expect(queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('skips the explainer when permission is already granted', async () => {
    mockState = 'granted';
    const { getByRole, queryByRole, onProceed } = setup();
    fireEvent.press(getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(onProceed).toHaveBeenCalledTimes(1));
    expect(queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('explains an unknown state only once per session', async () => {
    mockState = 'unknown';
    const { getByRole, findByRole, onProceed } = setup();
    fireEvent.press(getByRole('button', { name: 'Ask' }));
    fireEvent.press(await findByRole('button', { name: 'Continue' }));
    fireEvent.press(getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(onProceed).toHaveBeenCalledTimes(2));
  });
});
