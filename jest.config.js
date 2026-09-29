module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  transformIgnorePatterns: [
    // @sentry/.*: ships untranspiled ESM; part of jest-expo's UPSTREAM default
    // pattern that this custom override had dropped. Needed since S2.8.11 —
    // offline.web.ts imports the sync engine accessors, whose telemetry module
    // imports src/lib/sentry.ts at module scope.
    'node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-native-community|expo-modules-core|@supabase/.*|@tanstack/.*|@react-navigation/.*|@sentry/.*|lucide-react-native))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/supabase/functions/', '<rootDir>/e2e/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // AsyncStorage: use the official Jest mock so tests don't require the native module.
    // https://react-native-async-storage.github.io/async-storage/docs/advanced/jest
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
  },
  // ── Coverage (Step 5.5) ────────────────────────────────────────────────────
  coverageReporters: ['text', 'html', 'json-summary'],
  // Platform-split counterparts that jest-expo's jsdom web preset never loads:
  // `.native.*` files are invisible to the web resolver (it prefers `.web.*`).
  // Excluding them prevents false 0% entries that would sink per-path thresholds.
  // True coverage of native variants requires a second Jest run with a native preset.
  //
  // sentry.ts: DSN-present branch is unreachable in jsdom (Babel inlines the
  // SENTRY_DSN env at build time; Phase 4 Problem 11 accepted as documented workaround).
  // Excluded from thresholds to avoid a permanent failing bar for accepted tech debt.
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/supabase/functions/',
    '\\.native\\.',   // never loaded by jest-expo web preset
    'offline\\.native\\.ts',
    'ics\\.native\\.ts',
    'src/lib/sentry\\.ts', // Phase 4 Problem 11 accepted: DSN branch unreachable in jsdom
  ],
  coverageThreshold: {
    global: {
      lines: 50,
    },
    // Path/glob thresholds are checked PER FILE, and a file is checked against
    // EVERY key it matches, so a plain 'src/lib/**' would still hold
    // encode.web.ts to 80% and make its own 60% entry below dead config. The
    // extglob keeps every other src/lib source (all .ts) on the 80% bar.
    // NOTE: on Windows Jest resolves these keys to backslash paths that glob
    // never matches, so glob thresholds are only enforced on Linux/macOS (CI).
    // Reproduce CI locally in a node:22 container before trusting a green run.
    'src/lib/**/!(encode.web).ts': {
      lines: 80,
    },
    // TODO(M5): encode.web.ts canvas/OffscreenCanvas/downscale branches need
    // jsdom canvas fakes; raise back to the src/lib bar once pipeline.test covers them.
    'src/lib/photos/encode.web.ts': {
      lines: 60,
    },
    // src/api threshold is intentionally low: most API hooks (auth, trips,
    // trip-places, places, routes, share, ics) are not exercised in jsdom because
    // they depend on Supabase + TanStack Query. Only offline.web.ts is covered
    // here. Raise this threshold once proper API-layer unit tests land.
    'src/api/**': {
      lines: 15,
    },
  },
};
