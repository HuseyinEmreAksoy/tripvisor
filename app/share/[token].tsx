/**
 * app/share/[token].tsx — public, read-only trip page (mobile-first).
 *
 * NO authentication: reachable at https://<domain>/share/<token> and via the
 * tripvisor://share/<token> deep link. Nothing here reads the session.
 *
 * Layout
 *   Phone/tablet: top bar (brand · Share) → hero (title, dates, stats) →
 *   day tabs (Overview / Day 1…) → map for the selected day → timeline →
 *   "Powered by Google" → "Plan your own trip" CTA.
 *   Desktop (≥1024): scrolling itinerary column on the left, full-height map
 *   on the right.
 *
 * Google ToS: `useSharedTrip` returns only Tier-1 trip fields (user titles,
 * lat/lng, day assignment, durations, user notes, cached legs). No reviews,
 * photos, ratings or hours are fetched, nothing is persisted, and
 * `google_place_id` is never rendered. "Powered by Google" is shown whenever
 * place data renders.
 *
 * OG/Twitter meta: <SharedTripHead> (web only), mounted once data loads.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PoweredByGoogle } from '@/components/PoweredByGoogle';
import { Screen } from '@/components/Screen';
import { MapEmptyOverlay } from '@/components/Map/MapEmptyOverlay';
import { Map as TripMap, decodePolyline, type MapMarker, type MapPolyline } from '@/components/Map';
import { buildAppUrl, useShareAction } from '@/components/share';
import { SharedDayTabs } from '@/components/share/SharedDayTabs';
import { SharedTimeline } from '@/components/share/SharedTimeline';
import { SharedTripHead } from '@/components/share/SharedTripHead';
import {
  buildDayTabs,
  formatTripRange,
  groupByDay,
  indexLegs,
  tripDayCount,
  type DayKey,
} from '@/components/share/sharedTripModel';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';
import { useSharedTrip } from '@/api/share';
import type { SharedTrip } from '@/api/types';

const COLUMN_MAX_WIDTH = 720;
const DESKTOP_LIST_WIDTH = 520;

export default function SharedTripView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useTheme();
  const router = useRouter();
  // The only way forward from a public page is into the app. /login bounces
  // already-signed-in visitors on to /trips via the (auth) layout.
  const goPlan = () => router.push('/login');
  const { data: shared, isLoading, isError, refetch } = useSharedTrip(token ?? '');

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={t.colors.primary} accessibilityLabel="Loading trip" />
          <Text style={[t.typography.body, { color: t.colors.textMuted, marginTop: t.spacing.md }]}>Loading trip…</Text>
        </View>
      </Screen>
    );
  }

  // No <SharedTripHead> in error states — fall back to the baseline tags
  // rather than advertising a deleted or invalid trip.
  if (isError) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            title="Couldn't load this trip"
            body="Check your connection and try again."
            ctaLabel="Try again"
            onPress={() => void refetch()}
          />
        </View>
      </Screen>
    );
  }

  if (!shared) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            title="Link not found"
            body="This trip has been deleted or the share link was revoked."
            ctaLabel="Plan your own trip"
            onPress={goPlan}
          />
        </View>
      </Screen>
    );
  }

  const shareUrl = buildAppUrl(`share/${token ?? ''}`);
  return (
    <>
      <SharedTripHead
        trip={shared.trip}
        places={shared.places}
        url={shareUrl.usingDeepLink ? undefined : shareUrl.url}
      />
      <SharedTripContent shared={shared} shareUrl={shareUrl.url} onPlanOwn={goPlan} />
    </>
  );
}

function SharedTripContent({
  shared,
  shareUrl,
  onPlanOwn,
}: {
  shared: SharedTrip;
  shareUrl: string;
  onPlanOwn: () => void;
}) {
  const t = useTheme();
  const isDesktop = useBreakpoint() === 'desktop';
  const { trip, places, legs } = shared;
  const [selected, setSelected] = useState<DayKey>('all');
  const { share, feedback } = useShareAction();

  const sections = useMemo(() => groupByDay(places), [places]);
  const tabs = useMemo(() => buildDayTabs(trip.start_date, sections), [trip.start_date, sections]);
  const legIndex = useMemo(() => indexLegs(legs), [legs]);
  const visibleSections = selected === 'all' ? sections : sections.filter((s) => s.dayIndex === selected);
  const dayCount = tripDayCount(trip, sections);

  const markers: MapMarker[] = useMemo(
    () =>
      places
        .filter((p) => selected === 'all' || (p.day_index ?? -1) === selected)
        .map((p) => ({
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          title: p.user_title ?? 'Place',
          dayIndex: p.day_index,
          orderInDay: p.order_in_day,
        })),
    [places, selected],
  );
  const polylines: MapPolyline[] = useMemo(
    () =>
      legs
        .filter((l) => l.polyline && l.day_index >= 0 && (selected === 'all' || l.day_index === selected))
        .map((l) => ({ id: l.id, dayIndex: l.day_index, points: decodePolyline(l.polyline!) })),
    [legs, selected],
  );

  const title = trip.title || 'Untitled trip';
  const onShare = () =>
    void share({ url: shareUrl, title: `${title} · Tripvisor`, message: `Take a look at ${title} on Tripvisor.` });

  // Keyed by the selected tab so the map re-fits to that day's stops.
  const map = (
    <View
      style={[
        isDesktop ? styles.desktopMap : styles.phoneMap,
        !isDesktop && { marginHorizontal: t.spacing.lg, borderRadius: t.radius.xl, overflow: 'hidden' },
      ]}
      accessibilityLabel={selected === 'all' ? 'Map of the whole trip' : `Map of day ${Number(selected) + 1}`}
    >
      <TripMap key={String(selected)} markers={markers} polylines={polylines} />
      {places.length === 0 ? (
        <MapEmptyOverlay
          title="No stops on this trip yet"
          body="The route will appear here once places are added."
        />
      ) : null}
    </View>
  );

  const list = (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[
        { paddingBottom: t.spacing.huge, gap: t.spacing.lg },
        !isDesktop && styles.column,
      ]}
    >
      <TopBar onShare={onShare} onPlanOwn={onPlanOwn} showPlan={isDesktop} />
      {feedback ? (
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted, paddingHorizontal: t.spacing.lg }]}
          accessibilityLiveRegion="polite"
        >
          {feedback}
        </Text>
      ) : null}

      {/* Hero */}
      <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
        <Text style={[t.typography.overline, { color: t.colors.primary }]}>Shared itinerary · read-only</Text>
        <Text style={[t.typography.display, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
          {title}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{formatTripRange(trip.start_date, trip.end_date)}</Text>
        <View style={[styles.statRow, { gap: t.spacing.sm }]}>
          <Stat label={`${dayCount} day${dayCount === 1 ? '' : 's'}`} />
          <Stat label={`${places.length} stop${places.length === 1 ? '' : 's'}`} />
          <Stat label={`${trip.daily_hours_budget}h / day`} />
          <Stat label={capitalize(trip.transport_mode)} />
        </View>
      </View>

      {sections.length > 0 ? <SharedDayTabs tabs={tabs} selected={selected} onSelect={setSelected} /> : null}

      {!isDesktop && places.length > 0 ? map : null}

      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <SharedTimeline sections={visibleSections} startDate={trip.start_date} legIndex={legIndex} />
      </View>

      {places.length > 0 ? <PoweredByGoogle /> : null}

      {/* CTA — public viewers otherwise have nowhere to go */}
      <View
        style={{
          marginHorizontal: t.spacing.lg,
          padding: t.spacing.xl,
          gap: t.spacing.md,
          borderRadius: t.radius.xl,
          backgroundColor: t.colors.gradientSubtle,
          alignItems: 'center',
        }}
      >
        <Text style={[t.typography.subtitle, { color: t.colors.text, textAlign: 'center' }]}>
          Like this itinerary?
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
          Build your own day-by-day route in minutes with Tripvisor.
        </Text>
        <Button
          label="Plan your own trip"
          fullWidth={false}
          onPress={onPlanOwn}
          accessibilityLabel="Plan your own trip with Tripvisor. Opens sign in."
        />
      </View>
    </ScrollView>
  );

  return (
    <Screen padded={false}>
      {isDesktop ? (
        <View style={styles.desktopRow}>
          <View style={[styles.desktopList, { borderRightColor: t.colors.border }]}>{list}</View>
          {map}
        </View>
      ) : (
        list
      )}
    </Screen>
  );
}

function TopBar({ onShare, onPlanOwn, showPlan }: { onShare: () => void; onPlanOwn: () => void; showPlan: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, gap: t.spacing.sm }]}>
      <Text style={[t.typography.bodyStrong, { color: t.colors.primary, flex: 1 }]} accessibilityRole="header">
        Tripvisor
      </Text>
      {showPlan ? (
        <Button label="Plan your own" variant="ghost" fullWidth={false} onPress={onPlanOwn} accessibilityLabel="Plan your own trip with Tripvisor" />
      ) : null}
      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Share this trip"
        hitSlop={8}
        style={({ pressed }) => [
          styles.iconBtn,
          { borderRadius: t.radius.pill, borderColor: t.colors.border, backgroundColor: pressed ? t.colors.bgMuted : t.colors.cardBgSolid },
        ]}
      >
        <Icon name="share-2" size={18} color={t.colors.text} />
      </Pressable>
    </View>
  );
}

function Stat({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.xs }}>
      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  column: { maxWidth: COLUMN_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  phoneMap: { height: 260 },
  desktopRow: { flex: 1, flexDirection: 'row' },
  desktopList: { width: DESKTOP_LIST_WIDTH, borderRightWidth: 1 },
  desktopMap: { flex: 1 },
});
