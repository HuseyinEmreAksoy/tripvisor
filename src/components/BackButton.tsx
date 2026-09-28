/**
 * BackButton — v2 "Tide & Terracotta" primitive.
 *
 * Explicit navigation is a binding UX principle, so the back affordance is a
 * visible soft pill (elevated surface + quiet border) instead of a bare text
 * link. Accessible name stays "Go back[ to X]".
 */
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from './Icon';

export interface BackButtonProps {
  onPress: () => void;
  label?: string;
  noPrint?: boolean;
}

export function BackButton({ onPress, label = 'Back', noPrint = false }: BackButtonProps) {
  const t = useTheme();

  const printProps =
    noPrint && Platform.OS === 'web'
      ? // dataSet → data-no-print="true" on react-native-web. A raw
        // 'data-no-print' prop is dropped by RNW's prop allow-list.
        ({ dataSet: { noPrint: 'true' } } as object)
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
      {/* v3: Lucide chevron replaces the unicode arrow (decorative — the
          Pressable carries the accessible name). */}
      <Icon name="chevron-left" size={18} color={t.colors.primary} />
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
});
