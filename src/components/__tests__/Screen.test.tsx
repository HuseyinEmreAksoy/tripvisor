/**
 * Screen desktop columns (M5 Y2.4): `width="form"` centres content at
 * ≤ 640 px; ScreenScrollView keeps the scroll surface full width and puts
 * the column on its content.
 */
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/theme';
import { Screen, ScreenScrollView, screenColumnStyle } from '../Screen';

function wrap(node: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 1440, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <ThemeProvider>{node}</ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('screenColumnStyle', () => {
  it('maps widths to centred columns', () => {
    expect(screenColumnStyle('form')).toEqual({ width: '100%', maxWidth: 640, alignSelf: 'center' });
    expect(screenColumnStyle('content')).toEqual({ width: '100%', maxWidth: 960, alignSelf: 'center' });
    expect(screenColumnStyle('full')).toEqual({});
  });
});

describe('ScreenScrollView', () => {
  it('applies the enclosing Screen column to its content, not the scroll surface', () => {
    const { getByTestId } = wrap(
      <Screen padded={false} width="form">
        <ScreenScrollView testID="scroll" contentContainerStyle={{ padding: 16 }}>
          <Text>Field</Text>
        </ScreenScrollView>
      </Screen>,
    );
    const scroll = getByTestId('scroll');
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content).toMatchObject({ maxWidth: 640, alignSelf: 'center', padding: 16 });
    expect(StyleSheet.flatten(scroll.props.style ?? {})).not.toHaveProperty('maxWidth');
  });

  it('is full width outside a form Screen', () => {
    const { getByTestId } = wrap(
      <Screen padded={false}>
        <ScreenScrollView testID="scroll" />
      </Screen>,
    );
    expect(StyleSheet.flatten(getByTestId('scroll').props.contentContainerStyle)).not.toHaveProperty('maxWidth');
  });
});
