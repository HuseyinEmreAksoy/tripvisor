import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

export function Slider({ label, value, min, max, step, onChange, unit }: Props) {
  const t = useTheme();
  const [local, setLocal] = useState(value);

  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
        {label}: {local}
        {unit ? ` ${unit}` : ''}
      </Text>
      <View
        style={[
          styles.wrap,
          { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.md },
        ]}
      >
        {/* @ts-expect-error — HTML input via react-native-web */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={local}
          aria-label={label}
          onChange={(e: { target: { value: string } }) => {
            const v = Number(e.target.value);
            setLocal(v);
            onChange(v);
          }}
          style={{ flex: 1, accentColor: String(t.colors.primary) }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 48, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 12 },
});
