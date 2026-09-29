/**
 * @jest-environment jsdom
 *
 * ThemeProvider on the web static export. The HTML is prerendered with no
 * media query (System → light). React doesn't patch mismatched style
 * attributes while hydrating, so a dark-mode visitor must hydrate the light
 * theme and switch to dark right after, or the page stays light.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, createElement } from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider, useTheme, useThemeControls } from '..';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

function ThemeName() {
  return <Text>{useTheme().name}</Text>;
}

// react-dom ships no types here (@types/react-dom isn't installed); this is all we use.
interface Root {
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hydrateRoot } = require('react-dom/client') as {
  hydrateRoot: (container: Element, element: unknown, options: { onRecoverableError: (error: unknown) => void }) => Root;
};

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

describe('ThemeProvider', () => {
  it('follows a dark system theme outside hydration (native, dev server)', () => {
    const { getByText } = render(
      <ThemeProvider>
        <ThemeName />
      </ThemeProvider>,
    );
    expect(getByText('dark')).toBeTruthy();
  });

  it('hydrates the prerendered light theme, then switches to dark', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: string[] = [];
    function Probe() {
      const { name } = useTheme();
      const { mode } = useThemeControls();
      seen.push(`${name}/${mode}`);
      return createElement('span', null, name);
    }
    // What `expo export` writes: System mode, no media query → light.
    document.body.innerHTML = '<div id="root"><span>light</span></div>';
    const container = document.getElementById('root')!;
    const recoverable: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, createElement(ThemeProvider, null, createElement(Probe)), {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    expect(seen[0]).toBe('light/system');
    expect(recoverable).toEqual([]);
    expect(container.textContent).toBe('dark');
  });
});
