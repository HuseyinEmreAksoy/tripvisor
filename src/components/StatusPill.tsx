/**
 * StatusPill — v2 "Tide & Terracotta" chip language: tinted surface + bold
 * matching-tone text, always pill-shaped. Info tone uses the semantic info
 * color (≥4.5:1 on infoLight in both modes).
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
        : t.colors.info;

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
      {/* flexShrink: long labels ("Günlük rota hızı sınırına ulaşıldı…") wrap
          inside the pill instead of running off a 375px screen. */}
      <Text style={[t.typography.small, { color: textColor, fontWeight: '700', flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 24,
  },
});
