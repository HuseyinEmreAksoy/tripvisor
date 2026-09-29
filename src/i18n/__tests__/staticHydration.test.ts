/**
 * @jest-environment jsdom
 *
 * Web static export (Wave-1 review #6). `expo export` prerenders every page in
 * English, and the browser then hydrates that HTML. The first client render
 * must be English too, even for a Turkish visitor. Otherwise React throws #418
 * and client-renders the page from scratch. The switch to the visitor's
 * language happens right after hydration.
 *
 * Expo Router wraps every route in `<Suspense>`, and React hydrates those
 * boundaries in later passes, after the root's effects have run. So the probe
 * has a route-like boundary too: text inside it must also hydrate in English.
 *
 * Each case boots a fresh copy of the i18n module (with the web platform seam)
 * and of React, as the web bundle would, prerenders the probe the way the
 * export does, then hydrates that markup with real `react-dom`.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

interface Boot {
  /** `globalThis.__EXPO_ROUTER_HYDRATE__`, set by exported HTML only. */
  hydrate: boolean;
  /** Profile → Language, persisted in `localStorage['tv.locale']`. */
  stored?: 'en' | 'tr';
  /** First browser language (`navigator.languages[0]`). */
  browser: string;
  /** Control: translate the route content with raw `useTranslation`, not `useT`. */
  rawHookInRoute?: boolean;
}

interface Result {
  /** Every render's text, in order: root label, route label, route locale. */
  renders: { root: string[]; route: string[]; locale: string[] };
  /** Hydration errors React recovered from (#418 lands here). */
  recoverable: unknown[];
  html: string;
  text: string | null;
  language: string;
  htmlLang: string;
}

type HydrateRoot = (
  container: Element,
  element: unknown,
  options: { onRecoverableError: (error: unknown) => void },
) => { unmount: () => void };

/** Unmounts the last boot with its own React copy. */
let cleanup: (() => void) | null = null;

async function boot({ hydrate, stored, browser, rawHookInRoute = false }: Boot): Promise<Result> {
  document.documentElement.lang = 'en';
  window.localStorage.clear();
  if (stored) window.localStorage.setItem('tv.locale', stored);
  const flags = globalThis as { __EXPO_ROUTER_HYDRATE__?: boolean; IS_REACT_ACT_ENVIRONMENT?: boolean };
  if (hydrate) flags.__EXPO_ROUTER_HYDRATE__ = true;
  else delete flags.__EXPO_ROUTER_HYDRATE__;
  flags.IS_REACT_ACT_ENVIRONMENT = true;

  let result: Result | null = null;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../platform', () => jest.requireActual('../platform.web'));
    // On web, AsyncStorage is a thin wrapper over localStorage (raw keys).
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: async (key: string) => window.localStorage.getItem(key),
        setItem: async (key: string, value: string) => window.localStorage.setItem(key, value),
        removeItem: async (key: string) => window.localStorage.removeItem(key),
      },
    }));
    jest.doMock('expo-localization', () => {
      const [languageCode, regionCode] = browser.split('-');
      const locales = [{ languageTag: browser, languageCode, regionCode }];
      return { getLocales: () => locales, useLocales: () => locales, getCalendars: () => [] };
    });
    /* eslint-disable @typescript-eslint/no-require-imports -- a fresh module graph per boot */
    const React = require('react') as typeof import('react');
    const { hydrateRoot } = require('react-dom/client') as { hydrateRoot: HydrateRoot };
    const { renderToString } = require('react-dom/server.node') as {
      renderToString: (el: unknown) => string;
    };
    const { useTranslation } = require('react-i18next') as typeof import('react-i18next');
    const { hydrateLanguagePreference, i18n, useAppLocale, useSystemLanguageSync, useT } =
      require('..') as typeof import('..');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const renders: Result['renders'] = { root: [], route: [], locale: [] };
    const h = React.createElement;

    function Route() {
      const { t } = (rawHookInRoute ? useTranslation : useT)('shell');
      const { locale } = useAppLocale();
      const label = t('tabs.today');
      renders.route.push(label);
      renders.locale.push(locale);
      return h('p', null, h('b', null, label), h('i', null, locale));
    }

    function Root() {
      // The root layout mounts this once; it owns the post-hydration switch.
      useSystemLanguageSync();
      const { t } = useT('shell');
      const label = t('tabs.trips');
      renders.root.push(label);
      // Like Expo Router's per-route <Suspense> (hydrated in a later pass).
      return h('div', null, h('span', null, label), h(React.Suspense, { fallback: null }, h(Route)));
    }

    // What `expo export` writes: rendered in English, no window.
    const html = renderToString(h(Root));
    renders.root.length = 0;
    renders.route.length = 0;
    renders.locale.length = 0;
    document.body.innerHTML = `<div id="root">${html}</div>`;

    // In the browser the stored-choice read settles before React hydrates
    // (hydration is scheduled as a transition after the bundle runs).
    await hydrateLanguagePreference();

    const recoverable: unknown[] = [];
    const container = document.getElementById('root')!;
    await React.act(async () => {
      const root = hydrateRoot(container, h(Root), {
        onRecoverableError: (error) => recoverable.push(error),
      });
      cleanup = () => React.act(() => root.unmount());
    });
    result = {
      renders,
      recoverable,
      html,
      text: container.textContent,
      language: i18n.language,
      htmlLang: document.documentElement.lang,
    };
  });
  return result!;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  delete (globalThis as { __EXPO_ROUTER_HYDRATE__?: boolean }).__EXPO_ROUTER_HYDRATE__;
  window.localStorage.clear();
  jest.dontMock('../platform');
  jest.dontMock('expo-localization');
  jest.dontMock('@react-native-async-storage/async-storage');
});

describe('static web hydration', () => {
  it('prerenders English (the markup every visitor hydrates)', async () => {
    const r = await boot({ hydrate: true, stored: 'tr', browser: 'tr-TR' });
    expect(r.html).toContain('Trips');
    expect(r.html).toContain('Today');
    expect(r.html).toContain('en-US');
    // The route boundary is in the markup, so it hydrates in a later pass.
    expect(r.html).toContain('<!--$-->');
  });

  it('a stored Turkish choice hydrates in English, then switches', async () => {
    const r = await boot({ hydrate: true, stored: 'tr', browser: 'en-US' });
    expect(r.recoverable).toEqual([]);
    expect(r.renders.root[0]).toBe('Trips');
    expect(r.renders.route[0]).toBe('Today');
    expect(r.renders.locale[0]).toBe('en-US');
    expect(r.text).toBe('GezilerBugüntr-TR');
    expect(r.language).toBe('tr');
    expect(r.htmlLang).toBe('tr');
  });

  it('a Turkish browser in System mode hydrates in English, then switches', async () => {
    const r = await boot({ hydrate: true, browser: 'tr-TR' });
    expect(r.recoverable).toEqual([]);
    expect(r.renders.root[0]).toBe('Trips');
    expect(r.renders.route[0]).toBe('Today');
    expect(r.text).toBe('GezilerBugüntr-TR');
  });

  it('an explicit English choice stays English on a Turkish browser', async () => {
    // Right after hydration the preference hook still reports the static
    // snapshot ('system'); System sync must not flip the page to Turkish.
    const r = await boot({ hydrate: true, stored: 'en', browser: 'tr-TR' });
    expect(r.recoverable).toEqual([]);
    expect([...r.renders.root, ...r.renders.route].every((label) => ['Trips', 'Today'].includes(label))).toBe(true);
    expect(r.language).toBe('en');
  });

  it('English visitors hydrate cleanly and pick up their region after', async () => {
    const r = await boot({ hydrate: true, browser: 'en-GB' });
    expect(r.recoverable).toEqual([]);
    expect(r.renders.locale[0]).toBe('en-US');
    expect(r.text).toBe('TripsTodayen-GB');
    expect(r.language).toBe('en');
  });

  it('control: route content that ignores the hydration pin mismatches', async () => {
    // Why `useT` pins per component: the route boundary hydrates after the
    // root has already switched the app to Turkish.
    const r = await boot({ hydrate: true, stored: 'tr', browser: 'en-US', rawHookInRoute: true });
    expect(r.recoverable.length).toBeGreaterThan(0);
    expect(r.text).toBe('GezilerBugüntr-TR');
  });
});

describe('platform.web hydration flag', () => {
  it('is set only by the exported page', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isHydratingStaticHtml } = jest.requireActual('../platform.web') as typeof import('../platform.web');
    expect(isHydratingStaticHtml()).toBe(false);
    (globalThis as { __EXPO_ROUTER_HYDRATE__?: boolean }).__EXPO_ROUTER_HYDRATE__ = true;
    expect(isHydratingStaticHtml()).toBe(true);
  });
});
