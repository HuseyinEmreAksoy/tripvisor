/**
 * BackButton — v2 "Tide & Terracotta" primitive.
 *
 * Explicit navigation is a binding UX principle, so the back affordance is a
 * visible soft pill (elevated surface + quiet border) instead of a bare text
 * link. Accessible name stays "Go back[ to X]".
 */
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface BackButtonProps {
  onPress: () => void;
  label?: string;
  noPrint?: boolean;
}

export function BackButton({ onPress, label = 'Back', noPrint = false }: BackButtonProps) {
  const t = useTheme();

  const printProps =
    noPrint && Platform.OS === 'web'
      ? ({ 'data-no-print': '' } as object)
      : {};

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Go back${label !== 'Back' ? ` to ${label}` : ''}`}
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: pressed ? t.colors.bgMuted : t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          ...t.shadows.sm(t.colors.shadowColor),
        },
        Platform.OS === 'web' && ({
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        } as ViewStyle),
      ]}
      {...printProps}
    >
      <Text
        style={[styles.arrow, { color: t.colors.primary }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        ←
      </Text>
      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600', fontSize: 14 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    minHeight: 38,
    minWidth: 44,
    gap: 6,
  },
  arrow: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '600',
  },
});
