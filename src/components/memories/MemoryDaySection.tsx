/**
 * MemoryDaySection — one day of the memories timeline (M5 Y3.1).
 *
 * A day-colour rail (dayColor — the one source shared with the map and the
 * itinerary) runs down the left edge; the header carries the day badge,
 * date and a bulk "Share day with trip" / "Make day private" action for the
 * user's OWN items. Body: photo grid (+ add), the user's journal editor,
 * trip-mates' shared journal entries, and place reviews.
 *
 * Own items can always be unshared / deleted, even after the user left the
 * trip (`canWrite=false`); the trip owner can remove others' SHARED items.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';
import { ON_DAY_COLOR, dayColor, dayTint, surfaceStyle, useTheme } from '@/theme';
import type {
  MemoryDayGroup,
  MemoryItem,
  MemoryJournalItem,
  MemoryPhotoItem,
  MemoryReviewItem,
  MemoryVisibility,
} from '@/api/memories.types';
import { JournalEditor } from './JournalEditor';
import { PhotoGrid } from './PhotoGrid';
import { StarRating } from './StarRating';
import { VisibilityBadge, VisibilityToggle } from './VisibilityToggle';

export interface MemoryDaySectionProps {
  tripId: string;
  group: MemoryDayGroup;
  /** Formatted date of the day ('' when the trip has no dates / undated group). */
  dateLabel: string;
  thumbUrls: Record<string, string>;
  tileSize: number;
  canWrite: boolean;
  isOwner: boolean;
  autoFocusJournal?: boolean;
  placeName: (tripPlaceId: string | null) => string | null;
  onOpenPhoto: (photoId: string) => void;
  onRetryUpload: (photoId: string) => void;
  onCancelUpload: (photoId: string) => void;
  onAddPhotos: (dayIndex: number | null) => void;
  addBusy: boolean;
  onSetVisibility: (items: readonly MemoryItem[], next: MemoryVisibility) => void;
  onRemove: (item: MemoryItem) => void;
  onOpenReview: (item: MemoryReviewItem) => void;
}

/** The bulk action for a set of items: share if any OWN item is still private. */
export function bulkTarget(items: readonly MemoryItem[]): MemoryVisibility | null {
  const own = items.filter((i) => i.isOwn);
  if (own.length === 0) return null;
  return own.some((i) => i.visibility === 'only_me') ? 'trip' : 'only_me';
}

export function MemoryDaySection({
  tripId,
  group,
  dateLabel,
  thumbUrls,
  tileSize,
  canWrite,
  isOwner,
  autoFocusJournal = false,
  placeName,
  onOpenPhoto,
  onRetryUpload,
  onCancelUpload,
  onAddPhotos,
  addBusy,
  onSetVisibility,
  onRemove,
  onOpenReview,
}: MemoryDaySectionProps) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const { dayIndex, items } = group;
  const color = dayColor(dayIndex);
  const photos = items.filter((i): i is MemoryPhotoItem => i.kind === 'photo');
  const journal = items.filter((i): i is MemoryJournalItem => i.kind === 'journal');
  const reviews = items.filter((i): i is MemoryReviewItem => i.kind === 'review');
  const ownJournal = journal.some((j) => j.isOwn);
  const othersJournal = journal.filter((j) => !j.isOwn);
  const target = bulkTarget(items);
  const title = dayIndex === null ? tx('undated') : tx('dayLabel', { day: dayIndex + 1 });
  const showJournal = dayIndex !== null && (canWrite || ownJournal);

  return (
    <View style={[styles.section, surfaceStyle(t, 'raised')]}>
      <View style={[styles.rail, { backgroundColor: color, borderTopLeftRadius: t.radius.lg, borderBottomLeftRadius: t.radius.lg }]} />
      <View style={{ flex: 1, padding: t.spacing.lg, gap: t.spacing.md }}>
        <View style={[styles.header, { gap: t.spacing.sm }]}>
          <View style={[styles.dayBadge, { backgroundColor: color }]}>
            {dayIndex === null ? (
              <Icon name="calendar" size={16} color={ON_DAY_COLOR} />
            ) : (
              <Text style={[t.typography.bodyStrong, { color: ON_DAY_COLOR }]}>{dayIndex + 1}</Text>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 120 }}>
            <Text accessibilityRole="header" aria-level={2} style={[t.typography.subtitle, { color: t.colors.text }]}>
              {title}
            </Text>
            {dateLabel ? <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{dateLabel}</Text> : null}
          </View>
          {target ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={target === 'trip' ? tx('actions.shareDayA11y', { day: title }) : tx('actions.privateDayA11y', { day: title })}
              onPress={() => onSetVisibility(items, target)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: pressed ? dayTint(dayIndex, t.name) : t.colors.bgMuted,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.md,
                  gap: t.spacing.xs,
                },
              ]}
            >
              <Icon name={target === 'trip' ? 'users' : 'lock'} size={14} color={t.colors.text} />
              <Text style={[t.typography.caption, { color: t.colors.text }]}>
                {target === 'trip' ? tx('actions.shareDay') : tx('actions.privateDay')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {photos.length > 0 ? (
          <PhotoGrid
            photos={photos}
            thumbUrls={thumbUrls}
            tileSize={tileSize}
            onOpen={onOpenPhoto}
            onRetry={onRetryUpload}
            onCancel={onCancelUpload}
          />
        ) : null}
        {canWrite ? (
          <View style={styles.addRow}>
            <Button
              variant="secondary"
              label={dayIndex === null ? tx('actions.addPhotos') : tx('actions.addPhotosToDay', { day: dayIndex + 1 })}
              leftIcon={<Icon name="camera" size={18} color={t.colors.text} />}
              onPress={() => onAddPhotos(dayIndex)}
              loading={addBusy}
            />
          </View>
        ) : null}

        {showJournal && dayIndex !== null ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('journal.heading')}</Text>
            <JournalEditor tripId={tripId} dayIndex={dayIndex} canWrite={canWrite} autoFocus={autoFocusJournal} />
          </View>
        ) : null}

        {othersJournal.map((j) => (
          <View
            key={j.id}
            style={[styles.quote, { borderLeftColor: color, paddingLeft: t.spacing.md, gap: t.spacing.xs }]}
          >
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('by.tripmate')}</Text>
            <Text style={[t.typography.body, { color: t.colors.text }]}>{j.entry.body}</Text>
            {isOwner && j.visibility === 'trip' ? (
              <RemoveLink onPress={() => onRemove(j)} />
            ) : null}
          </View>
        ))}

        {reviews.length > 0 ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('review.listHeading')}</Text>
            {reviews.map((r) => (
              <ReviewCard
                key={r.id}
                item={r}
                name={placeName(r.review.trip_place_id) ?? r.review.place_name_snapshot ?? tx('review.removedPlace')}
                isOwner={isOwner}
                onOpen={() => onOpenReview(r)}
                onSetVisibility={(next) => onSetVisibility([r], next)}
                onRemove={() => onRemove(r)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ReviewCard({
  item,
  name,
  isOwner,
  onOpen,
  onSetVisibility,
  onRemove,
}: {
  item: MemoryReviewItem;
  name: string;
  isOwner: boolean;
  onOpen: () => void;
  onSetVisibility: (next: MemoryVisibility) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const canOpen = Boolean(item.review.trip_place_id && item.review.place_google_id_snapshot);
  return (
    <View style={[surfaceStyle(t, 'flat'), { padding: t.spacing.md, gap: t.spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tx('review.openPlace', { name })}
        disabled={!canOpen}
        onPress={onOpen}
        style={({ pressed }) => [styles.reviewHead, { gap: t.spacing.sm, opacity: pressed ? 0.7 : 1 }]}
      >
        <Text numberOfLines={1} style={[t.typography.bodyStrong, { color: t.colors.text, flex: 1 }]}>
          {name}
        </Text>
        <StarRating value={item.review.rating} size={14} />
        {canOpen ? <Icon name="chevron-right" size={16} color={t.colors.textMuted} /> : null}
      </Pressable>
      {item.review.body ? <Text style={[t.typography.body, { color: t.colors.text }]}>{item.review.body}</Text> : null}
      {item.isOwn ? (
        <VisibilityToggle visibility={item.visibility} onChange={onSetVisibility} itemLabel={tx('items.review')} compact />
      ) : (
        <View style={[styles.reviewHead, { gap: t.spacing.sm }]}>
          <VisibilityBadge visibility={item.visibility} />
          <Text style={[t.typography.small, { color: t.colors.textMuted, flex: 1 }]}>{tx('by.tripmate')}</Text>
          {isOwner && item.visibility === 'trip' ? <RemoveLink onPress={onRemove} /> : null}
        </View>
      )}
    </View>
  );
}

function RemoveLink({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tx('actions.removeFromTrip')}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[t.typography.caption, { color: t.colors.dangerText }]}>{tx('actions.removeFromTrip')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { flexDirection: 'row' },
  rail: { width: 6 },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  dayBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  addRow: { flexDirection: 'row' },
  quote: { borderLeftWidth: 3 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
