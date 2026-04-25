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

// ── Baseline Open Graph / meta tags (web only) ────────────────────────────────
//
// Rendered on every route. Per-route Head blocks (e.g. the share page) will
// override the specific keys they care about (og:title, og:description, etc.)
// because expo-router merges Head tags and later/deeper route Heads win for
// duplicate keys.
//
// The runtime-require pattern keeps expo-router/head out of the native bundle —
// same approach as app/(app)/trip/[id]/print.tsx:PrintHead.
function RootHead() {
  if (Platform.OS !== 'web') return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Head } = require('expo-router/head') as { Head: React.ComponentType<{ children: React.ReactNode }> };

  return (
    <Head>
      <meta
        name="description"
        content="Tripvisor — plan multi-day holiday routes with optimized day splits, place reviews, and shareable itineraries."
      />
      <meta property="og:site_name" content="Tripvisor" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
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
