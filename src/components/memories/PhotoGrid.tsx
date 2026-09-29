/**
 * PhotoGrid — one day's memory photos as square thumbnails (M5 Y3.1).
 *
 * Each tile shows, in order of availability: the signed thumbnail (ready
 * rows), the local re-encoded preview (this device's queued uploads), or a
 * neutral placeholder. Upload state sits on the tile: a progress bar while
 * uploading, a clock while queued / waiting (network or the pending-slot
 * cap), and a failed overlay with Retry / Cancel. A lock / people badge says
 * who can see it. Tapping a viewable tile opens the lightbox.
 *
 * `thumbUrls` is resolved ONCE by the screen (one batched createSignedUrls).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from '@/components/Icon';
import { useT, formatPercent } from '@/i18n';
import { useTheme } from '@/theme';
import type { MemoryPhotoItem } from '@/api/memories.types';
import { VisibilityBadge } from './VisibilityToggle';
import { memoryErrorKey } from './memoryErrors';

export interface PhotoGridProps {
  photos: readonly MemoryPhotoItem[];
  thumbUrls: Record<string, string>;
  /** Tile edge in px (the screen picks it from the available width). */
  tileSize: number;
  onOpen: (photoId: string) => void;
  onRetry: (photoId: string) => void;
  onCancel: (photoId: string) => void;
}

/** Local preview or signed thumbnail for a photo item, if any. */
export function photoThumbUri(item: MemoryPhotoItem, thumbUrls: Record<string, string>): string | null {
  const path = item.photo?.status === 'ready' ? item.photo.thumb_path : null;
  if (path && thumbUrls[path]) return thumbUrls[path] ?? null;
  return item.upload?.previewUri ?? null;
}

export function PhotoGrid({ photos, thumbUrls, tileSize, onOpen, onRetry, onCancel }: PhotoGridProps) {
  const t = useTheme();
  return (
    <View style={[styles.grid, { gap: t.spacing.sm }]}>
      {photos.map((item, i) => (
        <PhotoTile
          key={item.id}
          item={item}
          index={i}
          total={photos.length}
          uri={photoThumbUri(item, thumbUrls)}
          size={tileSize}
          onOpen={() => onOpen(item.id)}
          onRetry={() => onRetry(item.id)}
          onCancel={() => onCancel(item.id)}
        />
      ))}
    </View>
  );
}

function PhotoTile({
  item,
  index,
  total,
  uri,
  size,
  onOpen,
  onRetry,
  onCancel,
}: {
  item: MemoryPhotoItem;
  index: number;
  total: number;
  uri: string | null;
  size: number;
  onOpen: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const job = item.upload;
  const failed = job?.state === 'failed';
  const uploading = job?.state === 'uploading';
  const waiting = job?.state === 'queued' || job?.state === 'waiting';
  const statusLabel = failed
    ? tx('upload.failed')
    : uploading
      ? tx('upload.progress', { percent: formatPercent(job?.progress ?? 0) })
      : waiting
        ? job?.waitingFor === 'network'
          ? tx('upload.waitingNetwork')
          : tx('upload.queued')
        : null;
  const openLabel = tx('actions.openPhoto', { index: index + 1, total });

  return (
    <View style={{ width: size, height: size }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={statusLabel ? `${openLabel}. ${statusLabel}` : openLabel}
        onPress={onOpen}
        disabled={!uri && !item.photo}
        style={({ pressed }) => [
          styles.tile,
          {
            width: size,
            height: size,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.bgMuted,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Icon name="image" size={24} color={t.colors.textMuted} />
          </View>
        )}
        <View style={[styles.badge, { top: t.spacing.xs, left: t.spacing.xs }]}>
          <VisibilityBadge visibility={item.visibility} onDark />
        </View>
        {waiting ? (
          <View style={[styles.cornerIcon, { backgroundColor: t.colors.heroGlass, borderRadius: t.radius.pill }]}>
            <Icon name="clock" size={14} color={t.colors.heroChipText} />
          </View>
        ) : null}
        {uploading ? (
          <View style={[styles.progressTrack, { backgroundColor: t.colors.heroGlass }]}>
            <View
              style={{
                width: `${Math.round(Math.max(0.05, Math.min(1, job?.progress ?? 0)) * 100)}%`,
                height: '100%',
                backgroundColor: t.colors.primary,
              }}
            />
          </View>
        ) : null}
      </Pressable>
      {failed ? (
        <View
          style={[styles.failed, { backgroundColor: t.colors.heroScrim, borderRadius: t.radius.md, gap: t.spacing.xs }]}
        >
          <Icon name="alert-triangle" size={18} color={t.colors.heroChipText} />
          <Text
            numberOfLines={2}
            style={[t.typography.small, { color: t.colors.heroChipText, textAlign: 'center' }]}
            accessibilityLiveRegion="polite"
          >
            {tx(memoryErrorKey(job?.error))}
          </Text>
          <View style={[styles.row, { gap: t.spacing.xs }]}>
            <TileAction label={tx('actions.retry')} icon="upload" onPress={onRetry} />
            <TileAction label={tx('actions.cancelUpload')} icon="x" onPress={onCancel} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TileAction({ label, icon, onPress }: { label: string; icon: 'upload' | 'x'; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.tileAction,
        { backgroundColor: pressed ? t.colors.primaryDark : t.colors.primary, borderRadius: t.radius.pill },
      ]}
    >
      <Icon name={icon} size={16} color={t.colors.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute' },
  cornerIcon: { position: 'absolute', right: 6, bottom: 6, padding: 4 },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 6 },
  failed: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 6 },
  row: { flexDirection: 'row' },
  tileAction: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
});
