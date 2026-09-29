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
//      persisted — it stays in-memory only.
//   3. i18n (ADR-0011): importing `@/i18n` initialises i18next synchronously
//      (bundled resources, no network), so the first render is already
//      translated. On native the persisted Profile → Language choice is read
//      from AsyncStorage; `useI18nReady` keeps the splash up until then
//      (bounded by a short timeout) so there's no flash of the device language.

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider } from '@/theme';
import { shouldDehydrateQuery } from '@/api/offline';
import { initSentry } from '@/lib/sentry';
import { useI18nReady, useSystemLanguageSync } from '@/i18n';

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
      <meta property="og:image:alt" content="Sunset over a cobbled Mediterranean village street above the sea" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={SITE_TITLE} />
      <meta name="twitter:description" content={SITE_DESCRIPTION} />
      <meta name="twitter:image" content={`${SITE_ORIGIN}/og-image.jpg`} />
    </Head>
  );
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
  // Settings, browser `languagechange`).
  useSystemLanguageSync();
  // Always true on web; on native, false for the few ms it takes to read the
  // stored language. Returning null keeps the native splash visible.
  const i18nReady = useI18nReady();
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
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }} />
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
