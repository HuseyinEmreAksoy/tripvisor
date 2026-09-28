/**
 * Today tab — STUB (v2 M4 X1.1). X2.1 replaces this with the live trip
 * companion (next stop, navigate, check-off, tonight's stay, weather).
 *
 * For now it answers one question from the Tier-1-backed trips list:
 *   - a trip is running today → "Day N of M" card + open trip
 *   - otherwise → "No trip today" + countdown to the next trip
 *   - no trips at all → the trips empty state
 * "Today" is the device's local calendar day (src/lib/tripToday.ts).
 */
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTrips } from '@/api';
import {
  Button,
  EmptyState,
  Heading,
  Screen,
  Skeleton,
  SkeletonGroup,
  TAB_SCREEN_EDGES,
} from '@/components';
import { noTrips } from '@/components/emptyStates';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { activeTripsOn, dayIndexFor, nextUpcomingTrip } from '@/lib/tripToday';
import { useTheme } from '@/theme';

function tripLength(start: string | null, end: string | null): number | null {
  if (!start) return null;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = (end ?? start).split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return null;
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}

export default function TodayScreen() {
  const t = useTheme();
  const router = useRouter();
  const isDesktop = useBreakpoint() === 'desktop';
  const { data: trips, isLoading, error, refetch, isRefetching } = useTrips({ archived: false });

  const now = new Date();
  const active = activeTripsOn(trips ?? [], now);
  const upcoming = active.length === 0 ? nextUpcomingTrip(trips ?? [], now) : null;

  const card = [
    styles.card,
    {
      backgroundColor: t.colors.cardBgSolid,
      borderColor: t.colors.border,
      borderRadius: t.radius.xl,
      padding: t.spacing.xl,
      gap: t.spacing.md,
      ...t.shadows.md(t.colors.shadowColor),
    },
  ];

  let body: ReactNode;
  if (isLoading) {
    body = (
      <SkeletonGroup label="Loading today" style={{ gap: t.spacing.md }}>
        <Skeleton width="40%" height={14} />
        <Skeleton height={140} radius="xl" />
      </SkeletonGroup>
    );
  } else if (error) {
    body = (
      <EmptyState
        title="Couldn't load your trips"
        body={(error as Error).message}
        action={<Button label="Retry" fullWidth={false} onPress={() => refetch()} />}
      />
    );
  } else if (active.length > 0) {
    body = active.map((trip) => {
      const day = dayIndexFor(trip, now);
      const total = tripLength(trip.start_date, trip.end_date);
      return (
        <View key={trip.id} style={card}>
          <Text style={[t.typography.overline, { color: t.colors.primary }]}>
            {day !== null && total ? `Day ${day + 1} of ${total}` : 'Happening now'}
          </Text>
          <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
            {trip.title}
          </Text>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            {"Your live day plan — next stop, directions and check-offs — is coming here soon."}
          </Text>
          <Button
            label="Open today's plan"
            fullWidth={false}
            onPress={() => router.push(`/trip/${trip.id}`)}
            accessibilityLabel={`Open ${trip.title}`}
          />
        </View>
      );
    });
  } else if (upcoming) {
    const { trip, daysUntil } = upcoming;
    body = (
      <View style={card}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>No trip today</Text>
        <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {daysUntil === 1 ? `1 day to ${trip.title}` : `${daysUntil} days to ${trip.title}`}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {'When your trip starts, this tab becomes your day-by-day companion.'}
        </Text>
        <Button
          label="Open trip"
          variant="secondary"
          fullWidth={false}
          onPress={() => router.push(`/trip/${trip.id}`)}
          accessibilityLabel={`Open ${trip.title}`}
        />
      </View>
    );
  } else if ((trips ?? []).length > 0) {
    body = (
      <EmptyState
        title="No trip today"
        body="None of your trips are dated today or later. Plan the next one?"
        ctaLabel="Plan a trip"
        onPress={() => router.push('/trip/new')}
      />
    );
  } else {
    body = <EmptyState {...noTrips} onPress={() => router.push('/trip/new')} />;
  }

  return (
    <Screen padded={false} edges={TAB_SCREEN_EDGES}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={[
          { padding: t.spacing.lg, gap: t.spacing.lg },
          isDesktop && styles.desktop,
        ]}
      >
        <Heading level={1}>Today</Heading>
        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  desktop: {
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 48,
  },
});
