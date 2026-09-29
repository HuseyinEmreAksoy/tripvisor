/**
 * Trip hub cards for M5 Y3.1:
 *   MemoriesHubCard — counts + the latest photo's thumbnail → /trip/[id]/memories.
 *   DiscoverHubCard — → /trip/[id]/discover (the Y3.4 screen).
 */
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useMemoryPhotoUrl, useTripMemories } from '@/api/memories';
import { HubCard } from '@/components/trip-detail/TripHubCards';

export function MemoriesHubCard({ tripId }: { tripId: string }) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const router = useRouter();
  const { data } = useTripMemories(tripId);
  const { url } = useMemoryPhotoUrl(data?.latestPhoto?.thumb_path ?? null);
  const c = data?.counts;
  const total = c ? c.photos + c.journal + c.reviews : 0;
  const summary =
    c && total > 0
      ? [
          c.photos > 0 ? tx('counts.photos', { count: c.photos }) : null,
          c.journal > 0 ? tx('counts.journal', { count: c.journal }) : null,
          c.reviews > 0 ? tx('counts.reviews', { count: c.reviews }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : tx('hub.empty');
  return (
    <HubCard
      icon="camera"
      title={tx('title')}
      summary={summary}
      accessibilityLabel={tx('hub.a11y', { summary })}
      onPress={() => router.push(`/trip/${tripId}/memories` as Href)}
      media={
        url ? (
          <View style={[styles.thumb, { borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted }]}>
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
          </View>
        ) : undefined
      }
    />
  );
}

export function DiscoverHubCard({ tripId }: { tripId: string }) {
  const { t: tx } = useT('memories');
  const router = useRouter();
  return (
    <HubCard
      icon="compass"
      title={tx('hub.discoverTitle')}
      summary={tx('hub.discoverSummary')}
      onPress={() => router.push(`/trip/${tripId}/discover` as Href)}
    />
  );
}

const styles = StyleSheet.create({
  thumb: { width: 40, height: 40, overflow: 'hidden' },
});
