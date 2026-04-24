import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, accessibilityLabel, children }: BottomSheetProps) {
  const t = useTheme();
  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      transparent
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close sheet" />
      <SafeAreaView
        edges={['bottom']}
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: t.radius.lg,
            borderTopRightRadius: t.radius.lg,
          },
        ]}
        accessibilityLabel={accessibilityLabel}
      >
        <View style={[styles.handle, { backgroundColor: t.colors.borderStrong }]} />
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>{children}</View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 8 },
});
