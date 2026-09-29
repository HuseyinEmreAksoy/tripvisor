module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // Web only: rewrite `import.meta` to Expo's runtime registry.
          // maplibre-gl v6 is ESM-only and reads `import.meta.url` (worker
          // auto-detect). Metro loads web chunks as CLASSIC scripts, where raw
          // `import.meta` is a parse-time SyntaxError that kills the whole
          // maplibre chunk (verified on an export). The polyfilled value is never
          // used for the worker: MapLibreMap.web.tsx pins `workerUrl`.
          // Native keeps the preset default (build error on `import.meta`).
          web: { unstable_transformImportMeta: true },
        },
      ],
    ],
    // No explicit worklets/reanimated plugin here — on purpose.
    //
    // SDK 54's babel-preset-expo auto-registers `react-native-worklets/plugin`
    // when `react-native-worklets` is installed (babel-preset-expo@54.0.11,
    // build/index.js ~L284-292: "Automatically add `react-native-reanimated/plugin`
    // when the package is installed"). Reanimated 4's own
    // `react-native-reanimated/plugin` is just a re-export of the worklets plugin,
    // so listing it here as well would register the worklets transform TWICE and
    // break worklet compilation. See the Reanimated 3 -> 4 migration guide
    // (https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x).
    plugins: [],
  };
};
