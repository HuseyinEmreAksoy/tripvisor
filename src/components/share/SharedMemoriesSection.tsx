/**
 * SharedMemoriesSection — the public page's memories (M5 Y3.5). Rendered only
 * when the owner turned "Your memories" on (the payload then carries
 * `memories`: the OWNER's items shared with the trip; "Only me" items and
 * other members' memories are never in it).
 *
 *   Memories
 *   Photos    ▢ ▢ ▢ ▢   (thumbnails; tap → lightbox with the full image)
 *   Journal   ┃ Day 2 · Tue, 4 Nov  "We got lost in Alfama…"
 *   Reviews   Pastéis de Belém ★★★★☆  "Worth the queue."
 *
 * Grid tiles load the thumbnail URLs from the read; the full image is fetched
 * only for the photo opened in the lightbox (rate-limited `photo_url`).
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import { dayColor, surfaceStyle, useTheme } from '@/theme';
import { useAppLocale, useT } from '@/i18n';
import type { SharedJournalEntry, SharedMemories, SharedMemoryPhoto } from '@/api/share';
import { dayDateLabel } from './sharedTripModel';
import { SharedPhotoLightbox } from './SharedPhotoLightbox';

const EMPTY_ART = require('../../../assets/images/empty-memories.png');

interface Props {
  token: string;
  memories: SharedMemories;
  startDate: string | null;
}

function byDayThenTime<T extends { dayIndex: number | null }>(time: (x: T) => string | null) {
  return (a: T, b: T) => {
    const da = a.dayIndex ?? Number.MAX_SAFE_INTEGER;
    const db = b.dayIndex ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    const ta = time(a) ?? '';
    const tb = time(b) ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  };
}

export function SharedMemoriesSection({ token, memories, startDate }: Props) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const photos = useMemo(
    () => [...memories.photos].sort(byDayThenTime<SharedMemoryPhoto>((p) => p.takenAt)),
    [memories.photos],
  );
  const journal = useMemo(
    () => [...memories.journal].sort(byDayThenTime<SharedJournalEntry>((j) => j.createdAt)),
    [memories.journal],
  );
  const reviews = memories.reviews;
  const empty = photos.length === 0 && journal.length === 0 && reviews.length === 0;

  return (
    <View style={[surfaceStyle(t, 'raised'), { padding: t.spacing.lg, gap: t.spacing.lg }]}>
      <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
        {tx('memories.title')}
      </Text>

      {empty ? (
        <View style={{ alignItems: 'center', gap: t.spacing.sm, paddingVertical: t.spacing.md }}>
          <Image source={EMPTY_ART} style={styles.emptyArt} contentFit="contain" accessible={false} />
          <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>{tx('memories.empty')}</Text>
        </View>
      ) : null}

      {photos.length > 0 ? <PhotoGrid token={token} photos={photos} /> : null}

      {journal.length > 0 ? (
        <View style={{ gap: t.spacing.sm }}>
          <SubHeading label={tx('memories.journal')} />
          {journal.map((entry) => (
            <JournalQuote key={entry.id} dayIndex={entry.dayIndex} body={entry.body} startDate={startDate} />
          ))}
        </View>
      ) : null}

      {reviews.length > 0 ? (
        <View style={{ gap: t.spacing.sm }}>
          <SubHeading label={tx('memories.reviews')} />
          {reviews.map((r) => (
            <View
              key={r.id}
              style={[styles.review, { borderColor: t.colors.border, borderRadius: t.radius.lg, padding: t.spacing.md, gap: 4 }]}
            >
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
                {r.placeName ?? tx('memories.unnamedPlace')}
              </Text>
              {r.rating != null ? <Stars rating={r.rating} /> : null}
              {r.body ? (
                <Text style={[t.typography.body, { color: t.colors.text }]} numberOfLines={6}>
                  {r.body}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {memories.truncated ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('memories.truncated')}</Text>
      ) : null}
    </View>
  );
}

function SubHeading({ label }: { label: string }) {
  const t = useTheme();
  return (
    <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '700' }]} accessibilityRole="header" aria-level={3}>
      {label}
    </Text>
  );
}

function PhotoGrid({ token, photos }: { token: string; photos: SharedMemoryPhoto[] }) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const gap = t.spacing.sm;
  const columns = width >= 640 ? 5 : width >= 440 ? 4 : 3;
  const tile = width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : 0;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <SubHeading label={tx('memories.photos')} />
      <View style={[styles.grid, { gap }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {tile > 0
          ? photos.map((photo, i) => {
              const n = i + 1;
              const label = photo.caption
                ? tx('memories.openPhotoCaption', { n, total: photos.length, caption: photo.caption })
                : tx('memories.openPhoto', { n, total: photos.length });
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setOpen(i)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => [
                    {
                      width: tile,
                      height: tile,
                      borderRadius: t.radius.md,
                      overflow: 'hidden',
                      backgroundColor: t.colors.bgMuted,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Image source={{ uri: photo.thumbUrl }} style={styles.fill} contentFit="cover" transition={120} accessible={false} />
                  {photo.dayIndex != null ? (
                    <View style={[styles.dayStripe, { backgroundColor: dayColor(photo.dayIndex) }]} />
                  ) : null}
                </Pressable>
              );
            })
          : null}
      </View>
      <SharedPhotoLightbox token={token} photos={photos} index={open} onIndexChange={setOpen} />
    </View>
  );
}

function JournalQuote({ dayIndex, body, startDate }: { dayIndex: number; body: string; startDate: string | null }) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const { language } = useAppLocale();
  if (!body.trim()) return null;
  const date = dayDateLabel(startDate, dayIndex, language);
  return (
    <View style={[styles.quote, { borderLeftColor: dayColor(dayIndex), paddingLeft: t.spacing.md, gap: 2 }]}>
      <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
        {[tx('memories.day', { day: dayIndex + 1 }), date].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[t.typography.body, { color: t.colors.text, fontStyle: 'italic' }]} numberOfLines={8}>
        {body}
      </Text>
    </View>
  );
}

function Stars({ rating }: { rating: number }) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <Text
      style={[t.typography.bodyStrong, { color: t.colors.warning, letterSpacing: 2 }]}
      accessibilityLabel={tx('memories.rating', { rating: r })}
      accessibilityRole="text"
    >
      {'★'.repeat(r) + '☆'.repeat(5 - r)}
    </Text>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  fill: { width: '100%', height: '100%' },
  dayStripe: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  quote: { borderLeftWidth: 3 },
  review: { borderWidth: 1 },
  emptyArt: { width: 140, height: 105 },
});
