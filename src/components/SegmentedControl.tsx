/**
 * SegmentedControl — Redesigned with glassmorphism track, gradient active segment, smooth transition.
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
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.row,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.bgMuted,
            ...t.shadows.sm(t.colors.shadowColor),
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
                  backgroundColor: active ? t.colors.primary : 'transparent',
                  borderRadius: t.radius.md,
                  ...(active ? t.shadows.sm(t.colors.glowPrimary) : {}),
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
                    color: active ? t.colors.primaryText : t.colors.text,
                    fontSize: 14,
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
    borderWidth: 1,
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
