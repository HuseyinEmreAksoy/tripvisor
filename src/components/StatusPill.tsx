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
  const bg =
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
          backgroundColor: bg,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.xs,
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
      <Text style={[t.typography.small, { color: '#FFFFFF' }]}>{label}</Text>
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
