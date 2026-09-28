/**
 * useOptionalSafeAreaInsets — safe-area insets that degrade to zero when no
 * SafeAreaProvider is mounted (isolated component tests, portals), instead of
 * throwing like `useSafeAreaInsets`. The app root always mounts the provider.
 */
import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function useOptionalSafeAreaInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}
