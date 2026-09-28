/**
 * Print route — /trip/[id]/print
 *
 * Platform behaviour:
 *  - Web: full read-only itinerary + @media print stylesheet injected via
 *    expo-router's <Head> + a "Print this page" button that calls
 *    window.print() (gated by Platform.OS === 'web').
 *  - iOS / Android: same read-only itinerary as a scrollable view + an inline
 *    note "Open this trip on the web to print". The window.print() button is
 *    never rendered, so it never enters the native bundle.
 *
 * Google attribution: rendered in the footer per Tripvisor rule #4 (place
 * coordinates are Google-derived).
 *
 * No PII is logged or sent to Sentry from this route.
 * No Google reviews / photos / ratings / hours are read from trip_places;
 * only user-managed fields (user_title, category, visit_duration_minutes,
 * notes, day_index, order_in_day) are displayed.
 */
import { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import {
  BackButton,
  Button,
  Heading,
  MarkdownText,
  Screen,
  Skeleton,
  SkeletonGroup,
  TripCostRollup,
  DaySummaryCard,
} from '@/components';
import { PoweredByGoogle } from '@/components/PoweredByGoogle';
import { useTheme } from '@/theme';
import { useTrip, useTripDays, useTripLegs, useTripPlaces, type TripDay, type TripPlace, type TripLeg } from '@/api';

// Web-only: inject @media print styles via expo-router Head.
// The conditional import at module level is fine here because Metro/webpack
// tree-shakes per platform — the Head component is only used when
// Platform.OS === 'web', and the <style> tag is only rendered then.
// On native, PrintHead returns null immediately so there is no runtime cost.
function PrintHead() {
  // Only mount on web. Returning null on native means no Head component
  // is imported into the native bundle either (React skips the branch).
  if (Platform.OS !== 'web') return null;

  // expo-router re-exports <Head> from expo-router/head which maps to
  // react-helmet-async on web. We use an inline <style> tag so we don't
  // need a separate CSS file in the static export.
  // #tripvisor-print-root targets our root view (nativeID below → DOM id on
  // react-native-web) to avoid clobbering Expo's own body resets. A
  // className prop would NOT work: RNW drops unknown props (className
  // included) and builds the DOM class list from StyleSheet only.
  const css = `
@media print {
  #tripvisor-print-root {
    background: #fff !important;
    color: #000 !important;
  }
  /* X3.1: text colors are inline theme tokens, so printing from dark mode
     would put bone-colored text on white paper. Force ink-on-paper. */
  #tripvisor-print-root * {
    color: #000 !important;
    background-color: transparent !important;
    border-color: #bbb !important;
    box-shadow: none !important;
  }
  [data-no-print] {
    display: none !important;
  }
  @page {
    size: A4 portrait;
    margin: 1.5cm;
  }
}
  `.trim();

  // The Head component is only evaluated when this branch executes on web.
  // expo-router/head.js exports `Head` as the default export only
  // (`export { Head as default } from './build/head/ExpoHead'`).
  // Destructuring `{ Head }` would yield `undefined` and crash the entire
  // React tree. Fall back to `.Head` for any future SDK that might re-add a
  // named export.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const headModule = require('expo-router/head') as {
    default?: React.ComponentType<{ children: React.ReactNode }>;
    Head?: React.ComponentType<{ children: React.ReactNode }>;
  };
  const Head = headModule.default ?? headModule.Head;
  if (!Head) return null;
  return (
    <Head>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </Head>
  );
}

export default function PrintRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useSafeBack(`/trip/${id}`);
  const t = useTheme();

  const { data: trip, isLoading, error } = useTrip(id);
  const { data: places = [] } = useTripPlaces(id);
  const { data: legs = [] } = useTripLegs(id);
  // Per-day notes (Step 9.5): sparse — only rows that have been written exist.
  const { data: tripDays = [] } = useTripDays(id);

  // Group places by day (sorted, matching itinerary tab logic).
  const byDay = useMemo(() => groupByDay(places), [places]);

  // Index trip_days by day_index for O(1) lookup in the render loop.
  const dayNotesIndex = useMemo(() => {
    const m = new Map<number, TripDay>();
    for (const d of tripDays) m.set(d.day_index, d);
    return m;
  }, [tripDays]);

  if (isLoading) {
    return (
      <Screen>
        <SkeletonGroup label="Loading itinerary" style={{ gap: t.spacing.md }}>
          <Skeleton width="60%" height={30} />
          <Skeleton width="40%" height={18} />
          <Skeleton height={72} radius="lg" />
          <Skeleton height={72} radius="lg" />
          <Skeleton height={72} radius="lg" />
        </SkeletonGroup>
      </Screen>
    );
  }

  if (error || !trip) {
    return (
      <Screen>
        <Heading level={2}>Trip not found</Heading>
        <Button label="Back to trips" onPress={() => router.replace('/trips')} />
      </Screen>
    );
  }

  const dateRange = formatRange(trip.start_date, trip.end_date);

  return (
    <>
      {/* @media print stylesheet — web only; no-op on native */}
      <PrintHead />

      <Screen padded={false}>
        {/* nativeID renders as id="tripvisor-print-root" on web (the print CSS
            hook); on native it is an inert view tag. */}
        <ScrollView
          nativeID="tripvisor-print-root"
          contentContainerStyle={[styles.container, { padding: t.spacing.lg, gap: t.spacing.lg }]}
        >
          {/* ── Itinerary header ─────────────────────────────────────────── */}
          <View style={{ gap: t.spacing.xs }}>
            {/* BackButton with noPrint=true hides it from the browser print dialog */}
            <BackButton onPress={goBack} label="Trip" noPrint />

            <Heading level={1}>{trip.title}</Heading>
            <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{dateRange}</Text>
          </View>

          {/* ── Route summary (reused component; time-first, v2 Phase 0.1) ── */}
          <TripCostRollup legs={legs} />

          {/* ── Native-only hint ─────────────────────────────────────────── */}
          {Platform.OS !== 'web' ? (
            <View
              style={[
                styles.nativeHint,
                { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.md, padding: t.spacing.md },
              ]}
            >
              <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
                Open this trip on the web to print.
              </Text>
            </View>
          ) : null}

          {/* ── Per-day sections ─────────────────────────────────────────── */}
          {byDay.map((section) => {
            const dayRecord = section.dayIndex >= 0
              ? dayNotesIndex.get(section.dayIndex) ?? null
              : null;
            return (
              <View key={`day-${section.dayIndex}`} style={{ gap: t.spacing.md }}>
                {/* Day heading */}
                <View
                  style={[
                    styles.dayHeader,
                    { borderColor: t.colors.primary, borderBottomWidth: 1, paddingBottom: t.spacing.xs },
                  ]}
                >
                  <Heading level={2}>
                    {section.dayIndex < 0 ? 'Unscheduled' : `Day ${section.dayIndex + 1}`}
                  </Heading>
                </View>

                {/* Day summary strip */}
                {section.dayIndex >= 0 ? (
                  <DaySummaryCard
                    dayIndex={section.dayIndex}
                    places={places}
                    legs={legs}
                  />
                ) : null}

                {/* Per-day notes (Step 9.5) — rendered via MarkdownText */}
                {dayRecord?.notes ? (
                  <View
                    style={[
                      styles.dayNotesBlock,
                      {
                        backgroundColor: t.colors.bgElevated,
                        borderRadius: t.radius.sm,
                        padding: t.spacing.sm,
                        borderLeftWidth: 3,
                        borderColor: t.colors.primary,
                      },
                    ]}
                    accessibilityLabel={`Day ${section.dayIndex + 1} notes`}
                  >
                    <MarkdownText source={dayRecord.notes} style={{ color: t.colors.text }} />
                  </View>
                ) : null}

                {/* Place list for this day */}
                <View style={{ gap: t.spacing.sm }}>
                  {section.places.map((place, idx) => (
                    <PlacePrintRow key={place.id} place={place} index={idx} t={t} />
                  ))}
                </View>

                {/* Visual rule between days */}
                <View
                  style={[styles.rule, { backgroundColor: t.colors.border }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </View>
            );
          })}

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <PoweredByGoogle />

          {/*
           * "Print this page" button — web only (Step 8.6).
           * window.print() is gated inside an if-block so Metro never emits
           * it into the native bundle. The button element itself is only
           * rendered when Platform.OS === 'web'.
           */}
          {Platform.OS === 'web' ? (
            <Button
              label="Print this page"
              variant="secondary"
              onPress={() => {
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                  window.print();
                }
              }}
              accessibilityLabel="Open browser print dialog"
            />
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function PlacePrintRow({
  place,
  index,
  t,
}: {
  place: TripPlace;
  index: number;
  t: ReturnType<typeof useTheme>;
}) {
  const durationLabel =
    place.visit_duration_minutes >= 60
      ? `${(place.visit_duration_minutes / 60).toFixed(1)}h`
      : `${place.visit_duration_minutes} min`;

  return (
    <View
      style={[
        styles.placeRow,
        {
          borderColor: t.colors.border,
          borderRadius: t.radius.sm,
          padding: t.spacing.sm,
          backgroundColor: t.colors.bgElevated,
        },
      ]}
      accessible
      accessibilityLabel={`${index + 1}. ${place.user_title ?? 'Place'}, ${place.category ?? 'Unclassified'}, ${durationLabel}${place.notes ? `, note: ${place.notes}` : ''}`}
    >
      <View style={styles.placeHeader}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
          {index + 1}. {place.user_title ?? 'Place'}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{durationLabel}</Text>
      </View>
      {place.category ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{place.category}</Text>
      ) : null}
      {place.notes ? (
        <View style={{ marginTop: 4 }}>
          <MarkdownText source={place.notes} style={{ color: t.colors.text }} />
        </View>
      ) : null}
    </View>
  );
}

function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} → ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return 'Dates not set';
}

function groupByDay(places: TripPlace[]): Array<{ dayIndex: number; places: TripPlace[] }> {
  const map = new Map<number, TripPlace[]>();
  for (const p of places) {
    const key = p.day_index ?? -1;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => (a.order_in_day ?? 0) - (b.order_in_day ?? 0));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, ps]) => ({ dayIndex, places: ps }));
}

// Suppress the unused TripLeg import warning — it is used indirectly via the
// useTripLegs hook return type but TS may not see it referenced directly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TripLegRef = TripLeg;

const styles = StyleSheet.create({
  container: {},
  dayHeader: {},
  rule: { height: 1, marginVertical: 4 },
  placeRow: { borderWidth: 1 },
  placeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  nativeHint: {},
  // Per-day notes block (Step 9.5)
  dayNotesBlock: { borderLeftWidth: 3 },
});
