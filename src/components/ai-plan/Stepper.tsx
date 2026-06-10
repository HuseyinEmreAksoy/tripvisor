/**
 * Stepper — generic integer +/- control for the AI-plan flow.
 *
 * Mirrors the interaction grammar of VisitDurationStepper (the existing
 * minutes-specific control) but for arbitrary integers, in two layouts:
 *
 *   - default: full-width 48px form row — used for "How many days?" (1..14)
 *   - compact: inline 36px pill — used for the per-place "Day N" reassign
 *
 * Usage:
 *   <Stepper label="How many days?" value={days} onChange={setDays}
 *            min={1} max={14} formatValue={(v) => `${v} days`} />
 *
 * Accessibility: the value group is a single `adjustable` element with
 * increment/decrement actions (VoiceOver/TalkBack swipe up/down); the +/-
 * buttons are individually labelled; Arrow keys adjust on web when focused.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface StepperProps {
  /** Accessibility + (optionally visible) label for the control. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Render the value (e.g. `(v) => \`Day ${v}\``). Defaults to String(v). */
  formatValue?: (value: number) => string;
  /** Inline pill layout for use inside cards. */
  compact?: boolean;
  /** Show the caption label above the control. Defaults to !compact. */
  showLabel?: boolean;
}

export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  compact = false,
  showLabel = !compact,
}: StepperProps) {
  const t = useTheme();
  const display = formatValue ? formatValue(value) : String(value);

  const commit = (next: number) => {
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onChange(clamped);
  };

  // Web keyboard support when the group itself is focused.
  const handleKey =
    Platform.OS === 'web'
      ? (e: { key?: string; preventDefault?: () => void }) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault?.();
            commit(value + step);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault?.();
            commit(value - step);
          }
        }
      : undefined;

  const atMin = value <= min;
  const atMax = value >= max;
  const btnSize = compact ? 36 : 48;

  return (
    <View style={{ gap: t.spacing.xs }}>
      {showLabel ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
          {label}
        </Text>
      ) : null}
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{ min, max, now: value, text: display }}
        accessibilityActions={[
          { name: 'increment', label: 'Increase' },
          { name: 'decrement', label: 'Decrease' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') commit(value + step);
          if (e.nativeEvent.actionName === 'decrement') commit(value - step);
        }}
        // @ts-expect-error web-only keyboard handler (same pattern as VisitDurationStepper)
        onKeyDown={handleKey}
        tabIndex={0}
        style={[
          styles.row,
          {
            height: btnSize,
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            alignSelf: compact ? 'flex-start' : 'stretch',
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => commit(value - step)}
          disabled={atMin}
          hitSlop={compact ? 6 : 0}
          style={[styles.btn, { width: btnSize, height: btnSize }]}
        >
          <Text
            style={[
              compact ? t.typography.subtitle : t.typography.title,
              { color: t.colors.text, opacity: atMin ? 0.4 : 1 },
            ]}
          >
            −
          </Text>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            t.typography.bodyStrong,
            compact && { fontSize: 14 },
            {
              color: t.colors.text,
              textAlign: 'center',
              ...(compact ? { minWidth: 64, paddingHorizontal: t.spacing.xs } : { flex: 1 }),
            },
          ]}
        >
          {display}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          onPress={() => commit(value + step)}
          disabled={atMax}
          hitSlop={compact ? 6 : 0}
          style={[styles.btn, { width: btnSize, height: btnSize }]}
        >
          <Text
            style={[
              compact ? t.typography.subtitle : t.typography.title,
              { color: t.colors.text, opacity: atMax ? 0.4 : 1 },
            ]}
          >
            ＋
          </Text>
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
  },
  btn: { alignItems: 'center', justifyContent: 'center' },
});
