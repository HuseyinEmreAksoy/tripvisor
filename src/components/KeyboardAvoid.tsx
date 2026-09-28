/**
 * KeyboardAvoid — flex:1 wrapper that keeps focused form fields above the
 * soft keyboard on full-screen forms (X3.1).
 *
 * Android on SDK 54 is edge-to-edge, so the window no longer resizes for the
 * keyboard and `adjustResize` alone leaves bottom fields hidden. `padding`
 * behavior works on both native platforms: the inset is the keyboard's overlap
 * with this view's own frame, so it never double-counts a resized window.
 * Web: a plain flex container (browsers handle the on-screen keyboard).
 *
 * KeyboardAvoidingView measures its frame relative to its PARENT, but compares
 * it with the keyboard's position on SCREEN. Inside `<Screen>` the parent is a
 * SafeAreaView padded by the top inset, so without an offset the view
 * under-lifts by exactly that inset. `keyboardVerticalOffset` therefore
 * defaults to the top safe-area inset; callers with a fixed header above the
 * wrapper add its height via `headerOffset`.
 *
 *   <Screen padded={false}>
 *     <KeyboardAvoid>
 *       <ScrollView keyboardShouldPersistTaps="handled">…</ScrollView>
 *     </KeyboardAvoid>
 *   </Screen>
 */
import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

export function KeyboardAvoid({
  children,
  style,
  headerOffset = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Height of any fixed header rendered above this wrapper (px). Default 0. */
  headerOffset?: number;
}) {
  // Context read (not useSafeAreaInsets) so it degrades to 0 without a provider (tests, isolated renders).
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const isWeb = Platform.OS === 'web';
  return (
    <KeyboardAvoidingView
      behavior={isWeb ? undefined : 'padding'}
      keyboardVerticalOffset={isWeb ? 0 : topInset + headerOffset}
      style={[styles.fill, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
