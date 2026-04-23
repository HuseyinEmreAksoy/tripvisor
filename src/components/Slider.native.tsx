import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
}

/**
 * Minimal stepper-style "slider" for native.
 * Avoids the @react-native-community/slider dep for MVP — a real slider can
 * replace this in Phase 3 if gesture-driven adjustment is wanted.
 */
export function Slider({ label, value, min, max, step, onChange, unit }: Props) {
  const t = useTheme();
  const [local, setLocal] = useState(value);

  function clamp(v: number) {
    return Math.min(max, Math.max(min, v));
  }

  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      <View
        style={[
          styles.row,
          { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => {
            const next = clamp(local - step);
            setLocal(next);
            onChange(next);
          }}
          style={styles.btn}
        >
          <Text style={[t.typography.title, { color: t.colors.text }]}>−</Text>
        </Pressable>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text, flex: 1, textAlign: 'center' }]}>
          {local}
          {unit ? ` ${unit}` : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          onPress={() => {
            const next = clamp(local + step);
            setLocal(next);
            onChange(next);
          }}
          style={styles.btn}
        >
          <Text style={[t.typography.title, { color: t.colors.text }]}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    height: 48,
  },
  btn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
