/**
 * DayPicker — "Add to" chip row + next-day stepper for the add-place screen.
 *
 * Chips are built from the trip's date range (start_date..end_date), not
 * from the days that already have places — so a fresh 3-day trip offers
 * Day 1, Day 2, Day 3 and Ideas. `null` is the Ideas bucket (day_index NULL).
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { dayColor } from '@/components/Map/types';

// Guard against a garbage date range rendering hundreds of chips.
export const MAX_PICKER_DAYS = 60;

// Day palette colors are fixed (not themed) and designed for white labels —
// same foreground the pre-extraction chips used.
const ON_DAY_COLOR = '#FFFFFF';

function parseIsoDateUtc(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Number of days to offer in the picker.
 *   - Both dates set → inclusive day count of the range (clamped 1..MAX).
 *   - Otherwise → enough days to cover every already-scheduled place, min 1.
 */
export function tripDayCount(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  scheduledDayIndexes: ReadonlyArray<number | null> = [],
): number {
  const maxScheduled = scheduledDayIndexes.reduce<number>(
    (m, d) => (d !== null && d >= 0 ? Math.max(m, d) : m),
    -1,
  );
  const start = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);
  let fromRange = 0;
  if (start !== null && end !== null && end >= start) {
    fromRange = Math.round((end - start) / 86_400_000) + 1;
  }
  // Never hide a day that already has places (e.g. dates shortened later).
  const count = Math.max(fromRange, maxScheduled + 1, 1);
  return Math.min(count, MAX_PICKER_DAYS);
}

export function dayLabel(dayIndex: number | null): string {
  return dayIndex === null ? 'Ideas' : `Day ${dayIndex + 1}`;
}

export interface DayPickerProps {
  dayCount: number;
  /** null = Ideas bucket. */
  selected: number | null;
  onSelect: (dayIndex: number | null) => void;
}

export function DayPicker({ dayCount, selected, onSelect }: DayPickerProps) {
  const t = useTheme();
  const values: Array<number | null> = [
    ...Array.from({ length: dayCount }, (_, i) => i),
    null,
  ];
  const isIdeas = selected === null;
  const isLastDay = selected !== null && selected >= dayCount - 1;
  const nextLabel = isLastDay ? 'Add to Ideas' : `Switch to Day ${(selected ?? 0) + 2}`;

  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
        Add to
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.spacing.sm }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Select day to add place"
      >
        {values.map((dayIdx) => {
          const isSelected = selected === dayIdx;
          const chipColor = dayIdx !== null ? dayColor(dayIdx) : undefined;
          const label = dayLabel(dayIdx);
          return (
            <Pressable
              key={dayIdx === null ? 'ideas' : String(dayIdx)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: isSelected }}
              onPress={() => onSelect(dayIdx)}
              style={[
                styles.chip,
                {
                  borderColor: isSelected ? (chipColor ?? t.colors.primary) : t.colors.border,
                  backgroundColor: isSelected
                    ? (chipColor ?? t.colors.primary)
                    : t.colors.bgElevated,
                  borderRadius: t.radius.md,
                },
              ]}
            >
              {chipColor ? (
                <View
                  style={[
                    styles.chipDot,
                    { backgroundColor: isSelected ? ON_DAY_COLOR : chipColor },
                  ]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Text
                style={[
                  t.typography.caption,
                  {
                    color: isSelected ? (chipColor ? ON_DAY_COLOR : t.colors.primaryText) : t.colors.text,
                    fontWeight: isSelected ? '600' : '400',
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!isIdeas ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nextLabel}
          onPress={() => onSelect(isLastDay ? null : (selected ?? 0) + 1)}
          style={[
            styles.stepper,
            {
              borderColor: t.colors.border,
              borderRadius: t.radius.sm,
              backgroundColor: t.colors.bgElevated,
            },
          ]}
        >
          <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>→ {nextLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    gap: 6,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  stepper: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
  },
});
