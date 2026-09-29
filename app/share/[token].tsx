/**
 * app/share/[token].tsx — public, read-only trip page (mobile-first).
 *
 * NO authentication: reachable at https://<domain>/share/<token> and via the
 * tripvisor://share/<token> deep link. Nothing here reads the session.
 *
 * Layout
 *   Phone/tablet: top bar (brand · Share) → hero (title, dates, stats) →
 *   day tabs (Overview / Day 1…) → map for the selected day → timeline →
 *   "Powered by Google" → memories → expense summary → "Plan your own trip".
 *   Desktop (≥1024): scrolling column on the left, full-height map on the
 *   right (a single centred column when the itinerary is hidden).
 *
 * Sections (share-trip contract v3+, M5 Y3.5): each renders ONLY when its
 * key is in the payload. `sections.itinerary === false` → "hidden by the
 * owner" instead of the plan; `expenses` / `memories` appear only when the
 * owner turned them on. A v2 payload (no `sections`) shows the itinerary.
 * A rate-limited read (`rate_limited` / `rate_limit_unavailable`) gets a
 * "try again later" state, never an automatic retry.
 *
 * Google ToS: `useSharedTrip` returns only Tier-1 trip fields (user titles,
 * lat/lng, day assignment, durations, cached legs) plus user content (the
 * owner's memories). No Google reviews, photos, ratings or hours are
 * fetched, nothing is persisted, and `google_place_id` is never rendered.
 * "Powered by Google" is shown whenever place data renders.
 *
 * OG/Twitter meta: <SharedTripHead> (web only), mounted once data loads.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { PoweredByGoogle } from '@/components/PoweredByGoogle';
import { Screen } from '@/components/Screen';
import { MapEmptyOverlay } from '@/components/Map/MapEmptyOverlay';
import { Map as TripMap, decodePolyline, type MapMarker, type MapPolyline } from '@/components/Map';
import { buildAppUrl, useShareAction } from '@/components/share';
import { SharedDayTabs } from '@/components/share/SharedDayTabs';
import { SharedTimeline } from '@/components/share/SharedTimeline';
import { SharedTripHead } from '@/components/share/SharedTripHead';
import { SharedExpensesSection } from '@/components/share/SharedExpensesSection';
import { SharedMemoriesSection } from '@/components/share/SharedMemoriesSection';
import { isShareBusyError } from '@/components/share/SharedPhotoLightbox';
import { ItineraryHiddenCard, SharedTripSkeleton, SharedTripStatus } from '@/components/share/SharedPageStates';
import {
  buildDayTabs,
  formatTripRange,
  groupByDay,
  indexLegs,
  tripDayCount,
  type DayKey,
} from '@/components/share/sharedTripModel';
import { transportKey } from '@/components/transportModes';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTheme } from '@/theme';
import { formatDuration, useAppLocale, useT } from '@/i18n';
import { useSharedTrip, type SharedTripPayload } from '@/api/share';

const COLUMN_MAX_WIDTH = 720;
const DESKTOP_LIST_WIDTH = 520;

export default function SharedTripView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  // The only way forward from a public page is into the app. /login bounces
  // already-signed-in visitors on to /trips via the (auth) layout.
  const goPlan = () => router.push('/login');
  const { data: shared, isLoading, isError, error, refetch } = useSharedTrip(token ?? '');

  if (isLoading) return <SharedTripSkeleton />;

  // No <SharedTripHead> in error states — fall back to the baseline tags
  // rather than advertising a deleted or invalid trip.
  if (isError) {
    return (
      <SharedTripStatus kind={isShareBusyError(error) ? 'busy' : 'error'} onRetry={() => void refetch()} onPlanOwn={goPlan} />
    );
  }

  if (!shared) return <SharedTripStatus kind="notFound" onRetry={() => void refetch()} onPlanOwn={goPlan} />;

  const shareUrl = buildAppUrl(`share/${token ?? ''}`);
  return (
    <>
      <SharedTripHead
        trip={shared.trip}
        places={shared.places}
        url={shareUrl.usingDeepLink ? undefined : shareUrl.url}
      />
      <SharedTripContent shared={shared} token={token ?? ''} shareUrl={shareUrl.url} onPlanOwn={goPlan} />
    </>
  );
}

function SharedTripContent({
  shared,
  token,
  shareUrl,
  onPlanOwn,
}: {
  shared: SharedTripPayload;
  token: string;
  shareUrl: string;
  onPlanOwn: () => void;
}) {
  const t = useTheme();
  const { t: tx } = useT(['share', 'trip']);
  const { language } = useAppLocale();
  const { trip, places, legs } = shared;
  // v2 payloads have no `sections`: the itinerary is always on there.
  const itineraryHidden = shared.sections ? !shared.sections.itinerary : false;
  const isDesktop = useBreakpoint() === 'desktop';
  const splitLayout = isDesktop && !itineraryHidden;
  const [selected, setSelected] = useState<DayKey>('all');
  const { share, feedback } = useShareAction();

  const sections = useMemo(() => groupByDay(places), [places]);
  const tabs = useMemo(() => buildDayTabs(trip.start_date, sections, language), [trip.start_date, sections, language]);
  const legIndex = useMemo(() => indexLegs(legs), [legs]);
  const visibleSections = selected === 'all' ? sections : sections.filter((s) => s.dayIndex === selected);
  const dayCount = tripDayCount(trip, sections);
  const placeFallback = tx('share:timeline.place');

  const markers: MapMarker[] = useMemo(
    () =>
      places
        .filter((p) => selected === 'all' || (p.day_index ?? -1) === selected)
        .map((p) => ({
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          title: p.user_title ?? placeFallback,
          dayIndex: p.day_index,
          orderInDay: p.order_in_day,
        })),
    [places, selected, placeFallback],
  );
  const polylines: MapPolyline[] = useMemo(() => {
    // Defense in depth (the server already drops them): never draw a leg to
    // a stop that is not on the public itinerary (e.g. a deleted place).
    const placeIds = new Set(places.map((p) => p.id));
    return legs
      .filter((l) => placeIds.has(l.from_place_id) && placeIds.has(l.to_place_id))
      .filter((l) => l.polyline && l.day_index >= 0 && (selected === 'all' || l.day_index === selected))
      .map((l) => ({ id: l.id, dayIndex: l.day_index, points: decodePolyline(l.polyline!) }));
  }, [legs, places, selected]);

  const title = trip.title || tx('share:page.untitled');
  const onShare = () =>
    void share({
      url: shareUrl,
      title: tx('share:link.shareTitle', { title }),
      message: tx('share:page.shareMessage', { title }),
    });

  // Keyed by the selected tab so the map re-fits to that day's stops.
  const map = (
    <View
      style={[
        splitLayout ? styles.desktopMap : styles.phoneMap,
        !splitLayout && { marginHorizontal: t.spacing.lg, borderRadius: t.radius.xl, overflow: 'hidden' },
      ]}
      accessibilityLabel={selected === 'all' ? tx('share:page.mapAll') : tx('share:page.mapDay', { day: Number(selected) + 1 })}
    >
      <TripMap key={String(selected)} markers={markers} polylines={polylines} />
      {places.length === 0 ? (
        <MapEmptyOverlay title={tx('share:page.mapEmptyTitle')} body={tx('share:page.mapEmptyBody')} />
      ) : null}
    </View>
  );

  const stats = [
    dayCount > 0 ? tx('share:page.days', { count: dayCount }) : null,
    itineraryHidden ? null : tx('share:page.stops', { count: places.length }),
    trip.daily_hours_budget > 0
      ? tx('share:page.hoursPerDay', { hours: formatDuration(trip.daily_hours_budget * 60, language) })
      : null,
    tx(`trip:${transportKey(trip.transport_mode)}`),
  ].filter((s): s is string => Boolean(s));

  const list = (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[{ paddingBottom: t.spacing.huge, gap: t.spacing.lg }, !splitLayout && styles.column]}
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
        <Text style={[t.typography.overline, { color: t.colors.primaryInk }]}>{tx('share:page.overline')}</Text>
        <Text style={[t.typography.display, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
          {title}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {formatTripRange(trip.start_date, trip.end_date, language)}
        </Text>
        <View style={[styles.statRow, { gap: t.spacing.sm }]}>
          {stats.map((label) => (
            <Stat key={label} label={label} />
          ))}
        </View>
      </View>

      {itineraryHidden ? (
        <ItineraryHiddenCard />
      ) : (
        <>
          {sections.length > 0 ? <SharedDayTabs tabs={tabs} selected={selected} onSelect={setSelected} /> : null}
          {!splitLayout && places.length > 0 ? map : null}
          <View style={{ paddingHorizontal: t.spacing.lg }}>
            <SharedTimeline sections={visibleSections} startDate={trip.start_date} legIndex={legIndex} />
          </View>
          {places.length > 0 ? <PoweredByGoogle /> : null}
        </>
      )}

      {shared.memories ? (
        <View style={{ paddingHorizontal: t.spacing.lg }}>
          <SharedMemoriesSection token={token} memories={shared.memories} startDate={trip.start_date} />
        </View>
      ) : null}

      {shared.expenses ? (
        <View style={{ paddingHorizontal: t.spacing.lg }}>
          <SharedExpensesSection summary={shared.expenses} />
        </View>
      ) : null}

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
        <Text style={[t.typography.subtitle, { color: t.colors.text, textAlign: 'center' }]}>{tx('share:page.ctaTitle')}</Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>{tx('share:page.ctaBody')}</Text>
        <Button
          label={tx('share:page.planOwn')}
          fullWidth={false}
          onPress={onPlanOwn}
          accessibilityLabel={tx('share:page.planOwnA11y')}
        />
      </View>
    </ScrollView>
  );

  return (
    <Screen padded={false}>
      {splitLayout ? (
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
  const { t: tx } = useT('share');
  return (
    <View style={[styles.topBar, { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, gap: t.spacing.sm }]}>
      <Text style={[t.typography.bodyStrong, { color: t.colors.primaryInk, flex: 1 }]} accessibilityRole="header">
        Tripvisor
      </Text>
      {showPlan ? (
        <Button
          label={tx('page.planOwnShort')}
          variant="ghost"
          fullWidth={false}
          onPress={onPlanOwn}
          accessibilityLabel={tx('page.planOwnA11y')}
        />
      ) : null}
      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel={tx('page.shareA11y')}
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

const styles = StyleSheet.create({
  column: { maxWidth: COLUMN_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  phoneMap: { height: 260 },
  desktopRow: { flex: 1, flexDirection: 'row' },
  desktopList: { width: DESKTOP_LIST_WIDTH, borderRightWidth: 1 },
  desktopMap: { flex: 1 },
});
