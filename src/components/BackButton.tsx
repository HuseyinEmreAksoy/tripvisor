/**
 * BackButton — v2 "Tide & Terracotta" primitive.
 *
 * Explicit navigation is a binding UX principle, so the back affordance is a
 * visible soft pill (elevated surface + quiet border) instead of a bare text
 * link. Accessible name: "Go back" / "Go back to X" (`common:actions.goBack*`),
 * translated since M5 Y1.4; the default visible label is `common:actions.back`.
 * `tone="onImage"` (M5 Y2.4) is the dark-glass variant for cover heroes.
 */
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from './Icon';

export interface BackButtonProps {
  onPress: () => void;
  label?: string;
  noPrint?: boolean;
  /** `onImage`: dark glass + white label, for use over a cover photo (Y2.4). */
  tone?: 'surface' | 'onImage';
}

export function BackButton({ onPress, label, noPrint = false, tone = 'surface' }: BackButtonProps) {
  const t = useTheme();
  const { t: tx } = useT();

  const printProps =
    noPrint && Platform.OS === 'web'
      ? // dataSet → data-no-print="true" on react-native-web. A raw
        // 'data-no-print' prop is dropped by RNW's prop allow-list.
        ({ dataSet: { noPrint: 'true' } } as object)
      : {};
  const onImage = tone === 'onImage';
  const fg = onImage ? t.colors.heroChipText : t.colors.text;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ? tx('actions.goBackTo', { label }) : tx('actions.goBack')}
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        onImage
          ? {
              backgroundColor: t.colors.heroGlass,
              borderColor: t.colors.heroChipBg,
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.md,
              opacity: pressed ? 0.8 : 1,
            }
          : {
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
      <Icon name="chevron-left" size={18} color={onImage ? fg : t.colors.primary} />
      <Text style={[t.typography.caption, { color: fg, fontWeight: '600', fontSize: 14 }]}>
        {label ?? tx('actions.back')}
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
