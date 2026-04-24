import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface VisitDurationStepperProps {
  minutes: number;
  onChange: (minutes: number) => void;
  stepMinutes?: number;
  minMinutes?: number;
  maxMinutes?: number;
  label?: string;
}

export function VisitDurationStepper({
  minutes,
  onChange,
  stepMinutes = 15,
  minMinutes = 15,
  maxMinutes = 12 * 60,
  label = 'Visit duration',
}: VisitDurationStepperProps) {
  const t = useTheme();
  const [local, setLocal] = useState(minutes);

  useEffect(() => setLocal(minutes), [minutes]);

  const commit = (v: number) => {
    const clamped = Math.max(minMinutes, Math.min(maxMinutes, v));
    setLocal(clamped);
    onChange(clamped);
  };

  const handleKey = Platform.OS === 'web'
    ? (e: { key?: string; preventDefault?: () => void }) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault?.();
          commit(local + stepMinutes);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault?.();
          commit(local - stepMinutes);
        }
      }
    : undefined;

  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{ min: minMinutes, max: maxMinutes, now: local, text: formatMinutes(local) }}
        accessibilityActions={[
          { name: 'increment', label: 'Increase' },
          { name: 'decrement', label: 'Decrease' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') commit(local + stepMinutes);
          if (e.nativeEvent.actionName === 'decrement') commit(local - stepMinutes);
        }}
        // @ts-expect-error web-only keyboard
        onKeyDown={handleKey}
        tabIndex={0}
        style={[
          styles.row,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label} by ${stepMinutes} minutes`}
          onPress={() => commit(local - stepMinutes)}
          disabled={local <= minMinutes}
          style={styles.btn}
        >
          <Text style={[t.typography.title, { color: t.colors.text, opacity: local <= minMinutes ? 0.4 : 1 }]}>−</Text>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.bodyStrong, { color: t.colors.text, flex: 1, textAlign: 'center' }]}
        >
          {formatMinutes(local)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label} by ${stepMinutes} minutes`}
          onPress={() => commit(local + stepMinutes)}
          disabled={local >= maxMinutes}
          style={styles.btn}
        >
          <Text style={[t.typography.title, { color: t.colors.text, opacity: local >= maxMinutes ? 0.4 : 1 }]}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
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
