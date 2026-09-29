/**
 * SharedTimeline — read-only day-by-day itinerary for the public share page.
 *
 *   Day 2 · Tue, 4 Nov · 3 stops
 *   (1)─ Belém Tower            1h 30m
 *    │    user note…
 *    ┆   ≈ 12m · 3.4 km          (≈ = estimated leg, `source: 'estimate'`)
 *   (2)─ …
 *
 * No edit affordances (no drag handles, steppers, delete). Only Tier-1
 * trip fields are rendered: user titles, category, visit durations, user notes
 * and cached leg durations. Numbered dots use the shared day palette as a ring
 * (the number itself stays on theme text color for AA contrast).
 */
import { StyleSheet, Text, View } from 'react-native';
import { dayColor, useTheme } from '@/theme';
import { useAppLocale, useT } from '@/i18n';
import { useCategoryLabel } from '@/components/trip-detail/placeCategory';
import {
  dayDateLabel,
  formatTravel,
  formatVisit,
  isEstimatedSharedLeg,
  legKey,
  type DaySection,
  type SharedTripLeg,
  type SharedTripPlace,
} from './sharedTripModel';

interface Props {
  sections: DaySection[];
  startDate: string | null;
  legIndex: globalThis.Map<string, SharedTripLeg>;
}

export function SharedTimeline({ sections, startDate, legIndex }: Props) {
  const t = useTheme();
  const { t: tx } = useT('share');
  if (sections.length === 0) {
    return (
      <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', paddingVertical: t.spacing.xl }]}>
        {tx('timeline.empty')}
      </Text>
    );
  }
  return (
    <View style={{ gap: t.spacing.xl }}>
      {sections.map((section) => (
        <DayBlock key={section.dayIndex} section={section} startDate={startDate} legIndex={legIndex} />
      ))}
    </View>
  );
}

function DayBlock({
  section,
  startDate,
  legIndex,
}: {
  section: DaySection;
  startDate: string | null;
  legIndex: globalThis.Map<string, SharedTripLeg>;
}) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const { language } = useAppLocale();
  const color = dayColor(section.dayIndex);
  const date = dayDateLabel(startDate, section.dayIndex, language);
  const title = section.dayIndex < 0 ? tx('timeline.unscheduled') : tx('timeline.day', { day: section.dayIndex + 1 });
  const stops = tx('page.stops', { count: section.places.length });

  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <View style={[styles.dayBar, { backgroundColor: color }]} />
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {[date, stops].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View>
        {section.places.map((place, idx) => {
          const next = section.places[idx + 1];
          const leg = next ? legIndex.get(legKey(section.dayIndex, place.id, next.id)) : undefined;
          return (
            <StopRow
              key={place.id}
              place={place}
              index={idx}
              color={color}
              unscheduled={section.dayIndex < 0}
              hasNext={Boolean(next)}
              leg={leg}
            />
          );
        })}
      </View>
    </View>
  );
}

function StopRow({
  place,
  index,
  color,
  unscheduled,
  hasNext,
  leg,
}: {
  place: SharedTripPlace;
  index: number;
  color: string;
  unscheduled: boolean;
  hasNext: boolean;
  leg: SharedTripLeg | undefined;
}) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const { language } = useAppLocale();
  const categoryLabel = useCategoryLabel(place.category);
  const travel = leg ? formatTravel(leg.duration_seconds, leg.distance_meters, language) : null;
  const estimated = leg ? isEstimatedSharedLeg(leg) : false;
  const visit = formatVisit(place.visit_duration_minutes, language);
  const name = place.user_title ?? tx('timeline.place');
  const category = place.category ? categoryLabel : null;

  let travelText = tx('timeline.notCalculated');
  let travelA11y = travelText;
  if (travel) {
    travelText = estimated ? tx('timeline.estimated', { travel }) : travel;
    travelA11y = estimated ? tx('timeline.estimatedA11y', { travel }) : travel;
  }

  return (
    <View style={[styles.row, styles.stretch, { gap: t.spacing.md }]}>
      {/* Rail: numbered ring + connector to the next stop */}
      <View style={styles.rail}>
        <View style={[styles.dot, { borderColor: color, backgroundColor: t.colors.cardBgSolid }]}>
          <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '700' }]}>
            {unscheduled ? '•' : index + 1}
          </Text>
        </View>
        {hasNext ? <View style={[styles.connector, { backgroundColor: t.colors.borderStrong }]} /> : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, paddingBottom: hasNext ? t.spacing.md : 0 }}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.colors.cardBgSolid,
              borderColor: t.colors.border,
              borderRadius: t.radius.lg,
              padding: t.spacing.md,
              gap: 2,
            },
          ]}
          accessible
          accessibilityLabel={[tx('timeline.stopA11y', { n: index + 1, name }), visit, category, place.notes]
            .filter(Boolean)
            .join(', ')}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
            {name}
          </Text>
          {visit || category ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {[category, visit].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {place.notes ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={3}>
              {place.notes}
            </Text>
          ) : null}
        </View>
        {hasNext ? (
          <Text
            style={[t.typography.small, { color: t.colors.textMuted, paddingTop: t.spacing.sm }]}
            accessibilityLabel={travelA11y}
          >
            {`↓ ${travelText}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  stretch: { alignItems: 'stretch', flexWrap: 'nowrap' },
  dayBar: { width: 4, height: 20, borderRadius: 2 },
  rail: { width: 28, alignItems: 'center' },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 2, flex: 1, marginTop: 2 },
  card: { borderWidth: 1 },
});
