/**
 * StatusPill — Redesigned with gradient backgrounds and refined shadow.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Tone = 'info' | 'success' | 'danger';

interface Props {
  tone?: Tone;
  label: string;
  loading?: boolean;
}

export function StatusPill({ tone = 'info', label, loading }: Props) {
  const t = useTheme();

  const bgColor =
    tone === 'danger'
      ? t.colors.dangerLight
      : tone === 'success'
        ? t.colors.successLight
        : t.colors.infoLight;

  const textColor =
    tone === 'danger'
      ? t.colors.danger
      : tone === 'success'
        ? t.colors.success
        : t.colors.primary;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.pill,
        {
          backgroundColor: bgColor,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.xs,
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text style={[t.typography.small, { color: textColor, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
});
