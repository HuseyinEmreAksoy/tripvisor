/**
 * TravelConnector — the "↓ Travel ~12 min · 1.4 km" line between two place
 * cards (extracted from PlaceRow in v2 M4 X2.3).
 *
 * Transit trips show the named rides (v2 P1.2, "🚇 M2 → ~12 min") plus a
 * "Plan transit ↗" deep link. X2.3 bug fix: the v1 link carried only an
 * ORIGIN, so Google Maps opened with no destination. The link now goes
 * through `buildDirectionsUrl`/`openDirections` with the NEXT stop's
 * coordinates (resolved by ItineraryTab from its leg index) as the
 * destination and this stop as the origin. Without a known next stop the
 * link is hidden rather than opening a half-empty planner.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';
import { formatDurationSeconds } from '@/lib/formatDuration';
import { openDirections, type DirectionsPoint } from '@/lib/directions';
import { haptics } from '@/lib/haptics';
import type { TransportMode, TripLeg } from '@/api';

export interface TravelConnectorProps {
  legAfter: TripLeg | undefined;
  transportMode: TransportMode;
  /** This stop — the directions origin. */
  from: DirectionsPoint;
  /** The next stop in the day — the directions destination. */
  to: DirectionsPoint | null | undefined;
}

export function TravelConnector({ legAfter, transportMode, from, to }: TravelConnectorProps) {
  const t = useTheme();

  if (transportMode === 'transit' && legAfter) {
    const lineNames = (legAfter.transit_steps ?? [])
      .filter((s) => s.travelMode === 'TRANSIT' && s.lineName)
      .map((s) => s.lineName as string);
    const durationLabel = formatDurationSeconds(legAfter.duration_seconds);
    const minutes = Math.round(legAfter.duration_seconds / 60);
    return (
      <View style={[styles.row, { gap: t.spacing.xs }]}>
        {lineNames.length > 0 ? (
          <Icon name="train-front" size={13} color={t.colors.textMuted} />
        ) : null}
        <Text
          style={[t.typography.small, { color: t.colors.textMuted }]}
          accessibilityLabel={
            lineNames.length > 0
              ? `Transit via ${lineNames.join(', then ')}, approximately ${minutes} minutes`
              : `Travel to next, approximately ${minutes} minutes`
          }
        >
          {lineNames.length > 0
            ? `${lineNames.join(' → ')} → ~${durationLabel}`
            : `↓ Travel ~${durationLabel}`}
        </Text>
        {to ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Plan transit to ${to.label ?? 'the next stop'} in your maps app, opens external`}
            onPress={() => {
              haptics.tap();
              void openDirections({ origin: from, destination: to, mode: 'transit' });
            }}
            // ≥44pt target on a single line of small text.
            hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
          >
            <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '600' }]}>
              {'· Plan transit ↗'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Text
      style={[t.typography.small, { color: t.colors.textMuted }]}
      accessibilityLabel={
        legAfter
          ? `Travel to next, approximately ${Math.round(legAfter.duration_seconds / 60)} minutes`
          : 'Travel time unknown'
      }
    >
      {'↓ Travel '}
      {legAfter ? `~${formatDurationSeconds(legAfter.duration_seconds)}` : '—'}
      {legAfter
        ? ` · ${(legAfter.distance_meters / 1000).toFixed(legAfter.distance_meters < 10000 ? 1 : 0)} km`
        : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
