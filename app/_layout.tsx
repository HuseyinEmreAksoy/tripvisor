// Root layout.
//
// Order matters:
//   1. `initSentry()` runs inside a `useEffect` on first mount of `RootLayout`,
//      before children render. We deliberately avoid module-scope side effects
//      so importing this file is free of network/init work — which keeps tests
//      cheap to mock and SSR-style web prerenders predictable. The Sentry DSN
//      gate inside `initSentry()` makes the call a no-op when unconfigured.
//   2. The QueryClient + persister are configured below. The persister uses
//      the Phase 4 allowlist (`shouldDehydrateQuery`) so only durable,
//      ToS-safe query keys reach disk. Google Places content is never
//      persisted — it stays in-memory only. On the server (static web
//      rendering) TanStack gets a no-op timer provider, the only
//      module-scope call on the server (see the note above `queryClient`).
//   3. i18n (ADR-0011): importing `@/i18n` initialises i18next synchronously
//      (bundled resources, no network), so the first render is already
//      translated. On native the persisted Profile → Language choice is read
//      from AsyncStorage; `useI18nReady` keeps the splash up until then
//      (bounded by a short timeout) so there's no flash of the device language.
//      That needs `SplashScreen.preventAutoHideAsync()` at module scope (the
//      one deliberate module-scope call on native; a no-op flag, no I/O).
//      Otherwise the splash auto-hides on the first frame and the `null`
//      render below shows as a blank screen. On a statically exported web
//      page, `useSystemLanguageSync` also switches from the prerendered
//      English into the visitor's language right after hydration.

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, isServer, timeoutManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useTheme } from '@/theme';
import { shouldDehydrateQuery } from '@/api/offline';
import { initSentry } from '@/lib/sentry';
import { useI18nReady, useSystemLanguageSync } from '@/i18n';

// Native only: hold the splash until the stored language is applied (see
// `RootLayout`). Must run before the first frame, hence module scope. Web
// has no native splash (the call is a no-op there anyway).
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {
    // Already hidden (e.g. a fast refresh): nothing to hold.
  });
}

// ── Baseline Open Graph / meta tags (web only) ────────────────────────────────
//
// Rendered on every route. Per-route Head blocks (e.g. the share page) will
// override the specific keys they care about (og:title, og:description, etc.)
// because expo-router merges Head tags and later/deeper route Heads win for
// duplicate keys.
//
// The runtime-require pattern keeps expo-router/head out of the native bundle —
// same approach as app/(app)/trip/[id]/print.tsx:PrintHead.
// These stay English on purpose (M5 Y1.4): they're prerendered once at build
// time for crawlers and link previews, which have no app language.
const SITE_ORIGIN = 'https://tripvisor.pages.dev';
const SITE_TITLE = 'Tripvisor — holiday route planner';
const SITE_DESCRIPTION =
  'Tripvisor — plan multi-day holiday routes with optimized day splits, place reviews, and shareable itineraries.';

function RootHead() {
  if (Platform.OS !== 'web') return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const headModule = require('expo-router/head') as {
    default?: React.ComponentType<{ children: React.ReactNode }>;
    Head?: React.ComponentType<{ children: React.ReactNode }>;
  };
  // expo-router/head.js exports `Head` as the default export only
  // (`export { Head as default } from './build/head/ExpoHead'`).
  // Destructuring `{ Head }` would yield `undefined` and crash the entire
  // React tree on web. Fall back to `.Head` for any future SDK that might
  // re-add a named export.
  const Head = headModule.default ?? headModule.Head;
  if (!Head) return null;

  // These are statically prerendered into every exported HTML file (expo-router
  // static output renders Head server-side), so plain-HTML crawlers see them.
  // The Pages Function functions/share/[token].ts rewrites the title and
  // description tags for /share/<token> by attribute selector, so every key it
  // targets must exist here.
  return (
    <Head>
      <meta name="description" content={SITE_DESCRIPTION} />
      <meta property="og:site_name" content="Tripvisor" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={SITE_TITLE} />
      <meta property="og:description" content={SITE_DESCRIPTION} />
      <meta property="og:url" content={`${SITE_ORIGIN}/`} />
      <meta property="og:image" content={`${SITE_ORIGIN}/og-image.jpg`} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="Illustrated travel map with a dotted route along a Mediterranean coast, holiday photos, coffee and a compass" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={SITE_TITLE} />
      <meta name="twitter:description" content={SITE_DESCRIPTION} />
      <meta name="twitter:image" content={`${SITE_ORIGIN}/og-image.jpg`} />
    </Head>
  );
}

// Server render only (web static rendering: once per route in `expo export`,
// but on EVERY page request in the `expo start` dev server, which evaluates a
// fresh copy of the app each time). The 24 h gcTime below, and the per-query
// ones in src/api, would give every query rendered on the server a 24 h Node
// timer, and each timer keeps that request's whole app instance alive: the
// dev server grew ~10 MB per page load until it ran out of heap. A server
// render is discarded once its HTML is sent, so it needs no gc or refetch
// timers. `isServer` is false in browsers and on native, which keep the
// default provider.
if (isServer) {
  timeoutManager.setTimeoutProvider({
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 2,
    },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

// 7 days per ADR-0005. Storage quota (AsyncStorage on native, localStorage on
// web) is the implicit upper bound on payload size.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export default function RootLayout() {
  useEffect(() => {
    // Fires once, before children mount. DSN-gated no-op when Sentry is
    // unconfigured (see `src/lib/sentry.ts`).
    initSentry();
  }, []);

  // System mode follows OS language changes (Android per-app language, iOS
  // Settings, browser `languagechange`). On a static web page it also swaps
  // the prerendered English for the visitor's language after hydration.
  useSystemLanguageSync();
  // Always true on web; on native, false for the few ms it takes to read the
  // stored language (at most 500 ms). Returning null meanwhile is safe
  // because the splash is held (module scope above); it's hidden once the
  // tree renders in the right language. Fonts don't gate this: they load
  // non-blocking in ThemeProvider.
  const i18nReady = useI18nReady();
  useEffect(() => {
    if (!i18nReady || Platform.OS === 'web') return;
    SplashScreen.hideAsync().catch(() => {
      // Already hidden: nothing to do.
    });
  }, [i18nReady]);
  if (!i18nReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister,
              maxAge: MAX_AGE_MS,
              dehydrateOptions: { shouldDehydrateQuery },
              // Bump this string on any ToS-affecting cache-key change.
              // Setting a new buster discards the prior persisted cache on first
              // launch after upgrade and forces a clean re-fetch — prevents
              // pre-Phase-4 'place-details' / 'places-autocomplete' entries
              // (which bypassed the allowlist) from being hydrated back into memory.
              buster: 'phase-4-allowlist-v1',
            }}
          >
            {/* Baseline OG/meta fallback for all routes — web only, no-op on native */}
            <RootHead />
            <ThemedStatusBar />
            <Stack screenOptions={{ headerShown: false }} />
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Status bar icons follow the IN-APP theme (Settings > Appearance can override
 * the OS scheme); `style="auto"` would follow the OS and vanish on a forced theme.
 */
function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />;
}
