/**
 * @jest-environment jsdom
 *
 * useBreakpoint + useIsHydrating (Wave-1 review #6, desktop half). The web
 * static export prerenders with no window (width 0 → 'mobile'). A desktop
 * visitor must hydrate that same layout, then switch to 'desktop' right
 * after; reading the real width during hydration throws React #418.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, createElement } from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useBreakpoint } from '../useBreakpoint';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1280, height: 800, scale: 1, fontScale: 1 }),
}));

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

describe('useBreakpoint', () => {
  it('reports the real width outside hydration (native, dev server, tests)', () => {
    function Probe() {
      return <Text>{useBreakpoint()}</Text>;
    }
    expect(render(<Probe />).getByText('desktop')).toBeTruthy();
  });

  it('hydrates the prerendered mobile layout, then switches to desktop', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: string[] = [];
    function Probe() {
      const bp = useBreakpoint();
      seen.push(bp);
      return createElement('span', null, bp);
    }
    // What `expo export` writes for <Probe /> (no window → width 0).
    document.body.innerHTML = '<div id="root"><span>mobile</span></div>';
    const container = document.getElementById('root')!;
    const recoverable: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, createElement(Probe), {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });
    expect(seen[0]).toBe('mobile');
    expect(recoverable).toEqual([]);
    expect(container.textContent).toBe('desktop');
  });
});
