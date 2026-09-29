/**
 * SharedPhotoLightbox — full-screen viewer for the public page's memory
 * photos (M5 Y3.5). Shows the thumbnail at once and swaps in the FULL image
 * from `useSharedPhotoUrl(token, photo.id)` — one rate-limited request per
 * photo actually opened (never per grid tile). Over the cap
 * (`rate_limited` / `rate_limit_unavailable`) or on any failure it keeps the
 * preview and says so.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useOptionalSafeAreaInsets } from '@/hooks/useOptionalSafeAreaInsets';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { ShareLinkError, useSharedPhotoUrl, type SharedMemoryPhoto } from '@/api/share';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Icon, type IconName } from '../Icon';

interface Props {
  token: string;
  photos: readonly SharedMemoryPhoto[];
  /** Open photo index, or null when closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

export function isShareBusyError(err: unknown): boolean {
  return err instanceof ShareLinkError && (err.code === 'rate_limited' || err.code === 'rate_limit_unavailable');
}

export function SharedPhotoLightbox({ token, photos, index, onIndexChange }: Props) {
  const reducedMotion = useReducedMotion();
  const photo = index != null ? photos[index] : undefined;
  return (
    <Modal
      visible={Boolean(photo)}
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={() => onIndexChange(null)}
      statusBarTranslucent
    >
      {photo && index != null ? (
        <LightboxBody token={token} photo={photo} index={index} total={photos.length} onIndexChange={onIndexChange} />
      ) : null}
    </Modal>
  );
}

function LightboxBody({
  token,
  photo,
  index,
  total,
  onIndexChange,
}: {
  token: string;
  photo: SharedMemoryPhoto;
  index: number;
  total: number;
  onIndexChange: (index: number | null) => void;
}) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const insets = useOptionalSafeAreaInsets();
  const full = useSharedPhotoUrl(token, photo.id);

  let status: string | null = null;
  if (full.isError) status = isShareBusyError(full.error) ? tx('memories.lightbox.busy') : tx('memories.lightbox.failed');
  else if (full.isLoading) status = tx('memories.lightbox.loading');

  const onText = t.colors.heroChipText;
  return (
    <View
      style={[styles.backdrop, { backgroundColor: t.colors.heroScrim, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
      accessibilityLabel={tx('memories.lightbox.a11y', { n: index + 1, total })}
    >
      <View style={[styles.bar, { padding: t.spacing.md, gap: t.spacing.sm }]}>
        <Text style={[t.typography.caption, { color: onText, flex: 1, fontWeight: '600' }]}>
          {tx('memories.lightbox.a11y', { n: index + 1, total })}
        </Text>
        <GlassButton icon="x" label={tx('memories.lightbox.close')} onPress={() => onIndexChange(null)} />
      </View>

      <View style={styles.stage}>
        <Image
          key={photo.id}
          source={{ uri: full.data?.url ?? photo.thumbUrl }}
          placeholder={{ uri: photo.thumbUrl }}
          contentFit="contain"
          transition={150}
          style={styles.image}
          accessibilityLabel={photo.caption ?? tx('memories.lightbox.a11y', { n: index + 1, total })}
        />
        {index > 0 ? (
          <View style={[styles.side, styles.left, { paddingLeft: t.spacing.sm }]}>
            <GlassButton icon="chevron-left" label={tx('memories.lightbox.prev')} onPress={() => onIndexChange(index - 1)} />
          </View>
        ) : null}
        {index < total - 1 ? (
          <View style={[styles.side, styles.right, { paddingRight: t.spacing.sm }]}>
            <GlassButton icon="chevron-right" label={tx('memories.lightbox.next')} onPress={() => onIndexChange(index + 1)} />
          </View>
        ) : null}
      </View>

      <View style={{ padding: t.spacing.lg, gap: t.spacing.xs, alignItems: 'center' }}>
        {photo.caption ? (
          <Text style={[t.typography.body, { color: onText, textAlign: 'center' }]} numberOfLines={3}>
            {photo.caption}
          </Text>
        ) : null}
        {status ? (
          <Text style={[t.typography.small, { color: onText, textAlign: 'center' }]} accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function GlassButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.glass,
        { backgroundColor: t.colors.heroGlass, borderRadius: t.radius.pill, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Icon name={icon} size={22} color={t.colors.heroChipText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  stage: { flex: 1, justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  side: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  left: { left: 0 },
  right: { right: 0 },
  glass: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
