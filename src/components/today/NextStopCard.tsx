/**
 * NextStopCard — the hero of the Today tab (v2 M4 X2.1).
 *
 * Shows the next stop's name, planned arrival and time left, an optional
 * "≈ N min from you" (straight-line estimate — only after the user grants
 * location; no routing or Google call), and the day's primary actions:
 * Navigate (device maps app), Done / Skip (per-device check-off), Open on
 * map, Add a place to today.
 *
 * Also renders the two non-"next" day states (nothing scheduled / day done)
 * so the card slot never collapses.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { TransportMode } from '@/api/types';
import type { LocationStatus } from '@/hooks/useCurrentLocation';
import { formatClockTime } from '@/components/trip-detail/computeDayTimeline';
import { useTheme } from '@/theme';
import { TodayAction } from './TodayAction';
import { approxTravelMinutes, formatMinutesLeft, type LatLng, type NextStopResult } from './todayPlan';
import { useTodayCardStyle } from './todayStyles';
import { useLocationExplainer } from '@/components/permissions';

export interface NextStopPlace {
  id: string;
  title: string;
  lat: number;
  lng: number;
}

export interface NextStopCardProps {
  result: NextStopResult;
  /** The place behind `result.stop` when kind === 'next'. */
  place: NextStopPlace | null;
  /** The hop into this stop had no computed leg — arrival time is optimistic. */
  travelUnknown: boolean;
  mode: TransportMode;
  location: LatLng | null;
  locationStatus: LocationStatus;
  onRequestLocation: () => void;
  onNavigate: () => void;
  onDone: () => void;
  onSkip: () => void;
  onOpenMap: () => void;
  /** Null when the viewer can't edit the trip. */
  onAddPlace: (() => void) | null;
}

export function NextStopCard(props: NextStopCardProps) {
  const t = useTheme();
  const card = useTodayCardStyle();
  // v2 M4 X3.2: explain before the OS prompt.
  const locationExplainer = useLocationExplainer({ reason: 'distance', onProceed: props.onRequestLocation });
  const { result, place } = props;

  const secondaryActions = (
    <View style={[styles.row, { gap: t.spacing.sm }]}>
      <TodayAction label="Open on map" icon="map" variant="ghost" onPress={props.onOpenMap} />
      {props.onAddPlace ? (
        <TodayAction
          label="Add a place"
          icon="plus"
          variant="ghost"
          onPress={props.onAddPlace}
          accessibilityLabel="Add a place to today"
        />
      ) : null}
    </View>
  );

  if (result.kind !== 'next' || !place) {
    const finished = result.kind === 'finished';
    return (
      <View style={card}>
        <Text style={[t.typography.overline, { color: t.colors.primaryInk }]}>
          {finished ? 'Day complete' : 'Free day'}
        </Text>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {finished ? "That's everything planned for today" : 'Nothing planned for today'}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {finished ? 'Every stop is checked off. Enjoy the evening!' : 'Add a place to today, or just wander.'}
        </Text>
        {secondaryActions}
      </View>
    );
  }

  const { stop, phase, minutesLeft, minutesLate, remainingUnchecked } = result;
  const arrival = formatClockTime(stop.arrivalMinutes);
  const departure = formatClockTime(stop.departureMinutes);
  const timing =
    phase === 'late'
      ? `Planned until ${departure} · ${formatMinutesLeft(Math.max(1, minutesLate))} behind`
      : phase === 'now'
      ? `Planned until ${departure} · ${formatMinutesLeft(minutesLeft)} left`
      : `Arrive ${arrival}${props.travelUnknown ? '*' : ''} · in ${formatMinutesLeft(minutesLeft)}`;
  const eta =
    props.locationStatus === 'granted' && props.location
      ? approxTravelMinutes(props.location, place, props.mode)
      : null;

  return (
    <View style={card}>
      <Text style={[t.typography.overline, { color: t.colors.primaryInk }]}>
        {phase === 'late' ? 'Running late' : phase === 'now' ? "You're here now" : 'Next stop'}
      </Text>
      <Text
        style={[t.typography.title, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={2}
        numberOfLines={2}
      >
        {place.title}
      </Text>
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{timing}</Text>
      {phase === 'late' ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
          {remainingUnchecked > 1
            ? `${remainingUnchecked} stops left today · Done or Skip moves you on to the next one.`
            : "Last stop today · mark it Done or Skip when you're finished."}
        </Text>
      ) : null}
      {props.travelUnknown && phase === 'upcoming' ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          * Travel time unknown — route not computed yet.
        </Text>
      ) : null}

      {eta !== null ? (
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted }]}
          accessibilityLabel={`Approximately ${eta} minutes from you, estimated in a straight line`}
        >
          {`≈ ${formatMinutesLeft(eta)} from you (approx.)`}
        </Text>
      ) : props.locationStatus === 'idle' || props.locationStatus === 'error' ? (
        <TodayAction
          label="How far am I?"
          icon="map-pin"
          variant="ghost"
          onPress={locationExplainer.ask}
          accessibilityHint="Uses your location once to estimate the distance. Nothing is sent anywhere."
        />
      ) : props.locationStatus === 'requesting' ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
          Finding you…
        </Text>
      ) : null}
      {locationExplainer.sheet}

      <TodayAction
        label="Navigate"
        icon="compass"
        variant="primary"
        onPress={props.onNavigate}
        accessibilityLabel={`Navigate to ${place.title}`}
        accessibilityHint="Opens directions in your maps app"
      />
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <TodayAction label="Done" grow onPress={props.onDone} accessibilityLabel={`Mark ${place.title} done`} />
        <TodayAction label="Skip" grow onPress={props.onSkip} accessibilityLabel={`Skip ${place.title}`} />
      </View>
      {secondaryActions}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
