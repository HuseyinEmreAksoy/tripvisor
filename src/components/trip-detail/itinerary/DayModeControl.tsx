/**
 * DayModeControl — the day's default transport mode in the day header, plus
 * the "kept your order" note (M5 Y3.3).
 *
 * The chip shows the mode every leg of the day uses unless a leg overrides
 * it (trip_days.transport_mode ?? trips.transport_mode). Editors tap it for
 * a small sheet with the 4 routable modes and "same as the trip"; flight and
 * ferry are per-leg only. trip_days writes are online-only (read-only
 * Tier-1 root), so offline the sheet explains that instead of failing.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import type { TransportMode } from '@/api/types';
import { DAY_MODES, LEG_MODE_ICON } from './legModes';

export interface DayModeControlProps {
  dayNumber: number;
  /** `trip_days.transport_mode` (null = inherit the trip). */
  dayMode: TransportMode | null;
  tripMode: TransportMode;
  canEdit: boolean;
  online: boolean;
  onChange: (mode: TransportMode | null) => Promise<boolean>;
  saving?: boolean;
  /** Translated failure text (polite alert), or null. */
  errorText?: string | null;
}

export function DayModeControl({
  dayNumber,
  dayMode,
  tripMode,
  canEdit,
  online,
  onChange,
  saving = false,
  errorText = null,
}: DayModeControlProps) {
  const t = useTheme();
  const { t: tx } = useT('routes');
  const [open, setOpen] = useState(false);
  const effective = dayMode ?? tripMode;
  const label = tx(`mode.${effective}`);
  const a11y = tx('day.a11y', { day: dayNumber, mode: label });

  const chipStyle = [
    styles.chip,
    {
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.bgMuted,
      borderColor: dayMode ? t.colors.primary : t.colors.border,
    },
  ];
  const body = (
    <>
      <Icon name={LEG_MODE_ICON[effective]} size={13} color={t.colors.textMuted} />
      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>{label}</Text>
    </>
  );

  if (!canEdit) {
    return (
      <View style={chipStyle} accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }

  const choose = async (mode: TransportMode | null) => {
    if (saving) return;
    const ok = await onChange(mode);
    if (ok) setOpen(false);
  };

  const option = (value: TransportMode | null, text: string, icon: React.ComponentProps<typeof Icon>['name']) => {
    const selected = value === dayMode;
    return (
      <Pressable
        key={value ?? 'inherit'}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled: !online }}
        accessibilityLabel={text}
        disabled={!online}
        onPress={() => void choose(value)}
        style={({ pressed }) => [
          styles.option,
          {
            borderRadius: t.radius.md,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.gradientSubtle : pressed ? t.colors.bgMuted : t.colors.bgElevated,
            opacity: online ? 1 : 0.5,
          },
          Platform.OS === 'web' && ({ cursor: online ? 'pointer' : 'not-allowed' } as ViewStyle),
        ]}
      >
        <Icon name={icon} size={18} color={selected ? t.colors.primaryInk : t.colors.textMuted} />
        <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]}>{text}</Text>
        {selected ? <Icon name="check" size={18} color={t.colors.primaryInk} /> : null}
      </Pressable>
    );
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={tx('day.hint')}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={({ pressed }) => [
          ...chipStyle,
          { opacity: pressed ? 0.7 : 1 },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        {body}
        <Icon name="chevron-right" size={12} color={t.colors.textMuted} />
      </Pressable>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        accessibilityLabel={tx('day.title', { day: dayNumber })}
      >
        <View style={{ gap: t.spacing.md, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <View style={{ gap: 2 }}>
            <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header">
              {tx('day.title', { day: dayNumber })}
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{tx('day.subtitle')}</Text>
          </View>
          <View accessibilityRole="radiogroup" style={{ gap: t.spacing.xs }}>
            {option(null, tx('day.inherit', { mode: tx(`mode.${tripMode}`) }), 'route')}
            {DAY_MODES.map((m) => option(m, tx(`mode.${m}`), LEG_MODE_ICON[m]))}
          </View>
          {!online ? (
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              accessibilityLiveRegion="polite"
            >
              {tx('errors.dayOffline')}
            </Text>
          ) : errorText ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger }]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              {errorText}
            </Text>
          ) : null}
        </View>
      </BottomSheet>
    </>
  );
}

/** "Kept your order because this day has a flight" (optimized mode only). */
export function KeptOrderNote({ reason }: { reason: 'flight' | 'ferry' }) {
  const t = useTheme();
  const { t: tx } = useT('routes');
  return (
    <View
      style={[
        styles.note,
        { backgroundColor: t.colors.infoLight, borderRadius: t.radius.md, gap: t.spacing.xs },
      ]}
      accessible
      accessibilityRole="text"
    >
      <Icon name={LEG_MODE_ICON[reason]} size={14} color={t.colors.info} />
      <Text style={[t.typography.caption, { color: t.colors.info, flex: 1, fontWeight: '600' }]}>
        {reason === 'flight' ? tx('keptOrder.flight') : tx('keptOrder.ferry')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  note: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
});
