/**
 * DayTimelineList — today's plan as a compact vertical timeline
 * (v2 M4 X2.1). One row per stop: planned arrival, name, and a check-off
 * control. Tapping a row toggles Done (a Skipped stop toggles back to open).
 * The next stop is highlighted; past, unchecked stops are muted.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { formatClockTime } from '@/components/trip-detail/computeDayTimeline';
import { useTheme } from '@/theme';
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
}

export function DayTimelineList({ heading, items, onToggle }: DayTimelineListProps) {
  const t = useTheme();
  const card = useTodayCardStyle();
  if (items.length === 0) return null;
  const doneCount = items.filter((i) => i.status).length;

  return (
    <View style={card}>
      <View style={styles.headRow}>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {heading}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {`${doneCount}/${items.length} checked off`}
        </Text>
      </View>
      <View>
        {items.map((item, i) => {
          const checked = item.status !== undefined;
          const muted = checked || (item.isPast && !item.isNext);
          const dotColor = item.isNext ? t.colors.primary : checked ? t.colors.success : t.colors.borderStrong;
          const statusWord = item.status === 'done' ? 'done' : item.status === 'skipped' ? 'skipped' : 'not done';
          return (
            <Pressable
              key={item.placeId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={`${formatClockTime(item.arrivalMinutes)}, ${item.title}, ${statusWord}${item.isNext ? ', next stop' : ''}`}
              accessibilityHint={checked ? 'Tap to reopen' : 'Tap to mark done'}
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
                {formatClockTime(item.arrivalMinutes)}
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
                {i < items.length - 1 ? <View style={[styles.line, { backgroundColor: t.colors.border }]} /> : null}
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
                    ? 'Skipped'
                    : `until ${formatClockTime(item.departureMinutes)}${item.isNext ? ' · next' : ''}`}
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
  line: { width: 2, flex: 1, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 12 },
});
