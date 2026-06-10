/**
 * SegmentedControl — v2 "Tide & Terracotta" primitive.
 *
 * Pill-shaped muted track; the active option is an elevated floating pill
 * with bold ink text (iOS-style), inactive options are quiet muted text.
 * Roles: radiogroup / radio with selected state — unchanged.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

interface Props<T extends string> {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      {label ? (
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.row,
          {
            borderRadius: t.radius.pill,
            backgroundColor: t.colors.bgMuted,
          },
        ]}
        accessibilityRole="radiogroup"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              onPress={() => onChange(opt.value)}
              style={({ pressed }) => [
                styles.opt,
                {
                  backgroundColor: active ? t.colors.cardBgSolid : 'transparent',
                  borderRadius: t.radius.pill,
                  ...(active ? t.shadows.sm(t.colors.shadowColorStrong) : {}),
                },
                pressed && !active && { backgroundColor: t.colors.gradientSubtle },
                Platform.OS === 'web' && ({
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                } as ViewStyle),
              ]}
            >
              <Text
                style={[
                  t.typography.bodyStrong,
                  {
                    color: active ? t.colors.text : t.colors.textMuted,
                    fontSize: 14,
                    fontWeight: active ? '700' : '600',
                  },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  opt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
});
