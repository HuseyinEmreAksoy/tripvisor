/**
 * DayTimelineList — today's plan as a compact vertical timeline
 * (v2 M4 X2.1). One row per stop: planned arrival, name, and a check-off
 * control. Tapping a row toggles Done (a Skipped stop toggles back to open).
 * The next stop is highlighted; past, unchecked stops are muted.
 *
 * M5 Y2.4: the rail and the next-stop dot wear the day's colour (the same
 * `dayColor` as the itinerary rail and the map legs), and every string is
 * translated (`today:timeline.*`).
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { formatClockTime } from '@/components/trip-detail/computeDayTimeline';
import { dayColor, useTheme, withAlpha } from '@/theme';
import { useT } from '@/i18n';
import type { CheckoffStatus } from './todayPlan';
import { MIN_TOUCH, useTodayCardStyle } from './todayStyles';

export interface TimelineItem {
  placeId: string;
  title: string;
  arrivalMinutes: number;
  departureMinutes: number;
  travelUnknown: boolean;
  status: CheckoffStatus | undefined;
  isNext: boolean;
  /** Planned departure already behind the clock. */
  isPast: boolean;
}

export interface DayTimelineListProps {
  heading: string;
  items: ReadonlyArray<TimelineItem>;
  onToggle: (placeId: string) => void;
  /** 0-based trip day (colours the rail); null → the brand primary. */
  dayIndex?: number | null;
}

export function DayTimelineList({ heading, items, onToggle, dayIndex = null }: DayTimelineListProps) {
  const t = useTheme();
  const { t: tx } = useT('today');
  const card = useTodayCardStyle();
  if (items.length === 0) return null;
  const doneCount = items.filter((i) => i.status).length;
  const accent = dayIndex !== null && dayIndex >= 0 ? dayColor(dayIndex) : t.colors.primary;
  const rail = dayIndex !== null && dayIndex >= 0 ? withAlpha(accent, 0.4) : t.colors.border;

  return (
    <View style={card}>
      <View style={styles.headRow}>
        <View style={styles.headTitle}>
          <View style={[styles.headDot, { backgroundColor: accent }]} />
          <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
            {heading}
          </Text>
        </View>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {tx('timeline.checked', { done: doneCount, total: items.length })}
        </Text>
      </View>
      <View>
        {items.map((item, i) => {
          const checked = item.status !== undefined;
          const muted = checked || (item.isPast && !item.isNext);
          const dotColor = item.isNext ? accent : checked ? t.colors.success : t.colors.borderStrong;
          const statusWord =
            item.status === 'done'
              ? tx('timeline.status.done')
              : item.status === 'skipped'
                ? tx('timeline.status.skipped')
                : tx('timeline.status.open');
          const time = formatClockTime(item.arrivalMinutes);
          return (
            <Pressable
              key={item.placeId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={
                item.isNext
                  ? tx('timeline.rowNextA11y', { time, title: item.title, status: statusWord })
                  : tx('timeline.rowA11y', { time, title: item.title, status: statusWord })
              }
              accessibilityHint={checked ? tx('timeline.hintReopen') : tx('timeline.hintDone')}
              onPress={() => onToggle(item.placeId)}
              style={({ pressed }) => [
                styles.row,
                { gap: t.spacing.md, opacity: pressed ? 0.7 : 1 },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <Text
                style={[
                  t.typography.caption,
                  styles.time,
                  { color: item.isNext ? t.colors.primaryInk : t.colors.textMuted },
                ]}
              >
                {time}
                {item.travelUnknown ? '*' : ''}
              </Text>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: dotColor, borderColor: t.colors.cardBgSolid }]}>
                  {checked ? (
                    <Text style={[styles.dotMark, { color: t.colors.textInverse }]}>
                      {item.status === 'done' ? '✓' : '–'}
                    </Text>
                  ) : null}
                </View>
                {i < items.length - 1 ? <View style={[styles.line, { backgroundColor: rail }]} /> : null}
              </View>
              <View style={styles.body}>
                <Text
                  style={[
                    item.isNext ? t.typography.bodyStrong : t.typography.body,
                    {
                      color: muted ? t.colors.textMuted : t.colors.text,
                      textDecorationLine: item.status === 'done' ? 'line-through' : 'none',
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                  {item.status === 'skipped'
                    ? tx('timeline.skipped')
                    : item.isNext
                      ? tx('timeline.untilNext', { time: formatClockTime(item.departureMinutes) })
                      : tx('timeline.until', { time: formatClockTime(item.departureMinutes) })}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headDot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'stretch', minHeight: MIN_TOUCH + 8 },
  time: { width: 52, paddingTop: 2, fontVariant: ['tabular-nums'] },
  rail: { width: 20, alignItems: 'center' },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotMark: { fontSize: 11, fontWeight: '800', lineHeight: 13 },
  line: { width: 3, flex: 1, marginVertical: 2, borderRadius: 2 },
  body: { flex: 1, paddingBottom: 12 },
});
