import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, accessibilityLabel, children }: BottomSheetProps) {
  const t = useTheme();
  const sheetRef = useRef<View | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (typeof document === 'undefined') return;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const node = sheetRef.current as unknown as HTMLElement | null;
    node?.focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus?.();
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View
      style={styles.container}
      // @ts-expect-error — web-only aria passthrough
      role="dialog"
      aria-modal="true"
      aria-label={accessibilityLabel ?? 'Dialog'}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Close dialog"
      />
      <View
        ref={(r) => {
          sheetRef.current = r;
        }}
        // @ts-expect-error — tabIndex for focus management
        tabIndex={-1}
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.bg,
            borderRadius: t.radius.lg,
            padding: t.spacing.lg,
            gap: t.spacing.md,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    width: '100%',
    maxWidth: 520,
    marginBottom: 24,
    marginHorizontal: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
});
