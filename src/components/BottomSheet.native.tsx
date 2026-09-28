/**
 * BottomSheet (native) — slide-up modal sheet.
 *
 * X3.1 keyboard + edge-to-edge pass:
 *   - Android (SDK 54) runs edge-to-edge, so the window no longer resizes for
 *     the keyboard (`adjustResize` is a no-op). A KeyboardAvoidingView with
 *     `padding` lifts the sheet on BOTH platforms. The padding is computed
 *     from the keyboard's overlap with the view's own frame, so if a device
 *     does resize the window the overlap is zero and nothing doubles up.
 *   - `statusBarTranslucent` + `navigationBarTranslucent` let the modal window
 *     draw edge-to-edge like the app itself (no opaque system-bar strips over
 *     the scrim). The bottom inset (gesture bar / 3-button nav) comes from
 *     the safe-area context and is dropped while the keyboard covers it.
 *   - The sheet caps at 90% of the space left above the keyboard.
 *
 * Props are unchanged (backward compatible with every call site).
 */
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useOptionalSafeAreaInsets } from '@/hooks/useOptionalSafeAreaInsets';
import { useTheme } from '@/theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export function BottomSheet({ visible, onClose, accessibilityLabel, children }: BottomSheetProps) {
  const t = useTheme();
  const insets = useOptionalSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const bottomInset = keyboardVisible ? 0 : insets.bottom;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
        />
        <View style={[styles.column, { paddingTop: insets.top + t.spacing.lg }]} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: t.colors.bg,
                borderTopLeftRadius: t.radius.xl,
                borderTopRightRadius: t.radius.xl,
                paddingBottom: bottomInset,
                ...t.shadows.lg(t.colors.shadowColorStrong),
              },
            ]}
            accessibilityLabel={accessibilityLabel}
          >
            <View style={[styles.handle, { backgroundColor: t.colors.borderStrong }]} />
            <View style={[styles.body, { padding: t.spacing.lg, gap: t.spacing.md }]}>{children}</View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Flex column that pins the sheet to the bottom. Its height is whatever the
  // KeyboardAvoidingView leaves, so the percentage cap tracks the keyboard.
  column: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', width: '100%' },
  body: { flexShrink: 1 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 8 },
});
