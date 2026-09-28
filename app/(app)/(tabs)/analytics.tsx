/**
 * Analytics / Insights screen — cross-trip spending + reaction data.
 *
 * Charts (react-native-gifted-charts wrappers in src/components/charts/):
 *   1. Spending per trip           — BarChart
 *   2. Spending by category        — PieChart
 *   3. Liked vs disliked per trip  — grouped BarChart (two series, flattened
 *                                    into alternating 👍/👎 bars, `grouped`)
 *   4. Spending over time          — LineChart (requires ≥ 3 trips with dates)
 *
 * Textual catalogs:
 *   5. Most liked places overall   — top 5 by like count
 *   6. Didn't like overall         — top 5 by dislike count
 *
 * Data sources (v2 Phase P3.2 — MV-first, live fallback):
 *   - useTripStats() reads the nightly-refreshed `analytics_user_trip_stats`
 *     materialized view (per-trip actual spend + liked/disliked counts).
 *     When a trip has an MV row, its PER-TRIP aggregates come from the MV —
 *     cheap and scalable, but up to ~24h stale (changes made since the last
 *     nightly refresh appear tomorrow; the footnote says so).
 *   - Trips ABSENT from the MV (created since the refresh — or ALL trips when
 *     the MV/RPC doesn't exist yet, since useTripStats then returns []) fall
 *     back to the LIVE client-side aggregation over useAllUserExpenses /
 *     useAllUserReactions (the Phase 0.5c useQueries path).
 *   - Per-category spending and the liked/disliked place CATALOGS are always
 *     live: the MV has no category breakdown and no place names — the
 *     per-trip places queries still resolve names.
 *
 * Phase 24 Step 24.10 / 24.12; v2 P3.1 (gifted-charts) + P3.2 (MV wiring).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { Button, Heading, Screen, TAB_SCREEN_EDGES, themedRefresh } from '@/components';
import {
  ChartCard,
  InsightsSkeleton,
  PlaceCatalogRow,
  ReactionLegend,
  categoryColor,
} from '@/components/analytics/InsightCards';
import { TAB_RAIL_WIDTH } from '@/components/navigation/AppTabBar';
import { BarChart } from '@/components/charts/BarChart';
import { PieChart } from '@/components/charts/PieChart';
import { LineChart } from '@/components/charts/LineChart';
import { useAllUserReactions } from '@/api/trip-place-reactions';
import { useAllUserExpenses } from '@/api/trip-expenses';
import { useTripStats } from '@/api/trip-stats';
import { useTrips } from '@/api';
import { tripPlacesKeys } from '@/api/_keys';
import { supabase } from '@/api/supabase';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { dayColor } from '@/components/Map';
import type { TripExpenseCategory, TripPlace } from '@/api/types';

const CATEGORY_LABELS: Record<TripExpenseCategory, string> = {
  accommodation: 'Accommodation',
  food: 'Food',
  transport: 'Transport',
  shopping: 'Shopping',
  activities: 'Activities',
  other: 'Other',
};

const EXPENSE_CATEGORIES: TripExpenseCategory[] = [
  'accommodation',
  'food',
  'transport',
  'shopping',
  'activities',
  'other',
];

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const router = useRouter();
  const t = useTheme();
  const bp = useBreakpoint();
  const { width: windowWidth } = useWindowDimensions();
  const isDesktop = bp === 'desktop';

  // ── Server state ─────────────────────────────────────────────────────────
  const tripsQuery = useTrips({ archived: false });
  const expensesQuery = useAllUserExpenses();
  const reactionsQuery = useAllUserReactions();
  const { data: allTrips = [], isLoading: tripsLoading } = tripsQuery;
  const { data: allExpenses = [], isLoading: expensesLoading } = expensesQuery;
  const { data: allReactions = [], isLoading: reactionsLoading } = reactionsQuery;
  // MV aggregates — [] when the RPC is missing or the MV hasn't refreshed yet,
  // in which case every trip takes the live-fallback path below.
  const statsQuery = useTripStats();
  const { data: tripStats = [] } = statsQuery;

  const statsByTrip = useMemo(
    () => new Map(tripStats.map((row) => [row.trip_id, row])),
    [tripStats],
  );

  // Footnote driver: true when at least one rendered trip aggregate came
  // from the (nightly-stale) MV rather than live queries.
  const mvContributed = useMemo(
    () => allTrips.some((trip) => statsByTrip.has(trip.id)),
    [allTrips, statsByTrip],
  );

  // Fetch places for EVERY trip (one cached query per trip) to resolve names
  // in the liked/disliked catalogs. v2 Phase 0.5c: the v1 version hand-wired
  // ten fixed useTripPlaces hooks and silently dropped data past the 10th
  // trip (its comment claimed 20 — it was wrong). useQueries scales the hook
  // count dynamically with the trip list, and each entry reuses
  // tripPlacesKeys.forTrip(id) so per-trip caches stay shared with the
  // trip-detail screen.
  const placeQueryResults = useQueries({
    queries: allTrips.map((trip) => ({
      queryKey: tripPlacesKeys.forTrip(trip.id),
      queryFn: async (): Promise<TripPlace[]> => {
        const { data, error } = await supabase
          .from('trip_places')
          .select('*')
          .eq('trip_id', trip.id)
          // v2 S2.8.1: exclude soft-delete tombstones (migration 0027).
          // MUST stay byte-identical to the useTripPlaces queryFn in
          // src/api/trip-places.ts — both populate the same
          // tripPlacesKeys.forTrip(id) cache entry, so a filter mismatch
          // would make the cached shape depend on which screen fetched
          // first.
          .eq('deleted', false)
          .order('day_index', { ascending: true, nullsFirst: true })
          .order('order_in_day', { ascending: true, nullsFirst: true });
        if (error) throw error;
        return data as TripPlace[];
      },
    })),
  });

  // Cross-reference: tripPlaceId → { title, tripTitle, dayIndex }.
  // placeQueryResults gets a fresh array identity per render, so this memo
  // recomputes on each render of this screen — acceptable: it's a cheap
  // map-build over a few hundred rows at most, and the v1 version had the
  // same effective behavior via ten result objects.
  const placeMeta = useMemo(() => {
    const map = new Map<string, { title: string; tripTitle: string; dayIndex: number | null }>();
    for (let i = 0; i < placeQueryResults.length; i++) {
      const trip = allTrips[i];
      const places = placeQueryResults[i]?.data ?? [];
      for (const place of places) {
        map.set(place.id, {
          title: place.user_title ?? 'Unknown place',
          tripTitle: trip?.title ?? 'Unknown trip',
          dayIndex: place.day_index,
        });
      }
    }
    return map;
  }, [placeQueryResults, allTrips]);

  // ── Chart 1: Spending per trip ────────────────────────────────────────────
  // MV-first: trips with an MV row use total_actual_spend; trips absent from
  // the MV use the live client sum over allExpenses (P3.2 merge).
  const spendingPerTrip = useMemo(() => {
    const byTrip = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.kind !== 'actual') continue;
      byTrip.set(exp.trip_id, (byTrip.get(exp.trip_id) ?? 0) + exp.amount);
    }
    const totalFor = (tripId: string): number =>
      statsByTrip.get(tripId)?.total_actual_spend ?? byTrip.get(tripId) ?? 0;
    return allTrips
      .filter((trip) => totalFor(trip.id) > 0)
      .map((trip, i) => ({
        label: trip.title,
        value: totalFor(trip.id),
        color: dayColor(i),
      }));
  }, [allExpenses, allTrips, statsByTrip]);

  // ── Chart 2: Spending by category ────────────────────────────────────────
  const spendingByCategory = useMemo(() => {
    const byCategory = new Map<TripExpenseCategory, number>();
    for (const exp of allExpenses) {
      if (exp.kind !== 'actual') continue;
      byCategory.set(exp.category, (byCategory.get(exp.category) ?? 0) + exp.amount);
    }
    return EXPENSE_CATEGORIES
      .filter((cat) => (byCategory.get(cat) ?? 0) > 0)
      .map((cat) => ({
        label: CATEGORY_LABELS[cat],
        value: byCategory.get(cat) ?? 0,
        color: categoryColor(t, cat),
      }));
  }, [allExpenses, t]);

  // ── Chart 3: Liked vs disliked per trip ───────────────────────────────────
  // MV-first: trips with an MV row use liked_count/disliked_count; trips
  // absent from the MV use the live reverse-lookup aggregation (P3.2 merge).
  const reactionsByTrip = useMemo(() => {
    // Live fallback: map tripPlaceId → tripId using the trips' places
    // (all trips — 0.5c) to reverse-look up which trip a reaction belongs to.
    const placeToTrip = new Map<string, string>();
    for (let i = 0; i < placeQueryResults.length; i++) {
      const trip = allTrips[i];
      const places = placeQueryResults[i]?.data ?? [];
      for (const place of places) {
        if (trip) placeToTrip.set(place.id, trip.id);
      }
    }

    const liked = new Map<string, number>();
    const disliked = new Map<string, number>();
    for (const r of allReactions) {
      const tripId = placeToTrip.get(r.trip_place_id);
      if (!tripId) continue;
      if (r.reaction === 'liked') {
        liked.set(tripId, (liked.get(tripId) ?? 0) + 1);
      } else if (r.reaction === 'disliked') {
        disliked.set(tripId, (disliked.get(tripId) ?? 0) + 1);
      }
    }

    return allTrips
      .map((trip) => {
        const mv = statsByTrip.get(trip.id);
        return {
          tripTitle: trip.title,
          liked: mv?.liked_count ?? liked.get(trip.id) ?? 0,
          disliked: mv?.disliked_count ?? disliked.get(trip.id) ?? 0,
        };
      })
      .filter((r) => r.liked + r.disliked > 0)
      .map((r, i) => ({ ...r, colorIndex: i }));
  }, [allReactions, allTrips, placeQueryResults, statsByTrip]);

  // ── Chart 4: Spending over time ───────────────────────────────────────────
  // Same MV-first merge as Chart 1, keyed by trip start month.
  const spendingOverTime = useMemo(() => {
    const withDates = allTrips
      .filter((trip) => Boolean(trip.start_date))
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

    const byTrip = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.kind !== 'actual') continue;
      byTrip.set(exp.trip_id, (byTrip.get(exp.trip_id) ?? 0) + exp.amount);
    }
    const totalFor = (tripId: string): number =>
      statsByTrip.get(tripId)?.total_actual_spend ?? byTrip.get(tripId) ?? 0;

    const result = withDates
      .filter((trip) => totalFor(trip.id) > 0)
      .map((trip) => ({
        label: trip.start_date?.slice(0, 7) ?? '', // YYYY-MM
        value: totalFor(trip.id),
      }));

    // Only show if 3+ trips with dates and expenses.
    return result.length >= 3 ? result : [];
  }, [allExpenses, allTrips, statsByTrip]);

  // ── Catalog 1: Most liked places ─────────────────────────────────────────
  const topLiked = useMemo(() => {
    const likeCount = new Map<string, number>();
    for (const r of allReactions) {
      if (r.reaction === 'liked') {
        likeCount.set(r.trip_place_id, (likeCount.get(r.trip_place_id) ?? 0) + 1);
      }
    }
    return [...likeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count, meta: placeMeta.get(id) }))
      .filter((r) => r.meta !== undefined);
  }, [allReactions, placeMeta]);

  // ── Catalog 2: Most disliked places ──────────────────────────────────────
  const topDisliked = useMemo(() => {
    const dislikeCount = new Map<string, number>();
    for (const r of allReactions) {
      if (r.reaction === 'disliked') {
        dislikeCount.set(r.trip_place_id, (dislikeCount.get(r.trip_place_id) ?? 0) + 1);
      }
    }
    return [...dislikeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count, meta: placeMeta.get(id) }))
      .filter((r) => r.meta !== undefined);
  }, [allReactions, placeMeta]);

  const isLoading = tripsLoading || expensesLoading || reactionsLoading;

  // Pull-to-refresh (X3.1): refetch every source, including the per-trip
  // place lists that name the catalog rows. allSettled — one failing source
  // must not leave the spinner stuck.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        tripsQuery.refetch(),
        expensesQuery.refetch(),
        reactionsQuery.refetch(),
        statsQuery.refetch(),
        ...placeQueryResults.map((q) => q.refetch()),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [tripsQuery, expensesQuery, reactionsQuery, statsQuery, placeQueryResults]);
  const hasNoTrips = !isLoading && allTrips.length === 0;
  const hasNoData =
    !isLoading &&
    allTrips.length > 0 &&
    allExpenses.length === 0 &&
    allReactions.length === 0;

  // Chart width: on desktop two charts sit side-by-side; on mobile full width.
  const chartContainerWidth = isDesktop
    ? Math.min((windowWidth - TAB_RAIL_WIDTH) / 2 - 48, 560) // left tab rail (M4 X1.1)
    : windowWidth - 48; // subtract padding

  // ── Liked/disliked bar chart — render two bars per trip ──────────────────
  // We flatten the grouped data into alternating like/dislike bars. X3.1:
  // liked = success, didn't like = danger in every pair (the legend explains
  // both); the trip title labels the pair once. The old per-bar "Title 👍"
  // labels were cut to 9 chars by the chart, so the emoji never showed.
  const reactionBarData = useMemo(
    () =>
      reactionsByTrip.flatMap((r) => [
        { label: r.tripTitle, value: r.liked, color: t.colors.success },
        { label: '', value: r.disliked, color: t.colors.danger },
      ]),
    [reactionsByTrip, t],
  );

  return (
    <Screen padded={false} edges={TAB_SCREEN_EDGES}>
      <ScrollView
        contentContainerStyle={[
          { padding: t.spacing.lg, gap: t.spacing.xl },
          isDesktop && styles.desktopColumn,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            {...themedRefresh(t)}
          />
        }
      >
        <Heading level={1}>Insights</Heading>

        {/* Loading state */}
        {isLoading ? (
          <InsightsSkeleton />
        ) : hasNoTrips ? (
          // Empty state — zero trips
          <View style={styles.emptyContainer}>
            <Text style={[t.typography.subtitle, { color: t.colors.text, textAlign: 'center' }]}>
              {'Take your first trip to see analytics here.'}
            </Text>
            <Button
              label="New trip"
              onPress={() => router.push('/trip/new')}
              accessibilityLabel="Create a new trip"
            />
          </View>
        ) : hasNoData ? (
          // Trips exist but no expenses or reactions yet
          <View style={styles.emptyContainer}>
            <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
              {'No data yet — add expenses or rate places to see insights.'}
            </Text>
          </View>
        ) : (
          // ── Charts ──────────────────────────────────────────────────────
          <View style={styles.chartsContainer}>

            {/* Chart 1: Spending per trip */}
            {spendingPerTrip.length > 0 ? (
              <ChartCard title="Spending per trip">
                <BarChart
                  data={spendingPerTrip}
                  width={chartContainerWidth}
                  height={200}
                  maxBars={10}
                />
              </ChartCard>
            ) : null}

            {/* Chart 2: Spending by category */}
            {spendingByCategory.length > 0 ? (
              <ChartCard title="Spending by category">
                <PieChart
                  data={spendingByCategory}
                  size={Math.min(160, chartContainerWidth * 0.5)}
                />
              </ChartCard>
            ) : null}

            {/* Chart 3: Liked vs disliked per trip */}
            {reactionsByTrip.length > 0 ? (
              <ChartCard title="Liked vs didn't like per trip">
                <ReactionLegend />
                <BarChart
                  data={reactionBarData}
                  width={chartContainerWidth}
                  height={200}
                  maxBars={20}
                  grouped
                />
              </ChartCard>
            ) : null}

            {/* Chart 4: Spending over time */}
            {spendingOverTime.length >= 3 ? (
              <ChartCard title="Spending over time">
                <LineChart
                  data={spendingOverTime}
                  width={chartContainerWidth}
                  height={180}
                  color={t.colors.primary}
                />
              </ChartCard>
            ) : null}

            {/* Textual catalogs */}
            {topLiked.length > 0 ? (
              <ChartCard title="Most liked places">
                {topLiked.map((item) => (
                  <PlaceCatalogRow
                    key={item.id}
                    title={item.meta?.title ?? 'Unknown'}
                    tripTitle={item.meta?.tripTitle ?? ''}
                    dayIndex={item.meta?.dayIndex ?? null}
                    count={item.count}
                    kind="liked"
                  />
                ))}
              </ChartCard>
            ) : null}

            {topDisliked.length > 0 ? (
              <ChartCard title="Places you didn't like">
                {topDisliked.map((item) => (
                  <PlaceCatalogRow
                    key={item.id}
                    title={item.meta?.title ?? 'Unknown'}
                    tripTitle={item.meta?.tripTitle ?? ''}
                    dayIndex={item.meta?.dayIndex ?? null}
                    count={item.count}
                    kind="disliked"
                  />
                ))}
              </ChartCard>
            ) : null}

            {/* No analytics data sub-message */}
            {spendingPerTrip.length === 0 &&
            spendingByCategory.length === 0 &&
            reactionsByTrip.length === 0 ? (
              <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
                {'No data yet — add expenses or rate places to see insights.'}
              </Text>
            ) : null}

            {/* MV staleness footnote — only when server aggregates were used */}
            {mvContributed ? (
              <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
                {'Aggregates refresh nightly.'}
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 48,
  },
  chartsContainer: {
    gap: 20,
  },
  // Desktop: one centered reading column (charts are sized to ≤560px).
  desktopColumn: { width: '100%', maxWidth: 720, alignSelf: 'center' },
});
