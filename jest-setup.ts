// Global Jest setup for Tripvisor.
// Keep this tiny — rely on jest-expo for most of the RN wiring.

// expo-font's loader expects native-module state jest-expo doesn't provide
// (loadedNativeFonts.forEach crash). Fonts are a progressive enhancement —
// `useFonts` reporting "not loaded" renders the system-stack typography,
// which is exactly the pre-v3 baseline the suites were written against.
jest.mock('expo-font', () => ({
  useFonts: () => [false, null] as const,
  isLoaded: () => false,
  loadAsync: jest.fn(async () => undefined),
}));
