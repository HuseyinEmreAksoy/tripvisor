/**
 * ItinerarySkeleton — loading placeholder for the itinerary (v2 M4 X2.3):
 * a day header plus a few place-row shapes, announced once as
 * "Loading itinerary" (SkeletonGroup) and reduced-motion aware (Skeleton).
 */
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';

export function ItinerarySkeleton({ rows = 3 }: { rows?: number }) {
  const t = useTheme();
  return (
    <SkeletonGroup label="Loading itinerary" style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
        {[64, 88, 88, 88].map((w, i) => (
          <Skeleton key={i} width={w} height={32} radius="pill" />
        ))}
      </View>
      <Skeleton width="40%" height={20} />
      <Skeleton height={40} radius="lg" />
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            gap: t.spacing.md,
            padding: t.spacing.md,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.cardBgSolid,
          }}
        >
          <Skeleton width={44} height={44} radius="md" />
          <View style={{ flex: 1, gap: t.spacing.xs }}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="45%" height={12} />
            <Skeleton width={96} height={20} radius="pill" />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}
