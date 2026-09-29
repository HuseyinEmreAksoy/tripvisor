/**
 * SharedPageStates — the public share page's non-content states and small
 * chrome pieces (M5 Y3.5), kept out of `app/share/[token].tsx`:
 *   - `SharedTripSkeleton`  loading placeholder in the page's own shape
 *   - `SharedTripStatus`    error / busy (rate limited) / link-not-found
 *   - `ItineraryHiddenCard` "Itinerary hidden by the owner"
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import { Screen } from '../Screen';
import { Skeleton, SkeletonGroup } from '../Skeleton';

const COLUMN_MAX_WIDTH = 720;
const LINK_GONE_ART = require('../../../assets/images/empty-search.png');
const BUSY_ART = require('../../../assets/images/empty-trips.png');

export function SharedTripSkeleton() {
  const t = useTheme();
  const { t: tx } = useT('share');
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={[styles.column, { padding: t.spacing.lg, gap: t.spacing.lg }]}>
        <SkeletonGroup label={tx('page.loading')} style={{ gap: t.spacing.md }}>
          <Skeleton width={96} height={20} />
          <Skeleton width={120} height={12} />
          <Skeleton width="80%" height={34} radius="lg" />
          <Skeleton width="45%" height={16} />
          <View style={[styles.row, { gap: t.spacing.sm }]}>
            <Skeleton width={64} height={26} radius="pill" />
            <Skeleton width={72} height={26} radius="pill" />
            <Skeleton width={80} height={26} radius="pill" />
          </View>
          <Skeleton height={220} radius="xl" />
          <Skeleton height={72} radius="lg" />
          <Skeleton height={72} radius="lg" />
        </SkeletonGroup>
      </ScrollView>
    </Screen>
  );
}

export type SharedTripStatusKind = 'error' | 'busy' | 'notFound';

export function SharedTripStatus({
  kind,
  onRetry,
  onPlanOwn,
}: {
  kind: SharedTripStatusKind;
  onRetry: () => void;
  onPlanOwn: () => void;
}) {
  const { t: tx } = useT('share');
  let content: React.ReactElement;
  if (kind === 'busy') {
    content = (
      <EmptyState
        title={tx('page.busyTitle')}
        body={tx('page.busyBody')}
        illustration={BUSY_ART}
        ctaLabel={tx('page.planOwn')}
        onPress={onPlanOwn}
      />
    );
  } else if (kind === 'notFound') {
    content = (
      <EmptyState
        title={tx('page.notFoundTitle')}
        body={tx('page.notFoundBody')}
        illustration={LINK_GONE_ART}
        ctaLabel={tx('page.planOwn')}
        onPress={onPlanOwn}
      />
    );
  } else {
    content = (
      <EmptyState title={tx('page.errorTitle')} body={tx('page.errorBody')} ctaLabel={tx('page.retry')} onPress={onRetry} />
    );
  }
  return (
    <Screen>
      <View style={styles.centered}>{content}</View>
    </Screen>
  );
}

export function ItineraryHiddenCard() {
  const t = useTheme();
  const { t: tx } = useT('share');
  return (
    <View
      style={[surfaceStyle(t, 'flat'), styles.row, { padding: t.spacing.lg, gap: t.spacing.md, marginHorizontal: t.spacing.lg }]}
      accessible
      accessibilityLabel={tx('a11y.sentence', { title: tx('page.hiddenTitle'), body: tx('page.hiddenBody') })}
    >
      <View style={[styles.badge, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}>
        <Icon name="lock" size={18} color={t.colors.textMuted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('page.hiddenTitle')}</Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{tx('page.hiddenBody')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { maxWidth: COLUMN_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
