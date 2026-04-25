/**
 * BackButton — Redesigned with styled arrow, hover/press animation.
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
          backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
          borderRadius: t.radius.sm,
          paddingHorizontal: t.spacing.sm,
        },
        Platform.OS === 'web' && ({
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        } as ViewStyle),
      ]}
      {...printProps}
    >
      <Text
        style={[
          styles.arrow,
          { color: t.colors.primary },
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      >
        ←
      </Text>
      <Text style={[t.typography.body, { color: t.colors.primary, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
    gap: 6,
  },
  arrow: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '600',
  },
});
