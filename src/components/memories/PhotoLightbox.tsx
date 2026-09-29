/**
 * PhotoLightbox — full-screen memory photo viewer (M5 Y3.1).
 *
 * Loads the FULL image (storage_path, 1 h signed URL) and shows the
 * thumbnail / local preview underneath until it arrives. Prev / next
 * buttons (44 px), Escape / back closes (Modal onRequestClose). Own photos:
 * the "Share with trip" switch and Delete (tombstone + undo toast). Trip
 * owner on someone else's SHARED photo: Remove from trip (moderation).
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { useT, formatDateTime } from '@/i18n';
import { useTheme } from '@/theme';
import { useMemoryPhotoUrl } from '@/api/memories';
import type { MemoryPhotoItem, MemoryVisibility } from '@/api/memories.types';
import { VisibilityToggle } from './VisibilityToggle';
import { photoThumbUri } from './PhotoGrid';

export interface PhotoLightboxProps {
  photos: readonly MemoryPhotoItem[];
  /** Open photo id; null = closed. */
  photoId: string | null;
  thumbUrls: Record<string, string>;
  onChangePhoto: (photoId: string) => void;
  onClose: () => void;
  /** Trip owner: may remove others' SHARED photos. */
  isOwner: boolean;
  onSetVisibility: (item: MemoryPhotoItem, next: MemoryVisibility) => void;
  onDelete: (item: MemoryPhotoItem) => void;
  onRemove: (item: MemoryPhotoItem) => void;
}

export function PhotoLightbox({
  photos,
  photoId,
  thumbUrls,
  onChangePhoto,
  onClose,
  isOwner,
  onSetVisibility,
  onDelete,
  onRemove,
}: PhotoLightboxProps) {
  const index = photoId ? photos.findIndex((p) => p.id === photoId) : -1;
  const item = index >= 0 ? photos[index] : undefined;
  return (
    <Modal visible={Boolean(item)} transparent animationType="fade" onRequestClose={onClose}>
      {item ? (
        <LightboxBody
          key={item.id}
          item={item}
          index={index}
          total={photos.length}
          thumbUri={photoThumbUri(item, thumbUrls)}
          onPrev={index > 0 ? () => onChangePhoto(photos[index - 1]!.id) : undefined}
          onNext={index < photos.length - 1 ? () => onChangePhoto(photos[index + 1]!.id) : undefined}
          onClose={onClose}
          isOwner={isOwner}
          onSetVisibility={onSetVisibility}
          onDelete={onDelete}
          onRemove={onRemove}
        />
      ) : null}
    </Modal>
  );
}

function LightboxBody({
  item,
  index,
  total,
  thumbUri,
  onPrev,
  onNext,
  onClose,
  isOwner,
  onSetVisibility,
  onDelete,
  onRemove,
}: {
  item: MemoryPhotoItem;
  index: number;
  total: number;
  thumbUri: string | null;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  isOwner: boolean;
  onSetVisibility: PhotoLightboxProps['onSetVisibility'];
  onDelete: PhotoLightboxProps['onDelete'];
  onRemove: PhotoLightboxProps['onRemove'];
}) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const insets = useSafeAreaInsets();
  const ready = item.photo?.status === 'ready';
  const { url: fullUrl, isLoading } = useMemoryPhotoUrl(ready ? item.photo?.storage_path : null);
  const [fullFailed, setFullFailed] = useState(false);
  const uri = (!fullFailed && fullUrl) || thumbUri;
  const takenAt = item.photo?.taken_at ?? item.upload?.takenAt ?? null;
  const caption = item.photo?.caption ?? item.upload?.caption ?? null;
  const canModerate = isOwner && !item.isOwn && item.visibility === 'trip' && Boolean(item.photo);
  const fg = t.colors.heroChipText;

  return (
    <View
      style={[styles.root, { backgroundColor: t.colors.heroScrim, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
      aria-label={tx('lightbox.label')}
    >
      <View style={[styles.topBar, { padding: t.spacing.md, gap: t.spacing.sm }]}>
        <Text style={[t.typography.caption, { color: fg, flex: 1 }]} accessibilityLiveRegion="polite">
          {tx('lightbox.position', { index: index + 1, total })}
        </Text>
        <RoundButton icon="x" label={tx('actions.close')} onPress={onClose} />
      </View>

      <View style={styles.stage}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            transition={150}
            accessibilityLabel={caption ?? tx('lightbox.photoAlt', { index: index + 1 })}
            onError={() => setFullFailed(true)}
          />
        ) : (
          <Text style={[t.typography.body, { color: fg }]}>{tx('lightbox.failed')}</Text>
        )}
        {isLoading && !fullUrl ? (
          <ActivityIndicator style={styles.spinner} color={fg} accessibilityLabel={tx('lightbox.loading')} />
        ) : null}
        <View style={[styles.navRow, { paddingHorizontal: t.spacing.sm }]} pointerEvents="box-none">
          {onPrev ? <RoundButton icon="chevron-left" label={tx('actions.previous')} onPress={onPrev} /> : <View />}
          {onNext ? <RoundButton icon="chevron-right" label={tx('actions.next')} onPress={onNext} /> : <View />}
        </View>
      </View>

      <View style={[styles.bottom, { padding: t.spacing.lg, gap: t.spacing.sm }]}>
        {caption ? <Text style={[t.typography.body, { color: fg }]}>{caption}</Text> : null}
        {takenAt ? (
          <Text style={[t.typography.small, { color: fg }]}>
            {tx('lightbox.takenAt', { date: formatDateTime(takenAt) })}
          </Text>
        ) : null}
        {item.isOwn ? (
          <View style={[styles.panel, { backgroundColor: t.colors.bg, borderRadius: t.radius.lg, padding: t.spacing.md, gap: t.spacing.sm }]}>
            <VisibilityToggle
              visibility={item.visibility}
              onChange={(next) => onSetVisibility(item, next)}
              itemLabel={tx('items.photo')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tx('actions.deletePhoto')}
              onPress={() => onDelete(item)}
              style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1, gap: t.spacing.xs }]}
            >
              <Icon name="trash" size={18} color={t.colors.dangerText} />
              <Text style={[t.typography.bodyStrong, { color: t.colors.dangerText }]}>{tx('actions.delete')}</Text>
            </Pressable>
          </View>
        ) : canModerate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx('actions.removeFromTrip')}
            onPress={() => onRemove(item)}
            style={({ pressed }) => [
              styles.textAction,
              { backgroundColor: t.colors.bg, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.lg, opacity: pressed ? 0.7 : 1, gap: t.spacing.xs },
            ]}
          >
            <Icon name="trash" size={18} color={t.colors.dangerText} />
            <Text style={[t.typography.bodyStrong, { color: t.colors.dangerText }]}>{tx('actions.removeFromTrip')}</Text>
          </Pressable>
        ) : (
          <Text style={[t.typography.small, { color: fg }]}>{tx('by.tripmate')}</Text>
        )}
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: t.colors.heroGlass, borderRadius: t.radius.pill, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} size={22} color={t.colors.heroChipText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { position: 'absolute' },
  navRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottom: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  panel: {},
  textAction: { flexDirection: 'row', alignItems: 'center', minHeight: 44, alignSelf: 'flex-start' },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
