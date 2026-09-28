/**
 * Today tab — live trip companion (v2 M4 X2.1).
 *
 * Picks the trip(s) running on the device's local calendar day from the
 * owned + shared trips list (src/lib/tripToday.ts):
 *   - one or more trips running → LiveTripView (next stop, navigate,
 *     check-offs, tonight's stay, weather, add expense); a chip switcher
 *     appears when several overlap,
 *   - none running → countdown to the next trip + a prep card,
 *   - no upcoming trips → a nudge to plan one; no trips at all → the empty
 *     illustration + "Plan with AI".
 *
 * Offline: every read comes from Tier-1-backed / cached hooks; nothing on
 * this screen calls Google or a routing API.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useIsOnline, useTrips } from '@/api';
import { EmptyState, Heading, Screen, Skeleton, SkeletonGroup, TAB_SCREEN_EDGES } from '@/components';
import { noTrips } from '@/components/emptyStates';
import { LiveTripView } from '@/components/today/LiveTripView';
import { TripSwitcher } from '@/components/today/TripSwitcher';
import { UpcomingTripCard } from '@/components/today/UpcomingTripCard';
import { useNow } from '@/components/today/useNow';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { activeTripsOn, nextUpcomingTrip } from '@/lib/tripToday';
import { useTheme } from '@/theme';

function todayLabel(now: Date): string {
  try {
    return now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return '';
  }
}

export default function TodayScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDesktop = useBreakpoint() === 'desktop';
  const online = useIsOnline();
  const now = useNow();
  const { data: trips, isLoading, error, refetch } = useTrips({ archived: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), queryClient.refetchQueries({ type: 'active' })]);
    } catch {
      // Individual cards surface their own errors.
    } finally {
      setRefreshing(false);
    }
  }, [refetch, queryClient]);

  const active = activeTripsOn(trips ?? [], now);
  const selected = active.find((trip) => trip.id === selectedId) ?? active[0] ?? null;
  const upcoming = active.length === 0 ? nextUpcomingTrip(trips ?? [], now) : null;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <SkeletonGroup label="Loading today" style={{ gap: t.spacing.md }}>
        <Skeleton width="40%" height={14} />
        <Skeleton height={220} radius="xl" />
        <Skeleton height={140} radius="xl" />
      </SkeletonGroup>
    );
  } else if (error && !trips) {
    body = (
      <EmptyState
        title="Couldn't load your trips"
        body={error.message}
        ctaLabel="Retry"
        onPress={() => void refetch()}
      />
    );
  } else if (selected) {
    body = (
      <>
        <TripSwitcher trips={active} selectedId={selected.id} onSelect={setSelectedId} />
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} numberOfLines={1}>
          {selected.title}
        </Text>
        <LiveTripView key={selected.id} trip={selected} now={now} isDesktop={isDesktop} />
      </>
    );
  } else if (upcoming) {
    body = <UpcomingTripCard trip={upcoming.trip} daysUntil={upcoming.daysUntil} />;
  } else if ((trips ?? []).length > 0) {
    body = (
      <EmptyState
        title="No trip today"
        body="None of your trips are dated today or later. Plan the next one?"
        ctaLabel="Plan with AI"
        onPress={() => router.push('/trip/plan')}
      />
    );
  } else {
    body = <EmptyState {...noTrips} ctaLabel="Plan with AI" onPress={() => router.push('/trip/plan')} />;
  }

  return (
    <Screen padded={false} edges={TAB_SCREEN_EDGES}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[
          { padding: t.spacing.lg, gap: t.spacing.lg },
          isDesktop ? styles.desktop : styles.narrow,
        ]}
      >
        <View style={{ gap: t.spacing.xs }}>
          <Heading level={1}>Today</Heading>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{todayLabel(now)}</Text>
          {!online ? (
            <Text style={[t.typography.caption, { color: t.colors.warningText }]} accessibilityLiveRegion="polite">
              Offline — showing your saved plan.
            </Text>
          ) : null}
        </View>
        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  narrow: {
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  desktop: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 48,
  },
});
