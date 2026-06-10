/**
 * TransportModeRadio — visual transport-mode selector for the AI-plan form.
 *
 * Deliberately mirrors the icon radio grid from app/(app)/trip/new.tsx (same
 * options, same active treatment) so the two trip-creation entry points feel
 * like one product. Extracted here rather than imported because trip/new
 * keeps its selector inline inside a react-hook-form Controller.
 *
 * Accessibility: each option is a `radio` with a text label separate from the
 * decorative emoji (the emoji is hidden from screen readers — unlike the
 * inline original, which let VoiceOver read "automobile" first).
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { TransportMode } from '@/api';
import { useTheme } from '@/theme';

export interface TransportModeRadioProps {
  label?: string;
  value: TransportMode;
  onChange: (mode: TransportMode) => void;
}

// Same order + icons as trip/new.tsx (bicycling sits between walking and
// transit per the Phase 23 spec).
const OPTIONS: Array<{ value: TransportMode; icon: string; label: string }> = [
  { value: 'driving', icon: '🚗', label: 'Drive' },
  { value: 'walking', icon: '🚶', label: 'Walk' },
  { value: 'bicycling', icon: '🚲', label: 'Bike' },
  { value: 'transit', icon: '🚆', label: 'Transit' },
];

export function TransportModeRadio({ label = 'Travel mode', value, onChange }: TransportModeRadioProps) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
        {label}
      </Text>
      <View accessibilityRole="radiogroup" style={[styles.row, { gap: t.spacing.sm }]}>
        {OPTIONS.map((opt) => {
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
                  paddingVertical: t.spacing.md,
                  borderColor: active ? t.colors.primary : t.colors.border,
                  borderRadius: t.radius.lg,
                  backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                  ...(active
                    ? t.shadows.glow(t.colors.glowPrimary)
                    : t.shadows.sm(t.colors.shadowColor)),
                },
                pressed && { opacity: 0.8 },
                Platform.OS === 'web' &&
                  ({ transition: 'all 0.2s ease', cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <Text
                style={{ fontSize: 28 }}
                accessibilityElementsHidden
                importantForAccessibility="no"
                aria-hidden
              >
                {opt.icon}
              </Text>
              <Text
                style={[
                  t.typography.caption,
                  {
                    color: active ? t.colors.primary : t.colors.text,
                    fontWeight: active ? '700' : '500',
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
  row: { flexDirection: 'row' },
  opt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 2,
  },
});
