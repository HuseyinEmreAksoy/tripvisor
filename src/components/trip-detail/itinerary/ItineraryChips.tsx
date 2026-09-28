/**
 * Small itinerary affordances moved out of ItineraryTab (v2 M4 X2.3, file
 * split — behavior unchanged apart from ≥44pt touch targets):
 *  - GapFillChip (v2 N4 4.2): dashed "~Nh free — fill this day" footer chip.
 *  - IdeasAddToDayRow (v2 N1 1.4): one-tap "Add to Day N" chips under Ideas.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
// Direct types import: keeps the map runtime out of this module graph.
import { dayColor } from '@/components/Map/types';
import { formatDuration } from '@/lib/formatDuration';

/** Vertical hitSlop that lifts a ~32pt chip to a ≥44pt touch target. */
const CHIP_HIT_SLOP = { top: 7, bottom: 7, left: 2, right: 2 } as const;

export function GapFillChip({
  slackMinutes,
  dayNumber,
  onPress,
}: {
  slackMinutes: number;
  dayNumber: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`About ${formatDuration(slackMinutes)} free on Day ${dayNumber} — see ideas to fill it`}
      onPress={onPress}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [
        styles.gapChip,
        {
          borderColor: t.colors.borderStrong,
          backgroundColor: t.colors.bgElevated,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.md,
          opacity: pressed ? 0.6 : 1,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
        ✨ ~{formatDuration(slackMinutes)} free — fill this day
      </Text>
    </Pressable>
  );
}

/**
 * Offers every existing day plus one new-day slot (capped at Day 10,
 * matching PlaceActionsSheet's MoveToDay).
 */
export function IdeasAddToDayRow({
  placeTitle,
  availableDays,
  disabled,
  offlineLocked,
  onMove,
}: {
  placeTitle: string;
  availableDays: number[];
  disabled?: boolean;
  /** v2 S2.8.7 / D5: move-to-day is a legacy server mutation flag-on, so it
   * cannot work offline — the chips disable with honest copy instead of
   * letting the write silently fail. Always false flag-off. */
  offlineLocked?: boolean;
  onMove: (toDayIndex: number) => void;
}) {
  const t = useTheme();
  const targets = [...availableDays];
  const maxDay = targets.length > 0 ? Math.max(...targets) : -1;
  if (maxDay < 9) targets.push(maxDay + 1);
  const locked = Boolean(disabled) || Boolean(offlineLocked);

  return (
    <View style={[styles.ideasAddRow, { gap: t.spacing.xs }]}>
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>Add to:</Text>
      {targets.map((day) => {
        const isNew = day > maxDay || availableDays.length === 0;
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            // a11y: the disabled reason rides the label so screen-reader
            // users hear WHY the chip is inert, not just "dimmed".
            accessibilityLabel={`Add ${placeTitle} to Day ${day + 1}${isNew ? ', a new day' : ''}${offlineLocked ? '. Available when back online' : ''}`}
            disabled={locked}
            onPress={() => onMove(day)}
            hitSlop={CHIP_HIT_SLOP}
            style={({ pressed }) => [
              styles.ideasDayChip,
              {
                borderColor: dayColor(day),
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.pill,
                opacity: locked ? 0.5 : pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
              {`Day ${day + 1}${isNew ? ' +' : ''}`}
            </Text>
          </Pressable>
        );
      })}
      {offlineLocked ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
          Available when back online
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ideasAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  ideasDayChip: {
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapChip: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
