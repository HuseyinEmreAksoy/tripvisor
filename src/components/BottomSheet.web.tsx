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
  // Call sites usually pass an inline arrow. Keeping onClose in a ref lets the
  // focus effect key on `visible` alone, so a parent re-render never re-runs
  // it (which used to yank focus back to the sheet and steal the caret).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    if (typeof document === 'undefined') return;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const node = sheetRef.current as unknown as HTMLElement | null;
    node?.focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus?.();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <View
      style={styles.container}
      // RN 0.79 ViewProps supports role / aria-modal / aria-label natively
      // (the pre-SDK-53 @ts-expect-error passthrough hack is no longer needed).
      role="dialog"
      aria-modal
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
        // tabIndex is a first-class ViewProps member in RN 0.79 (focus management).
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

// `position: 'fixed'` ensures the overlay covers the full viewport even when
// BottomSheet is rendered inside a scroll container (e.g. inside a FlatList item).
// This is a valid CSS value in React Native Web; the cast bypasses the RN type system
// which doesn't know about the web-only 'fixed' position value.
const fixedFill = {
  position: 'fixed' as unknown as 'absolute',
  top: 0 as const,
  left: 0 as const,
  right: 0 as const,
  bottom: 0 as const,
};

const styles = StyleSheet.create({
  container: {
    ...fixedFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  backdrop: {
    ...fixedFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    marginBottom: 24,
    marginHorizontal: 24,
    // RN Web 0.19+ deprecates the native shadow* properties for web-only files.
    // Using boxShadow (CSS shorthand) avoids the deprecation warning and maps
    // directly to the browser's box-shadow without requiring elevation hacks.
    // Equivalent to: shadowColor:#000, shadowOpacity:0.25, shadowRadius:20.
    boxShadow: '0px 8px 20px rgba(0,0,0,0.25)',
  },
});
