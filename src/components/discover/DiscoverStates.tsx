/**
 * Discover states (M5 Y3.4): the "searching nearby…" skeleton (the first
 * search in an area takes 4–8 s), soft banners (degraded results, errors,
 * offline) and the attribution footer that every result list shows.
 */
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon, type IconName } from '@/components/Icon';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import type { RecommendationsResponse } from '@/api/recommendations';
import { safeHttpUrl } from './discoverModel';

/** After this long the skeleton explains that a first search is slow. */
export const SLOW_SEARCH_MS = 3000;

export function DiscoverSkeleton({ count = 4 }: { count?: number }) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_SEARCH_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={[styles.row, { gap: t.spacing.sm }]} accessibilityLiveRegion="polite" aria-live="polite">
        <Icon name="compass" size={18} color={t.colors.primaryInk} />
        <View style={{ flex: 1 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{tx('searching')}</Text>
          {slow ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('searchingSlow')}</Text>
          ) : null}
        </View>
      </View>
      <SkeletonGroup label={tx('loadingA11y')} style={{ gap: t.spacing.md }}>
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={[surfaceStyle(t, 'raised'), styles.row, { padding: t.spacing.md, gap: t.spacing.md }]}
          >
            <Skeleton width={72} height={72} radius="md" />
            <View style={{ flex: 1, gap: t.spacing.sm }}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="40%" height={12} />
              <Skeleton width="90%" height={12} />
            </View>
          </View>
        ))}
      </SkeletonGroup>
    </View>
  );
}

export type BannerTone = 'info' | 'warning' | 'danger';

export function DiscoverBanner({
  tone,
  message,
  actionLabel,
  onAction,
}: {
  tone: BannerTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  const palette: Record<BannerTone, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: t.colors.infoLight, fg: t.colors.text, icon: 'globe' },
    warning: { bg: t.colors.warningLight, fg: t.colors.warningText, icon: 'alert-triangle' },
    danger: { bg: t.colors.dangerLight, fg: t.colors.dangerText, icon: 'alert-triangle' },
  };
  const p = palette[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: p.bg, borderRadius: t.radius.lg, padding: t.spacing.md, gap: t.spacing.sm }]}
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      aria-live="polite"
    >
      <Icon name={p.icon} size={18} color={p.fg} />
      <Text style={[t.typography.small, styles.bannerText, { color: p.fg }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => [styles.bannerAction, { paddingHorizontal: t.spacing.sm }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[t.typography.small, { color: p.fg, fontWeight: '700', textDecorationLine: 'underline' }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "© OpenStreetMap contributors" (always) + the Wikipedia licence when any card uses it. */
export function DiscoverAttribution({ attribution }: { attribution: RecommendationsResponse['attribution'] }) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const osmUrl = safeHttpUrl(attribution.osmUrl);
  const wikiUrl = safeHttpUrl(attribution.wikipediaUrl);
  return (
    <View style={[styles.attrib, { gap: t.spacing.xs, paddingVertical: t.spacing.md }]} testID="discover-attribution">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={tx('attribution.osmA11y', { text: attribution.osm })}
        disabled={!osmUrl}
        onPress={() => osmUrl && void Linking.openURL(osmUrl)}
        hitSlop={8}
      >
        <Text style={[t.typography.small, { color: t.colors.attribution, textDecorationLine: 'underline' }]}>
          {attribution.osm}
        </Text>
      </Pressable>
      {attribution.wikipedia ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={tx('attribution.wikiA11y')}
          disabled={!wikiUrl}
          onPress={() => wikiUrl && void Linking.openURL(wikiUrl)}
          hitSlop={8}
        >
          <Text style={[t.typography.small, { color: t.colors.attribution, textDecorationLine: 'underline' }]}>
            {tx('attribution.wiki')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  bannerText: { flex: 1, minWidth: 160 },
  bannerAction: { minHeight: 44, justifyContent: 'center' },
  attrib: { alignItems: 'center' },
});
