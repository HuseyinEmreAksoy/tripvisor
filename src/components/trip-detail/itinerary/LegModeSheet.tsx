/**
 * LegModeSheet — "How do you get to <place>?" (M5 Y3.3).
 *
 * Picks the mode of ONE leg (the leg arriving at the next stop): "same as
 * the day" (clears the override — mode AND minutes together), drive, walk,
 * bike, transit, and — between scheduled stops only — flight and ferry.
 * Flight, ferry and transit take optional minutes; empty minutes means the
 * server estimates from distance (flight/ferry) or asks live transit.
 * Saving goes through `onSave` (useLegModeActions: Tier-1 write + recompute).
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import type { LegTransportMode, TransportMode } from '@/api/types';
import { LEG_MODE_ICON, acceptsMinutes, legModeOptions, parseLegMinutes } from './legModes';

export interface LegModeSheetProps {
  visible: boolean;
  onClose: () => void;
  fromTitle: string;
  toTitle: string;
  /** The stored override (`arrival_mode`), null = inherits the day default. */
  currentMode: LegTransportMode | null;
  currentMinutes: number | null;
  /** The day default this leg inherits when not overridden. */
  inheritedMode: TransportMode;
  /** Both stops are on a scheduled day (flight/ferry allowed). */
  scheduled: boolean;
  onSave: (mode: LegTransportMode | null, minutes: number | null) => Promise<boolean>;
  saving?: boolean;
  /** Translated failure text (polite alert), or null. */
  errorText?: string | null;
}

type Choice = LegTransportMode | 'inherit';

export function LegModeSheet({
  visible,
  onClose,
  fromTitle,
  toTitle,
  currentMode,
  currentMinutes,
  inheritedMode,
  scheduled,
  onSave,
  saving = false,
  errorText = null,
}: LegModeSheetProps) {
  const t = useTheme();
  const { t: tx } = useT(['routes', 'common']);
  const [choice, setChoice] = useState<Choice>(currentMode ?? 'inherit');
  const [minutesText, setMinutesText] = useState(currentMinutes ? String(currentMinutes) : '');
  const [minutesInvalid, setMinutesInvalid] = useState(false);

  // Re-seed from the row whenever the sheet (re)opens for a leg.
  useEffect(() => {
    if (!visible) return;
    setChoice(currentMode ?? 'inherit');
    setMinutesText(currentMode && currentMinutes ? String(currentMinutes) : '');
    setMinutesInvalid(false);
  }, [visible, currentMode, currentMinutes]);

  const options = legModeOptions(scheduled);
  const showMinutes = choice !== 'inherit' && acceptsMinutes(choice);

  const save = async () => {
    let minutes: number | null = null;
    if (showMinutes && minutesText.trim() !== '') {
      minutes = parseLegMinutes(minutesText);
      if (minutes === null) {
        setMinutesInvalid(true);
        return;
      }
    }
    const ok = await onSave(choice === 'inherit' ? null : choice, minutes);
    if (ok) onClose();
  };

  const row = (value: Choice, label: string, icon: React.ComponentProps<typeof Icon>['name']) => {
    const selected = choice === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={label}
        onPress={() => {
          setChoice(value);
          setMinutesInvalid(false);
        }}
        style={({ pressed }) => [
          styles.option,
          {
            borderRadius: t.radius.md,
            borderColor: selected ? t.colors.primary : t.colors.border,
            backgroundColor: selected ? t.colors.gradientSubtle : pressed ? t.colors.bgMuted : t.colors.bgElevated,
          },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Icon name={icon} size={18} color={selected ? t.colors.primaryInk : t.colors.textMuted} />
        <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]}>{label}</Text>
        {selected ? <Icon name="check" size={18} color={t.colors.primaryInk} /> : null}
      </Pressable>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={tx('sheet.title', { place: toTitle })}>
      <View style={{ gap: t.spacing.md, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ gap: 2 }}>
          <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header">
            {tx('sheet.title', { place: toTitle })}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {tx('sheet.from', { place: fromTitle })}
          </Text>
        </View>

        <View accessibilityRole="radiogroup" style={{ gap: t.spacing.xs }}>
          {row('inherit', tx('sheet.inherit', { mode: tx(`mode.${inheritedMode}`) }), 'route')}
          <View style={styles.grid}>
            {options.map((m) => (
              <View key={m} style={styles.gridCell}>
                {row(m, tx(`mode.${m}`), LEG_MODE_ICON[m])}
              </View>
            ))}
          </View>
          {!scheduled ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('sheet.flightNeedsDay')}</Text>
          ) : null}
        </View>

        {showMinutes ? (
          <TextField
            label={tx('sheet.minutesLabel')}
            value={minutesText}
            onChangeText={(v) => {
              setMinutesText(v.replace(/[^\d]/g, ''));
              setMinutesInvalid(false);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            placeholder={tx('sheet.minutesPlaceholder')}
            hint={choice === 'transit' ? tx('sheet.minutesHintTransit') : tx('sheet.minutesHint')}
            error={minutesInvalid ? tx('sheet.minutesInvalid') : null}
            accessibilityLabel={tx('sheet.minutesLabel')}
          />
        ) : null}

        {errorText ? (
          <Text
            style={[t.typography.caption, { color: t.colors.danger }]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {errorText}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button label={tx('common:actions.cancel')} variant="secondary" onPress={onClose} />
          <Button label={tx('sheet.save')} onPress={() => void save()} loading={saving} disabled={saving} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  gridCell: { width: '50%', padding: 3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
