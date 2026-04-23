import { Pressable, StyleSheet, Text, View } from 'react-native';
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
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.row,
          { borderColor: t.colors.border, borderRadius: t.radius.md, backgroundColor: t.colors.bgElevated },
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
              style={[
                styles.opt,
                {
                  backgroundColor: active ? t.colors.primary : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  t.typography.bodyStrong,
                  { color: active ? t.colors.primaryText : t.colors.text },
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
    borderRadius: 6,
  },
});
