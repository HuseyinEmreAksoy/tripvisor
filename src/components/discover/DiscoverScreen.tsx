/**
 * DiscoverScreen — /trip/[id]/discover (M5 Y3.4, ADR-0013).
 *
 * Interest chips (pre-selected from preferences, else the onboarding picks)
 * → a search centre (whole trip / a day's stops / my location) → OSM +
 * Wikipedia recommendations (memory-only) as a card list and map pins.
 * Tap → RecDetailSheet (Google rating on tap, "Add to Ideas / Day N").
 *
 * States: pick-interests prompt, no-centre prompt, "searching nearby…"
 * skeleton (first search 4–8 s), degraded banner, quota / kill-switch /
 * generic errors with retry, offline, and the empty-discover art.
 * OSM attribution is always shown under results; wiki cards carry their own
 * CC BY-SA link.
 *
 * Layout: phones get a List | Map toggle; desktop (≥ 1024) shows the list
 * column next to the map.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Map as TripMap, type MapMarker } from '@/components/Map';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTripRole } from '@/hooks/useTripRole';
import { useIsOnline, useTrip, useTripPlaces } from '@/api';
import { useUpdateUserPreferences, useUserPreferences } from '@/api/preferences';
import { useRecommendationCenter, useRecommendations, type PoiItem } from '@/api/recommendations';
import { CenterChips } from './CenterChips';
import { DiscoverCard } from './DiscoverCard';
import { DiscoverAttribution, DiscoverBanner, DiscoverSkeleton } from './DiscoverStates';
import { InterestChips } from './InterestChips';
import { RecDetailSheet } from './RecDetailSheet';
import {
  degradedKey,
  initialInterests,
  isPermanentRecommendationsError,
  normalizeInterests,
  parseDayParam,
  recommendationsErrorKey,
  sameInterests,
  tripDayCountOf,
  type CenterMode,
  type Interest,
} from './discoverModel';
import { readPendingInterests } from './pendingInterests';
import { useAdoptPendingInterests } from './useAdoptPendingInterests';

/** Chip taps settle before a (quota-metered) search starts. */
export const INTEREST_DEBOUNCE_MS = 600;
const DESKTOP_LIST_WIDTH = 480;
const emptyArt = require('../../../assets/images/empty-discover.png');
const offlineArt = require('../../../assets/images/offline.png');

export interface DiscoverScreenProps {
  tripId: string;
  dayParam?: string | string[];
}

export function DiscoverScreen({ tripId, dayParam }: DiscoverScreenProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const goBack = useSafeBack(`/trip/${tripId}`);
  const isDesktop = useBreakpoint() === 'desktop';
  const online = useIsOnline();

  const { data: trip } = useTrip(tripId);
  const { data: places = [] } = useTripPlaces(tripId);
  const { canEditTrip } = useTripRole(tripId);
  const dayCount = tripDayCountOf(trip?.start_date, trip?.end_date);

  // ── Interests ────────────────────────────────────────────────────────────
  useAdoptPendingInterests();
  const prefs = useUserPreferences();
  const savePrefs = useUpdateUserPreferences();
  const [interests, setInterests] = useState<Interest[] | null>(null);
  const [applied, setApplied] = useState<Interest[]>([]);
  const [savedNote, setSavedNote] = useState(false);
  const prefsSettled = prefs.data !== undefined || prefs.isError || prefs.fetchStatus === 'idle';

  useEffect(() => {
    if (interests !== null || !prefsSettled) return;
    let cancelled = false;
    void readPendingInterests().then((pending) => {
      if (cancelled) return;
      const first = initialInterests(prefs.data?.interests, pending);
      setInterests(first);
      setApplied(first);
    });
    return () => {
      cancelled = true;
    };
  }, [interests, prefsSettled, prefs.data?.interests]);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);
  const onInterests = (next: Interest[]) => {
    setInterests(next);
    setSavedNote(false);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setApplied(next), INTEREST_DEBOUNCE_MS);
  };
  const savedInterests = normalizeInterests(prefs.data?.interests);
  const canSaveDefault =
    prefs.data !== undefined && (interests?.length ?? 0) > 0 && !sameInterests(interests ?? [], savedInterests);

  // ── Centre ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CenterMode>({ kind: 'trip' });
  const dayInit = useRef(false);
  useEffect(() => {
    if (dayInit.current || !trip) return;
    dayInit.current = true;
    const d = parseDayParam(dayParam, dayCount);
    if (d !== null) setMode({ kind: 'day', dayIndex: d });
  }, [trip, dayParam, dayCount]);

  const location = useCurrentLocation();
  const locationFailed = ['denied', 'error', 'unavailable'].includes(location.status);
  const onMode = (next: CenterMode) => {
    setMode(next);
    if (next.kind === 'here' && !location.location) void location.request();
  };
  const hereReady = mode.kind === 'here' && !!location.location;
  const hereWaiting = mode.kind === 'here' && !location.location && !locationFailed;
  // A failed location falls back to the trip, with a banner.
  const effectiveMode: CenterMode = mode.kind === 'here' && locationFailed ? { kind: 'trip' } : mode;
  const dayIndex = effectiveMode.kind === 'day' ? effectiveMode.dayIndex : undefined;
  const center = hereReady ? location.location : null;

  const centerInfo = useRecommendationCenter({ tripId, dayIndex, center });
  const query = useRecommendations(
    { tripId, dayIndex, center, interests: applied },
    { enabled: !hereWaiting && online },
  );

  // ── Detail sheet ─────────────────────────────────────────────────────────
  const [openItem, setOpenItem] = useState<PoiItem | null>(null);
  const existingIds = useMemo(() => places.map((p) => p.google_place_id).filter(Boolean), [places]);
  const [view, setView] = useState<'list' | 'map'>('list');

  const items = query.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const markers: MapMarker[] = useMemo(
    () => items.map((i) => ({ id: i.id, lat: i.lat, lng: i.lng, title: i.name, dayIndex: null })),
    [items],
  );

  // ── Body ─────────────────────────────────────────────────────────────────
  const noInterests = interests !== null && interests.length === 0;
  const noCenter = !hereWaiting && effectiveMode.kind !== 'here' && !centerInfo.loading && centerInfo.center === null;
  const searching = !noInterests && (interests === null || hereWaiting || centerInfo.loading || query.isLoading);
  const dKey = degradedKey(query.data?.degraded);

  const banners = (
    <>
      {mode.kind === 'here' && locationFailed ? (
        <DiscoverBanner
          tone="info"
          message={tx(location.status === 'denied' ? 'center.denied' : 'center.unavailable')}
        />
      ) : null}
      {dKey ? <DiscoverBanner tone="info" message={tx(dKey)} /> : null}
      {query.error && online ? (
        <DiscoverBanner
          tone={isPermanentRecommendationsError(query.error) ? 'warning' : 'danger'}
          message={tx(recommendationsErrorKey(query.error))}
          actionLabel={isPermanentRecommendationsError(query.error) ? undefined : tx('error.retry')}
          onAction={() => void query.refetch()}
        />
      ) : null}
    </>
  );

  let results: React.ReactNode = null;
  if (noInterests) {
    results = <EmptyState illustration={emptyArt} title={tx('pickInterests.title')} body={tx('pickInterests.body')} />;
  } else if (noCenter) {
    results = (
      <EmptyState
        illustration={emptyArt}
        title={tx('noCenter.title')}
        body={tx('noCenter.body')}
        ctaLabel={tx('noCenter.useLocation')}
        onPress={() => onMode({ kind: 'here' })}
      />
    );
  } else if (!online && !query.data) {
    results = <EmptyState illustration={offlineArt} title={tx('offlineState.title')} body={tx('error.offline')} />;
  } else if (searching && !query.data) {
    results = <DiscoverSkeleton />;
  } else if (query.data && items.length === 0) {
    results = <EmptyState illustration={emptyArt} title={tx('empty.title')} body={tx('empty.body')} />;
  } else if (items.length > 0) {
    results = (
      <View style={{ gap: t.spacing.md }}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
          {tx('results', { count: items.length })}
        </Text>
        {items.map((item) => (
          <DiscoverCard key={item.id} item={item} onOpen={setOpenItem} compact={!isDesktop} />
        ))}
      </View>
    );
  }

  const attribution = query.data ? <DiscoverAttribution attribution={query.data.attribution} /> : null;

  const controls = (
    <View style={{ gap: t.spacing.md }}>
      <BackButton onPress={goBack} />
      <View style={{ gap: t.spacing.xs }}>
        <View style={[styles.titleRow, { gap: t.spacing.sm }]}>
          <Icon name="compass" size={26} color={t.colors.primary} />
          <Text style={[t.typography.title, styles.shrink, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
            {tx('title')}
          </Text>
        </View>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          {trip?.title ? `${trip.title} · ${tx('subtitle')}` : tx('subtitle')}
        </Text>
      </View>
      <InterestChips value={interests ?? []} onChange={onInterests} disabled={interests === null} />
      {canSaveDefault ? (
        <View style={styles.saveRow}>
          <Button
            variant="ghost"
            label={tx('saveDefault')}
            onPress={() =>
              savePrefs.mutate({ interests: interests ?? [] }, { onSuccess: () => setSavedNote(true) })
            }
            loading={savePrefs.isPending}
          />
        </View>
      ) : savedNote ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]} accessibilityLiveRegion="polite">
          {tx('savedDefault')}
        </Text>
      ) : null}
      <CenterChips value={mode} dayCount={dayCount} onChange={onMode} locating={location.status === 'requesting'} />
      {!isDesktop ? (
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: tx('view.list') },
            { value: 'map', label: tx('view.map') },
          ]}
        />
      ) : null}
      {banners}
    </View>
  );

  const map = (
    <TripMap markers={markers} polylines={[]} onMarkerPress={(id: string) => setOpenItem(byId.get(id) ?? null)} />
  );

  const sheet = (
    <RecDetailSheet
      item={openItem}
      tripId={tripId}
      dayCount={dayCount}
      defaultDayIndex={effectiveMode.kind === 'day' ? effectiveMode.dayIndex : null}
      canEdit={canEditTrip}
      existingGooglePlaceIds={existingIds}
      onClose={() => setOpenItem(null)}
    />
  );

  if (isDesktop) {
    return (
      <Screen padded={false}>
        <View style={styles.desktopRow}>
          <ScrollView
            style={{ width: DESKTOP_LIST_WIDTH, flexGrow: 0 }}
            contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}
          >
            {controls}
            {results}
            {attribution}
          </ScrollView>
          <View style={[styles.flex, { borderLeftWidth: 1, borderLeftColor: t.colors.border }]}>{map}</View>
        </View>
        {sheet}
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {view === 'list' ? (
        <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
          {controls}
          {results}
          {attribution}
        </ScrollView>
      ) : (
        <View style={styles.flex}>
          <ScrollView style={styles.mapControls} contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
            {controls}
            {searching && !query.data ? <DiscoverSkeleton count={0} /> : null}
          </ScrollView>
          <View style={[styles.flex, styles.mapBox]}>{map}</View>
          {attribution ? (
            <View style={{ paddingHorizontal: t.spacing.lg, backgroundColor: t.colors.bg }}>{attribution}</View>
          ) : null}
        </View>
      )}
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1 },
  saveRow: { alignItems: 'flex-start' },
  desktopRow: { flex: 1, flexDirection: 'row' },
  mapControls: { flexGrow: 0, maxHeight: '55%' },
  mapBox: { minHeight: 280 },
});
