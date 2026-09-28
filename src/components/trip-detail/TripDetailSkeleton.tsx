/**
 * Trip detail skeletons (v2 M4 X2.2): the whole-screen placeholder while the
 * trip row loads, and the Plan-tab placeholder while its places load.
 * Reduced-motion aware via Skeleton; announced once via SkeletonGroup.
 */
import { View } from 'react-native';
import { Skeleton, SkeletonGroup } from '@/components';
import { useTheme } from '@/theme';

/** Whole-screen placeholder while the trip row loads. */
export function TripDetailSkeleton() {
  const t = useTheme();
  return (
    <SkeletonGroup label="Loading trip" style={{ flex: 1 }}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm, backgroundColor: t.colors.gradientSubtle }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Skeleton width={80} height={36} radius="pill" />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="70%" height={20} />
            <Skeleton width="40%" height={14} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Skeleton width={90} height={26} radius="pill" />
          <Skeleton width={70} height={26} radius="pill" />
          <Skeleton width={70} height={26} radius="pill" />
        </View>
      </View>
      <View style={{ padding: t.spacing.lg }}>
        <Skeleton height={40} radius="pill" />
      </View>
      <PlanSkeletonRows />
    </SkeletonGroup>
  );
}

/** Plan-tab placeholder while places load (the trip row is already here). */
export function PlanSkeleton() {
  return (
    <SkeletonGroup label="Loading places">
      <PlanSkeletonRows />
    </SkeletonGroup>
  );
}

function PlanSkeletonRows() {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}>
      <Skeleton width="35%" height={18} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
          <Skeleton width={28} height={28} radius="pill" />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="80%" height={16} />
            <Skeleton width="50%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
