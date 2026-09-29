/**
 * MemoriesScreen — /trip/[id]/memories (M5 Y3.1).
 *
 * A timeline by day (day-colour rail per MemoryDaySection): photo grids with
 * a lightbox, the user's day journal, place reviews, and trip-mates' SHARED
 * items. Memories are PRIVATE by default; every own item has a "Share with
 * trip" switch, each day has a bulk share, and the header shares the whole
 * trip. Upload progress / retry / failures (usePhotoUploads), the photo
 * quota (useMemoryQuota), skeleton, empty-state art, offline and error
 * states. The trip owner can remove others' shared items.
 *
 * A user who LEFT the trip (no role) keeps their own items here and can
 * still unshare or delete them (the server allows it), but adds nothing.
 *
 * Deep link from Today: `?day=<0-based>&compose=journal` scrolls to that day
 * and focuses its journal editor.
 *
 * Desktop: a centred 960 px column with 5-up photo grids; phones 3-up.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { BackButton, Button, Heading, Icon, Screen, Skeleton, SkeletonGroup, themedRefresh } from '@/components';
import { useT, formatDate, formatDateRange } from '@/i18n';
import { layout, surfaceStyle, useTheme } from '@/theme';
import { useIsOnline, useTrip, useTripPlaces, type TripPlace } from '@/api';
import {
  useDeleteMemory,
  useMemoryPhotoUrls,
  useMemoryQuota,
  usePhotoUploads,
  useRemoveTripMemory,
  useSetMemoryVisibility,
  useTripMemories,
} from '@/api/memories';
import type { MemoryItem, MemoryPhotoItem, MemoryReviewItem, MemoryVisibility } from '@/api/memories.types';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTripRole } from '@/hooks/useTripRole';
import { confirmDestructive } from '@/lib/confirm';
import { MemoryDaySection, bulkTarget } from './MemoryDaySection';
import { PhotoLightbox } from './PhotoLightbox';
import { QuotaMeter, UploadStatusBar } from './MemoryStatus';
import { useAddMemoryPhotos } from './useAddMemoryPhotos';
import { errorInfoOf, memoryErrorKey, type MemoryErrorKey } from './memoryErrors';
import { dayDate, mergeTripDays, tripDayCount } from './memoriesTimeline';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- static asset
const EMPTY_ART = require('../../../assets/images/empty-memories.png');


export function MemoriesScreen() {
  const t = useTheme();
  const { t: tx } = useT(['memories', 'common']);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; day?: string; compose?: string }>();
  const tripId = params.id;
  const focusDay = params.day !== undefined && /^\d+$/.test(params.day) ? Number(params.day) : null;
  const goBack = useSafeBack(`/trip/${tripId}` as Href);
  const online = useIsOnline();
  const { width } = useWindowDimensions();

  const { data: trip } = useTrip(tripId);
  const { role, isLoading: roleLoading } = useTripRole(tripId);
  // Offline, a member's collaborator row may be uncached (role null): the trip
  // row itself is still in Tier-1, so let them keep adding.
  const canWrite = role !== null || (!online && Boolean(trip));
  const isOwner = role === 'owner';
  const { data: places = [] } = useTripPlaces(tripId);
  const memories = useTripMemories(tripId);
  const uploads = usePhotoUploads(tripId);
  const quota = useMemoryQuota(tripId);
  const adder = useAddMemoryPhotos(tripId);
  const setVisibility = useSetMemoryVisibility();
  const del = useDeleteMemory();
  const remove = useRemoveTripMemory();

  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<MemoryErrorKey | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToFocus = useRef(false);

  const view = memories.data;
  const dayCount = tripDayCount(trip?.start_date, trip?.end_date);
  const groups = useMemo(() => mergeTripDays(view?.days ?? [], dayCount), [view?.days, dayCount]);
  const photos = useMemo(
    () => (view?.items ?? []).filter((i): i is MemoryPhotoItem => i.kind === 'photo'),
    [view?.items],
  );
  const thumbPaths = useMemo(
    () => photos.map((p) => (p.photo?.status === 'ready' ? p.photo.thumb_path : null)),
    [photos],
  );
  const { urls: thumbUrls } = useMemoryPhotoUrls(thumbPaths);
  const placeById = useMemo(() => {
    const m = new Map<string, TripPlace>();
    for (const p of places) m.set(p.id, p);
    return m;
  }, [places]);

  // Grid geometry: the column is ≤ 960 px; screen + card padding + rail.
  const column = Math.min(width, layout.contentWidth);
  const cols = column >= 720 ? 5 : column >= 520 ? 4 : 3;
  const inner = column - t.spacing.lg * 2 - t.spacing.lg * 2 - 6;
  const tileSize = Math.max(72, Math.floor((inner - t.spacing.sm * (cols - 1)) / cols));

  const fail = useCallback((e: unknown) => setActionError(memoryErrorKey(errorInfoOf(e))), []);

  const onSetVisibility = useCallback(
    (items: readonly MemoryItem[], next: MemoryVisibility) => {
      const own = items.filter((i) => i.isOwn && i.visibility !== next).map((i) => ({ kind: i.kind, id: i.id }));
      if (own.length === 0) return;
      setActionError(null);
      setVisibility.mutate({ tripId, items: own, visibility: next }, { onError: fail });
    },
    [setVisibility, tripId, fail],
  );

  const onDeletePhoto = async (item: MemoryPhotoItem) => {
    const ok = await confirmDestructive({
      title: tx('photo.deleteTitle'),
      message: tx('photo.deleteBody'),
      confirmLabel: tx('actions.delete'),
      cancelLabel: tx('common:actions.cancel'),
    });
    if (!ok) return;
    setLightboxId(null);
    del.mutate({ tripId, kind: 'photo', id: item.id }, { onError: fail });
  };

  const onRemove = async (item: MemoryItem) => {
    const ok = await confirmDestructive({
      title: tx('moderation.title'),
      message: tx('moderation.body'),
      confirmLabel: tx('actions.removeFromTrip'),
      cancelLabel: tx('common:actions.cancel'),
    });
    if (!ok) return;
    setLightboxId(null);
    const input: Parameters<typeof remove.mutate>[0] = { tripId, kind: item.kind, id: item.id };
    if (item.kind === 'photo' && item.photo) {
      input.storagePath = item.photo.storage_path;
      input.thumbPath = item.photo.thumb_path;
    }
    remove.mutate(input, { onError: fail });
  };

  const onOpenReview = (item: MemoryReviewItem) => {
    const gid = item.review.place_google_id_snapshot;
    const tpid = item.review.trip_place_id;
    if (!gid || !tpid) return;
    router.push(`/place/${gid}?tripPlaceId=${tpid}&tripId=${tripId}` as Href);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await memories.refetch();
      await quota.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const counts = view?.counts;
  const isEmpty = !!counts && counts.photos + counts.journal + counts.reviews === 0 && uploads.jobs.length === 0;
  const tripTarget = bulkTarget(view?.items ?? []);
  const addErrorKey = adder.error ? memoryErrorKey(adder.error) : null;
  const showSkeleton = memories.isLoading && !view;
  const dateRange = trip ? formatDateRange(trip.start_date, trip.end_date) : null;

  return (
    <Screen padded={false} width="content">
      <ScrollView
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} {...themedRefresh(t)} />}
        contentContainerStyle={[
          styles.column,
          { maxWidth: layout.contentWidth, padding: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxxl },
        ]}
      >
        <BackButton onPress={goBack} label={trip?.title ?? tx('back')} />

        <View style={{ gap: t.spacing.xs }}>
          <Heading level={1}>{tx('title')}</Heading>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            {trip ? [trip.title, dateRange].filter(Boolean).join(' · ') : tx('subtitle')}
          </Text>
          {counts ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {[
                tx('counts.photos', { count: counts.photos }),
                tx('counts.journal', { count: counts.journal }),
                tx('counts.reviews', { count: counts.reviews }),
              ].join(' · ')}
            </Text>
          ) : null}
          <QuotaMeter quota={quota.data} />
        </View>

        <View style={[styles.actions, { gap: t.spacing.sm }]}>
          {canWrite ? (
            <Button
              label={tx('actions.addPhotos')}
              leftIcon={<Icon name="camera" size={18} color={t.colors.primaryText} />}
              onPress={() => void adder.pick()}
              loading={adder.busy}
              disabled={quota.data?.storage_full === true}
            />
          ) : null}
          {tripTarget ? (
            <Button
              variant="secondary"
              label={tripTarget === 'trip' ? tx('actions.shareAll') : tx('actions.privateAll')}
              leftIcon={<Icon name={tripTarget === 'trip' ? 'users' : 'lock'} size={18} color={t.colors.text} />}
              onPress={() => onSetVisibility(view?.items ?? [], tripTarget)}
            />
          ) : null}
        </View>

        {!canWrite && !roleLoading && online ? (
          <Notice icon="lock" text={tx('leftTrip')} />
        ) : null}
        {!online ? <Notice icon="globe" text={tx('offline')} /> : null}
        {online && memories.error ? (
          <Notice icon="alert-triangle" text={tx('sharedLoadError')} actionLabel={tx('actions.reload')} onAction={() => void memories.refetch()} />
        ) : null}
        {addErrorKey ? (
          <Notice icon="alert-triangle" tone="danger" text={tx(addErrorKey)} actionLabel={tx('actions.dismiss')} onAction={adder.clearError} />
        ) : adder.partialFailures > 0 ? (
          <Notice icon="alert-triangle" tone="danger" text={tx('upload.partial', { count: adder.partialFailures })} actionLabel={tx('actions.dismiss')} onAction={adder.clearError} />
        ) : null}
        {actionError ? (
          <Notice icon="alert-triangle" tone="danger" text={tx(actionError)} actionLabel={tx('actions.dismiss')} onAction={() => setActionError(null)} />
        ) : null}

        <UploadStatusBar
          jobs={uploads.jobs}
          durable={uploads.durable}
          onRetryAll={() => uploads.jobs.filter((j) => j.state === 'failed').forEach((j) => uploads.retry(j.id))}
        />

        {showSkeleton ? (
          <SkeletonGroup label={tx('loading')} style={{ gap: t.spacing.md }}>
            <Skeleton height={180} radius="lg" />
            <Skeleton height={140} radius="lg" />
          </SkeletonGroup>
        ) : (
          <>
            {isEmpty ? (
              <View style={[surfaceStyle(t, 'flat'), styles.empty, { padding: t.spacing.xl, gap: t.spacing.md }]}>
                <Image source={EMPTY_ART} style={styles.emptyArt} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no" />
                <Text accessibilityRole="header" style={[t.typography.title, { color: t.colors.text, textAlign: 'center' }]}>
                  {tx('empty.title')}
                </Text>
                <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center', maxWidth: 420 }]}>
                  {tx('empty.body')}
                </Text>
              </View>
            ) : null}
            {groups.map((g) => (
              <View
                key={g.dayIndex ?? 'undated'}
                onLayout={(e) => {
                  if (scrolledToFocus.current || focusDay === null || g.dayIndex !== focusDay) return;
                  scrolledToFocus.current = true;
                  const y = e.nativeEvent.layout.y;
                  scrollRef.current?.scrollTo({ y: Math.max(0, y - t.spacing.lg), animated: false });
                }}
              >
                <MemoryDaySection
                  tripId={tripId}
                  group={g}
                  dateLabel={g.dayIndex === null ? '' : formatDate(dayDate(trip?.start_date, g.dayIndex), 'weekday')}
                  thumbUrls={thumbUrls}
                  tileSize={tileSize}
                  canWrite={canWrite}
                  isOwner={isOwner}
                  autoFocusJournal={params.compose === 'journal' && g.dayIndex === focusDay}
                  placeName={(id) => (id ? (placeById.get(id)?.user_title ?? null) : null)}
                  onOpenPhoto={setLightboxId}
                  onRetryUpload={uploads.retry}
                  onCancelUpload={(id) => void uploads.cancel(id).catch(fail)}
                  onAddPhotos={(dayIndex) => void adder.pick({ dayIndex })}
                  addBusy={adder.busy}
                  onSetVisibility={onSetVisibility}
                  onRemove={(item) => void onRemove(item)}
                  onOpenReview={onOpenReview}
                />
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <PhotoLightbox
        photos={photos}
        photoId={lightboxId}
        thumbUrls={thumbUrls}
        onChangePhoto={setLightboxId}
        onClose={() => setLightboxId(null)}
        isOwner={isOwner}
        onSetVisibility={(item, next) => onSetVisibility([item], next)}
        onDelete={(item) => void onDeletePhoto(item)}
        onRemove={(item) => void onRemove(item)}
      />
    </Screen>
  );
}

function Notice({
  icon,
  text,
  tone = 'info',
  actionLabel,
  onAction,
}: {
  icon: 'lock' | 'globe' | 'alert-triangle';
  text: string;
  tone?: 'info' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  const color = tone === 'danger' ? t.colors.dangerText : t.colors.text;
  return (
    <View
      style={[
        styles.notice,
        {
          backgroundColor: tone === 'danger' ? t.colors.dangerLight : t.colors.bgMuted,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon} size={18} color={color} />
      <Text style={[t.typography.caption, { color, flex: 1 }]}>{text}</Text>
      {actionLabel && onAction ? <Button variant="ghost" label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  notice: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  empty: { alignItems: 'center' },
  emptyArt: { width: 220, height: 165 },
});
