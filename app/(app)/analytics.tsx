/**
 * Analytics / Insights screen — cross-trip spending + reaction data.
 *
 * Charts (hand-rolled SVG via react-native-svg):
 *   1. Spending per trip           — BarChart
 *   2. Spending by category        — PieChart
 *   3. Liked vs disliked per trip  — grouped BarChart (two series)
 *   4. Spending over time          — LineChart (requires ≥ 3 trips with dates)
 *
 * Textual catalogs:
 *   5. Most liked places overall   — top 5 by like count
 *   6. Didn't like overall         — top 5 by dislike count
 *
 * All aggregations are pure client-side useMemo over TanStack Query data.
 *
 * Phase 24 Step 24.10 / 24.12.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { BackButton, Button, Heading, Screen } from '@/components';
import { BarChart } from '@/components/charts/BarChart';
import { PieChart } from '@/components/charts/PieChart';
import { LineChart } from '@/components/charts/LineChart';
import { useAllUserReactions } from '@/api/trip-place-reactions';
import { useAllUserExpenses } from '@/api/trip-expenses';
import { useTrips, useTripPlaces } from '@/api';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { dayColor } from '@/components/Map';
import type { TripExpenseCategory } from '@/api/types';

// ── Category colors (visual identity for pie chart slices) ──────────────────
const CATEGORY_COLORS: Record<TripExpenseCategory, string> = {
  accommodation: '#6366F1',
  food: '#F59E0B',
  transport: '#3B82F6',
  shopping: '#EC4899',
  activities: '#10B981',
  other: '#9CA3AF',
};

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
  const { data: allTrips = [], isLoading: tripsLoading } = useTrips({ archived: false });
  const { data: allExpenses = [], isLoading: expensesLoading } = useAllUserExpenses();
  const { data: allReactions = [], isLoading: reactionsLoading } = useAllUserReactions();

  // Fetch places for each trip to resolve names in the liked/disliked catalog.
  // We only need the trips that have reactions; use the first owned trip as pivot.
  // Since we can't conditionally call hooks, we fetch places for up to the first
  // 20 trips and use a cross-reference map. For an MVP this is acceptable.
  const tripIds = useMemo(() => allTrips.slice(0, 20).map((t) => t.id), [allTrips]);

  // Hook calls must be unconditional — we call for index 0-19 and select by tripId.
  // useTripPlaces is cheap (cached) and disabled when tripId is undefined.
  const p0 = useTripPlaces(tripIds[0]);
  const p1 = useTripPlaces(tripIds[1]);
  const p2 = useTripPlaces(tripIds[2]);
  const p3 = useTripPlaces(tripIds[3]);
  const p4 = useTripPlaces(tripIds[4]);
  const p5 = useTripPlaces(tripIds[5]);
  const p6 = useTripPlaces(tripIds[6]);
  const p7 = useTripPlaces(tripIds[7]);
  const p8 = useTripPlaces(tripIds[8]);
  const p9 = useTripPlaces(tripIds[9]);

  // Cross-reference: tripPlaceId → { title, tripTitle, dayIndex }
  const placeMeta = useMemo(() => {
    const map = new Map<string, { title: string; tripTitle: string; dayIndex: number | null }>();
    const pQueries = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9];
    for (let i = 0; i < pQueries.length; i++) {
      const trip = allTrips[i];
      const places = pQueries[i]?.data ?? [];
      for (const place of places) {
        map.set(place.id, {
          title: place.user_title ?? 'Unknown place',
          tripTitle: trip?.title ?? 'Unknown trip',
          dayIndex: place.day_index,
        });
      }
    }
    return map;
  }, [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, allTrips]);

  // ── Chart 1: Spending per trip ────────────────────────────────────────────
  const spendingPerTrip = useMemo(() => {
    const byTrip = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.kind !== 'actual') continue;
      byTrip.set(exp.trip_id, (byTrip.get(exp.trip_id) ?? 0) + exp.amount);
    }
    return allTrips
      .filter((trip) => byTrip.has(trip.id))
      .map((trip, i) => ({
        label: trip.title,
        value: byTrip.get(trip.id) ?? 0,
        color: dayColor(i),
      }));
  }, [allExpenses, allTrips]);

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
        color: CATEGORY_COLORS[cat],
      }));
  }, [allExpenses]);

  // ── Chart 3: Liked vs disliked per trip ───────────────────────────────────
  const reactionsByTrip = useMemo(() => {
    // Map tripPlaceId → tripId using the trips' places.
    // We need to reverse-look up which trip a tripPlaceId belongs to.
    const placeToTrip = new Map<string, string>();
    const pQueries = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9];
    for (let i = 0; i < pQueries.length; i++) {
      const trip = allTrips[i];
      const places = pQueries[i]?.data ?? [];
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

    const tripIdsWithReactions = new Set([...liked.keys(), ...disliked.keys()]);
    return allTrips
      .filter((trip) => tripIdsWithReactions.has(trip.id))
      .map((trip, i) => ({
        tripTitle: trip.title,
        liked: liked.get(trip.id) ?? 0,
        disliked: disliked.get(trip.id) ?? 0,
        colorIndex: i,
      }));
  }, [allReactions, allTrips, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9]);

  // ── Chart 4: Spending over time ───────────────────────────────────────────
  const spendingOverTime = useMemo(() => {
    const withDates = allTrips
      .filter((trip) => Boolean(trip.start_date))
      .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));

    const byTrip = new Map<string, number>();
    for (const exp of allExpenses) {
      if (exp.kind !== 'actual') continue;
      byTrip.set(exp.trip_id, (byTrip.get(exp.trip_id) ?? 0) + exp.amount);
    }

    const result = withDates
      .filter((trip) => byTrip.has(trip.id))
      .map((trip) => ({
        label: trip.start_date?.slice(0, 7) ?? '', // YYYY-MM
        value: byTrip.get(trip.id) ?? 0,
      }));

    // Only show if 3+ trips with dates and expenses.
    return result.length >= 3 ? result : [];
  }, [allExpenses, allTrips]);

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
  const hasNoTrips = !isLoading && allTrips.length === 0;
  const hasNoData =
    !isLoading &&
    allTrips.length > 0 &&
    allExpenses.length === 0 &&
    allReactions.length === 0;

  // Chart width: on desktop two charts sit side-by-side; on mobile full width.
  const chartContainerWidth = isDesktop
    ? Math.min(windowWidth / 2 - 48, 560)
    : windowWidth - 48; // subtract padding

  // ── Liked/disliked bar chart — render two bars per trip ──────────────────
  // We flatten the grouped data into alternating like/dislike bars,
  // color-coding each pair. Gap rows help visual separation.
  const reactionBarData = useMemo(
    () =>
      reactionsByTrip.flatMap((r) => [
        { label: `${r.tripTitle.slice(0, 8)} 👍`, value: r.liked, color: dayColor(r.colorIndex) },
        { label: `${r.tripTitle.slice(0, 8)} 👎`, value: r.disliked, color: '#F87171' },
      ]),
    [reactionsByTrip],
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <BackButton onPress={() => router.back()} label="Trips" />
        <Heading level={1}>Insights</Heading>

        {/* Loading state */}
        {isLoading ? (
          <View style={[styles.skeleton, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.md }]} />
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
          <View style={[styles.chartsContainer, isDesktop && styles.chartsDesktop]}>

            {/* Chart 1: Spending per trip */}
            {spendingPerTrip.length > 0 ? (
              <ChartCard title="Spending per trip" t={t}>
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
              <ChartCard title="Spending by category" t={t}>
                <PieChart
                  data={spendingByCategory}
                  size={Math.min(160, chartContainerWidth * 0.5)}
                />
              </ChartCard>
            ) : null}

            {/* Chart 3: Liked vs disliked per trip */}
            {reactionsByTrip.length > 0 ? (
              <ChartCard title="Liked vs didn't like per trip" t={t}>
                <BarChart
                  data={reactionBarData}
                  width={chartContainerWidth}
                  height={200}
                  maxBars={20}
                />
              </ChartCard>
            ) : null}

            {/* Chart 4: Spending over time */}
            {spendingOverTime.length >= 3 ? (
              <ChartCard title="Spending over time" t={t}>
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
              <ChartCard title="Most liked places" t={t}>
                {topLiked.map((item) => (
                  <PlaceCatalogRow
                    key={item.id}
                    title={item.meta?.title ?? 'Unknown'}
                    tripTitle={item.meta?.tripTitle ?? ''}
                    dayIndex={item.meta?.dayIndex ?? null}
                    badge={`👍 ${item.count}`}
                    t={t}
                  />
                ))}
              </ChartCard>
            ) : null}

            {topDisliked.length > 0 ? (
              <ChartCard title="Places you didn't like" t={t}>
                {topDisliked.map((item) => (
                  <PlaceCatalogRow
                    key={item.id}
                    title={item.meta?.title ?? 'Unknown'}
                    tripTitle={item.meta?.tripTitle ?? ''}
                    dayIndex={item.meta?.dayIndex ?? null}
                    badge={`👎 ${item.count}`}
                    t={t}
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
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────

function ChartCard({
  title,
  children,
  t,
}: {
  title: string;
  children: React.ReactNode;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: 16,
          gap: 12,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={2}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

// ── PlaceCatalogRow ───────────────────────────────────────────────────────────

function PlaceCatalogRow({
  title,
  tripTitle,
  dayIndex,
  badge,
  t,
}: {
  title: string;
  tripTitle: string;
  dayIndex: number | null;
  badge: string;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.catalogRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={1}>
          {tripTitle}
          {dayIndex !== null ? ` · Day ${dayIndex + 1}` : ''}
        </Text>
      </View>
      <View
        style={[
          styles.catalogBadge,
          { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill },
        ]}
      >
        <Text style={[t.typography.caption, { color: t.colors.text }]}>{badge}</Text>
      </View>
    </View>
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
  chartsDesktop: {
    // On desktop we let cards flow in a single column but they'll be wider
    // due to chartContainerWidth being half the window. Two-column layout
    // would require a wrapping grid; single column is simpler and still
    // good on desktop at 560px card width.
  },
  card: {
    borderWidth: 1,
  },
  skeleton: {
    height: 200,
    width: '100%',
    opacity: 0.5,
  },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catalogBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
