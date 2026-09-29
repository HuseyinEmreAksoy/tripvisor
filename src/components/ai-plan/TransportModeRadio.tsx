/**
 * TransportModeRadio — visual transport-mode selector shared by the new-trip
 * form and the AI-plan form (M5 Y2.4: one component for both, so the two
 * trip-creation entry points feel like one product).
 *
 * Y2.4: lighter tiles (no glow or drop shadow — the 2 px teal edge and the
 * tint carry the selection) and translated labels (`trip:transport.*`).
 *
 * Accessibility: a `radiogroup` of `radio`s, each named by its text label;
 * the icon is decorative.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { TransportMode } from '@/api';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { Icon } from '@/components/Icon';
import { TRIP_TRANSPORT_MODES, transportIcon, transportKey } from '@/components/transportModes';

export interface TransportModeRadioProps {
  /** Visible group label; defaults to trip:new.fields.mode ("Travel mode"). */
  label?: string;
  value: TransportMode;
  onChange: (mode: TransportMode) => void;
}

export function TransportModeRadio({ label, value, onChange }: TransportModeRadioProps) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  const groupLabel = label ?? tx('new.fields.mode');
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>
        {groupLabel}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={groupLabel} style={[styles.row, { gap: t.spacing.sm }]}>
        {TRIP_TRANSPORT_MODES.map((mode) => {
          const active = mode === value;
          const optLabel = tx(transportKey(mode));
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, checked: active }}
              accessibilityLabel={optLabel}
              onPress={() => {
                haptics.select();
                onChange(mode);
              }}
              style={({ pressed }) => [
                styles.opt,
                {
                  paddingVertical: t.spacing.md,
                  borderColor: active ? t.colors.primary : t.colors.border,
                  borderWidth: active ? 2 : StyleSheet.hairlineWidth * 2,
                  borderRadius: t.radius.lg,
                  backgroundColor: active ? t.colors.gradientSubtle : t.colors.cardBgSolid,
                },
                pressed && { backgroundColor: t.colors.bgMuted },
                Platform.OS === 'web' &&
                  ({ transition: 'background-color 0.15s ease, border-color 0.15s ease', cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <Icon name={transportIcon(mode)} size={24} color={active ? t.colors.primary : t.colors.textMuted} />
              <Text
                style={[
                  t.typography.caption,
                  {
                    color: active ? t.colors.primaryInk : t.colors.text,
                    fontWeight: active ? '700' : '500',
                    textAlign: 'center',
                  },
                ]}
              >
                {optLabel}
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
    minHeight: 64,
  },
});
