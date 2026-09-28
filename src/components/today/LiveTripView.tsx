/**
 * LiveTripView — the Today tab while a trip is running (v2 M4 X2.1).
 *
 * Next stop (navigate / done / skip), today's compact timeline, tonight's
 * stay, today's weather and quick actions (add expense, packing, open
 * trip). Phones: one column, next stop first. Desktop (≥1024): the plan on
 * the left, the day's context on the right.
 *
 * No Google or routing calls from here: directions open the device maps app
 * via a URL, the "≈ N min from you" figure is a straight-line estimate, and
 * weather is Open-Meteo (keyless) through the existing hook.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Trip, TripAccommodation } from '@/api';
import { ExpenseEditSheet } from '@/components/budget/ExpenseEditSheet';
import { WeatherChip } from '@/components/trip-detail/WeatherChip';
import { Button } from '@/components/Button';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { openDirections } from '@/lib/directions';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme';
import { DayTimelineList, type TimelineItem } from './DayTimelineList';
import { NextStopCard } from './NextStopCard';
import { TodayAction } from './TodayAction';
import { TonightStayCard } from './TonightStayCard';
import {
  buildAddressDirectionsUrl,
  minutesSinceMidnight,
  selectNextStop,
  tripDayCount,
  type CheckoffStatus,
  type PlanStop,
} from './todayPlan';
import { useDayCheckoffs } from './useDayCheckoffs';
import { useLiveDayPlan } from './useLiveDayPlan';
import { useTodayCardStyle } from './todayStyles';

export interface LiveTripViewProps {
  trip: Trip;
  now: Date;
  isDesktop: boolean;
}

const UNDO_MS = 6_000;

export function LiveTripView({ trip, now, isDesktop }: LiveTripViewProps) {
  const t = useTheme();
  const router = useRouter();
  const card = useTodayCardStyle();
  const plan = useLiveDayPlan(trip, now);
  const { checkoffs, setCheckoff } = useDayCheckoffs(trip.id, plan.dayIndex);
  const { location, status: locationStatus, request: requestLocation } = useCurrentLocation();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [lastMark, setLastMark] = useState<{ placeId: string; title: string; status: CheckoffStatus } | null>(
    null,
  );
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const canEdit = trip.isOwner !== false || trip.collaboratorRole === 'editor';
  const nowMinutes = minutesSinceMidnight(now);
  const dayCount = tripDayCount(trip.start_date, trip.end_date) ?? 1;

  const stops = useMemo<PlanStop[]>(
    () =>
      plan.places
        .map((p) => plan.timeline.get(p.id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({ placeId: s.placeId, arrivalMinutes: s.arrivalMinutes, departureMinutes: s.departureMinutes })),
    [plan.places, plan.timeline],
  );
  const next = selectNextStop({ stops, nowMinutes, checkoffs });
  const nextPlace = next.kind === 'next' ? plan.places.find((p) => p.id === next.stop.placeId) ?? null : null;
  const titleOf = (id: string) => plan.places.find((p) => p.id === id)?.user_title ?? 'Place';

  const items: TimelineItem[] = plan.places.map((p) => {
    const stop = plan.timeline.get(p.id);
    return {
      placeId: p.id,
      title: p.user_title ?? 'Place',
      arrivalMinutes: stop?.arrivalMinutes ?? 0,
      departureMinutes: stop?.departureMinutes ?? 0,
      travelUnknown: stop?.travelUnknown ?? false,
      status: checkoffs[p.id],
      isNext: next.kind === 'next' && next.stop.placeId === p.id,
      isPast: (stop?.departureMinutes ?? 0) <= nowMinutes,
    };
  });

  const mark = (placeId: string, status: CheckoffStatus) => {
    setCheckoff(placeId, status);
    if (status === 'done') haptics.success();
    else haptics.tap();
    setLastMark({ placeId, title: titleOf(placeId), status });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastMark(null), UNDO_MS);
  };
  const undoMark = () => {
    if (!lastMark) return;
    setCheckoff(lastMark.placeId, null);
    haptics.tap();
    setLastMark(null);
  };
  const toggle = (placeId: string) => {
    if (checkoffs[placeId]) {
      setCheckoff(placeId, null);
      haptics.tap();
    } else {
      mark(placeId, 'done');
    }
  };

  const navigateToNext = () => {
    if (!nextPlace) return;
    haptics.impact();
    void openDirections({
      destination: {
        lat: nextPlace.lat,
        lng: nextPlace.lng,
        placeId: nextPlace.google_place_id,
        label: nextPlace.user_title,
      },
      mode: trip.transport_mode,
    });
  };
  const navigateHome = (stay: TripAccommodation) => {
    haptics.impact();
    if (stay.lat != null && stay.lng != null) {
      void openDirections({
        destination: { lat: stay.lat, lng: stay.lng, placeId: stay.google_place_id, label: stay.name },
        mode: trip.transport_mode,
      });
    } else if (stay.address) {
      Linking.openURL(buildAddressDirectionsUrl(stay.address)).catch(() => undefined);
    }
  };

  const openMap = () => router.push({ pathname: '/trip/[id]', params: { id: trip.id, tab: 'map' } });
  const addPlace =
    canEdit && plan.dayIndex !== null
      ? () => router.push({ pathname: '/trip/[id]/add', params: { id: trip.id, day: String(plan.dayIndex) } })
      : null;

  if (plan.isLoading) {
    return (
      <SkeletonGroup label="Loading today's plan" style={{ gap: t.spacing.md }}>
        <Skeleton height={220} radius="xl" />
        <Skeleton height={160} radius="xl" />
      </SkeletonGroup>
    );
  }

  if (plan.error) {
    return (
      <View style={card}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} accessibilityRole="alert">
          Couldn't load today's plan.
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{plan.error.message}</Text>
        <Button label="Retry" fullWidth={false} onPress={plan.refetchPlaces} />
      </View>
    );
  }

  const nextStop = next.kind === 'next' ? plan.timeline.get(next.stop.placeId) : undefined;

  const nextCard = (
    <NextStopCard
      result={next}
      place={nextPlace ? { id: nextPlace.id, title: nextPlace.user_title ?? 'Place', lat: nextPlace.lat, lng: nextPlace.lng } : null}
      travelUnknown={nextStop?.travelUnknown ?? false}
      mode={trip.transport_mode}
      location={location}
      locationStatus={locationStatus}
      onRequestLocation={() => void requestLocation()}
      onNavigate={navigateToNext}
      onDone={() => next.kind === 'next' && mark(next.stop.placeId, 'done')}
      onSkip={() => next.kind === 'next' && mark(next.stop.placeId, 'skipped')}
      onOpenMap={openMap}
      onAddPlace={addPlace}
    />
  );

  const undoBar = lastMark ? (
    <View
      style={[
        styles.undo,
        { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderRadius: t.radius.lg, padding: t.spacing.md },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[t.typography.body, styles.flex, { color: t.colors.text }]} numberOfLines={1}>
        {`${lastMark.title} ${lastMark.status === 'done' ? 'marked done' : 'skipped'}`}
      </Text>
      <TodayAction label="Undo" variant="ghost" onPress={undoMark} accessibilityLabel={`Undo: ${lastMark.title}`} />
    </View>
  ) : null;

  const timeline = (
    <DayTimelineList
      heading={plan.dayIndex !== null ? `Day ${plan.dayIndex + 1} plan` : "Today's plan"}
      items={items}
      onToggle={toggle}
    />
  );

  const contextCard = (
    <View style={card}>
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <Text style={[t.typography.overline, styles.flex, { color: t.colors.textMuted }]}>
          {plan.dayIndex !== null ? `Day ${plan.dayIndex + 1} of ${dayCount}` : 'Today'}
        </Text>
        {plan.weather ? <WeatherChip day={plan.weather} dayNumber={(plan.dayIndex ?? 0) + 1} /> : null}
      </View>
      <View style={[styles.row, styles.wrap, { gap: t.spacing.sm }]}>
        {canEdit ? (
          <TodayAction label="Add expense" icon="wallet" onPress={() => setExpenseOpen(true)} />
        ) : null}
        <TodayAction
          label="Packing"
          icon="luggage"
          variant="ghost"
          onPress={() => router.push({ pathname: '/trip/[id]/packing', params: { id: trip.id } })}
        />
        <TodayAction
          label="Open trip"
          icon="chevron-right"
          variant="ghost"
          onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
          accessibilityLabel={`Open ${trip.title}`}
        />
      </View>
      {plan.weather ? (
        <Text style={[t.typography.small, { color: t.colors.attribution }]}>Weather data by Open-Meteo.com</Text>
      ) : null}
    </View>
  );

  const stayCard = <TonightStayCard stays={plan.stays} tonight={plan.todayDate} onNavigateHome={navigateHome} />;

  const sheet = canEdit ? (
    <ExpenseEditSheet
      tripId={trip.id}
      expense={null}
      currency={trip.currency}
      visible={expenseOpen}
      onClose={() => setExpenseOpen(false)}
      tripDayCount={dayCount}
      tripStartDate={trip.start_date}
    />
  ) : null;

  if (isDesktop) {
    return (
      <View style={[styles.row, styles.top, { gap: t.spacing.xl }]}>
        <View style={[styles.main, { gap: t.spacing.lg }]}>
          {nextCard}
          {undoBar}
          {timeline}
        </View>
        <View style={[styles.side, { gap: t.spacing.lg }]}>
          {contextCard}
          {stayCard}
        </View>
        {sheet}
      </View>
    );
  }

  return (
    <View style={{ gap: t.spacing.lg }}>
      {nextCard}
      {undoBar}
      {contextCard}
      {timeline}
      {stayCard}
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
  flex: { flex: 1 },
  main: { flex: 3, minWidth: 0 },
  side: { flex: 2, minWidth: 0 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
});
