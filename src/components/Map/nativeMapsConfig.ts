/**
 * Native Google Maps key detection (v2 M4 X1.2).
 *
 * app.config.ts writes `extra.nativeMaps = { android, ios }` from the build
 * env (GOOGLE_MAPS_ANDROID_KEY / GOOGLE_MAPS_IOS_KEY). A react-native-maps
 * Google provider without a key renders blank on Android (or crashes, depending
 * on the Play Services version). On iOS the Google Maps SDK pod is only linked
 * when the key is set. Map.native.tsx uses this to pick a safe provider.
 */
import Constants from 'expo-constants';

export type NativeMapsMode = 'google' | 'apple' | 'unavailable';

type Extra = { nativeMaps?: { android?: unknown; ios?: unknown } } | undefined;

export function resolveNativeMapsMode(os: string, extra: Extra): NativeMapsMode {
  const flags = extra?.nativeMaps;
  if (os === 'ios') return flags?.ios === true ? 'google' : 'apple';
  if (os === 'android') return flags?.android === true ? 'google' : 'unavailable';
  return 'unavailable';
}

export function nativeMapsMode(os: string): NativeMapsMode {
  return resolveNativeMapsMode(os, Constants.expoConfig?.extra as Extra);
}
