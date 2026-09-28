/**
 * SharedTimeline — read-only day-by-day itinerary for the public share page.
 *
 *   Day 2 · Tue 4 Nov · 3 stops
 *   (1)─ Belém Tower            1 h 30 min
 *    │    user note…
 *    ┆   12 min · 3.4 km
 *   (2)─ …
 *
 * No edit affordances (no drag handles, steppers, delete). Only Tier-1
 * trip fields are rendered: user titles, category, visit durations, user notes
 * and cached leg durations. Numbered dots use the map's day palette as a ring
 * (the number itself stays on theme text color for AA contrast).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { dayColor } from '@/components/Map';
import {
  dayDateLabel,
  formatTravel,
  formatVisit,
  legKey,
  type DaySection,
  type SharedTripLeg,
} from './sharedTripModel';

interface Props {
  sections: DaySection[];
  startDate: string | null;
  legIndex: globalThis.Map<string, SharedTripLeg>;
}

export function SharedTimeline({ sections, startDate, legIndex }: Props) {
  const t = useTheme();
  if (sections.length === 0) {
    return (
      <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', paddingVertical: t.spacing.xl }]}>
        No stops planned yet.
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
  const color = dayColor(section.dayIndex);
  const date = dayDateLabel(startDate, section.dayIndex);
  const title = section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`;
  const stops = section.places.length;

  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <View style={[styles.dayBar, { backgroundColor: color }]} />
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {[date, `${stops} stop${stops === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View>
        {section.places.map((place, idx) => {
          const next = section.places[idx + 1];
          const leg = next ? legIndex.get(legKey(section.dayIndex, place.id, next.id)) : undefined;
          const travel = leg ? formatTravel(leg.duration_seconds, leg.distance_meters) : null;
          const visit = formatVisit(place.visit_duration_minutes);
          const name = place.user_title ?? 'Place';
          return (
            <View key={place.id} style={[styles.row, styles.stretch, { gap: t.spacing.md }]}>
              {/* Rail: numbered ring + connector to the next stop */}
              <View style={styles.rail}>
                <View style={[styles.dot, { borderColor: color, backgroundColor: t.colors.cardBgSolid }]}>
                  <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '700' }]}>
                    {section.dayIndex < 0 ? '•' : idx + 1}
                  </Text>
                </View>
                {next ? <View style={[styles.connector, { backgroundColor: t.colors.borderStrong }]} /> : null}
              </View>

              <View style={{ flex: 1, minWidth: 0, paddingBottom: next ? t.spacing.md : 0 }}>
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
                  accessibilityLabel={[`Stop ${idx + 1}: ${name}`, visit, place.category, place.notes]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
                    {name}
                  </Text>
                  {visit || place.category ? (
                    <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                      {[place.category ? capitalize(place.category) : null, visit].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {place.notes ? (
                    <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={3}>
                      {place.notes}
                    </Text>
                  ) : null}
                </View>
                {next ? (
                  <Text style={[t.typography.small, { color: t.colors.textMuted, paddingTop: t.spacing.sm }]}>
                    {travel ? `↓ ${travel}` : '↓ Travel time not calculated'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
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
