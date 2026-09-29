/**
 * DiscoverCard — one recommendation (M5 Y3.4): Wikipedia thumbnail (or an
 * interest tile), name, local name, distance, matched interests and the
 * Wikipedia extract. Cards with Wikipedia text link the article and show the
 * CC BY-SA note (ADR-0013). No Google data here: the rating is fetched only
 * when the card is opened (RecDetailSheet).
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { surfaceStyle, useTheme } from '@/theme';
import { formatDistance, useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import type { PoiItem } from '@/api/recommendations';
import { INTEREST_ICONS, interestLabelKey, safeHttpUrl } from './discoverModel';

export interface DiscoverCardProps {
  item: PoiItem;
  onOpen: (item: PoiItem) => void;
  /** Compact phone layout (smaller thumbnail). */
  compact?: boolean;
}

export function DiscoverCard({ item, onOpen, compact }: DiscoverCardProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const distance = formatDistance(item.distanceM);
  const wikiUrl = safeHttpUrl(item.wiki?.url);
  const thumb = safeHttpUrl(item.wiki?.thumbUrl);
  const extract = item.wiki?.extract ?? item.wiki?.description ?? null;
  const primary = item.interests[0];
  const size = compact ? 72 : 96;

  return (
    <View style={[surfaceStyle(t, 'raised'), styles.card, { padding: t.spacing.md, gap: t.spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tx('card.openA11y', { name: item.name, distance })}
        onPress={() => onOpen(item)}
        style={({ pressed }) => [styles.row, { gap: t.spacing.md }, pressed && { opacity: 0.85 }]}
      >
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={{ width: size, height: size, borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted }}
            contentFit="cover"
            transition={150}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
          />
        ) : (
          <View
            style={[
              styles.tile,
              { width: size, height: size, borderRadius: t.radius.md, backgroundColor: t.colors.gradientSubtle },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Icon name={primary ? INTEREST_ICONS[primary] : 'compass'} size={28} color={t.colors.primaryInk} />
          </View>
        )}
        <View style={[styles.body, { gap: 2 }]}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          {item.originalName && item.originalName !== item.name ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]} numberOfLines={1}>
              {tx('card.localName', { name: item.originalName })}
            </Text>
          ) : null}
          <View style={[styles.metaRow, { gap: t.spacing.xs }]}>
            <Icon name="map-pin" size={14} color={t.colors.textMuted} />
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {tx('distanceAway', { distance })}
            </Text>
          </View>
          {item.interests.length > 0 ? (
            <View style={[styles.tags, { gap: t.spacing.xs, marginTop: 2 }]}>
              {item.interests.slice(0, 3).map((i) => (
                <View
                  key={i}
                  style={[
                    styles.tag,
                    { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill, paddingHorizontal: t.spacing.sm },
                  ]}
                >
                  <Text style={[t.typography.small, { color: t.colors.text }]}>{tx(interestLabelKey(i))}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <Icon name="chevron-right" size={20} color={t.colors.textMuted} />
      </Pressable>

      {extract ? (
        <Text style={[t.typography.small, { color: t.colors.text }]} numberOfLines={compact ? 3 : 4}>
          {extract}
        </Text>
      ) : null}

      {wikiUrl ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={tx('wiki.readMoreA11y', { name: item.name })}
          onPress={() => void Linking.openURL(wikiUrl)}
          hitSlop={8}
          style={({ pressed }) => [styles.metaRow, styles.link, { gap: t.spacing.xs }, pressed && { opacity: 0.6 }]}
        >
          <Icon name="external-link" size={14} color={t.colors.primaryInk} />
          <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '600' }]}>
            {tx('wiki.readMore')}
          </Text>
          <Text style={[t.typography.small, { color: t.colors.attribution }]}>· {tx('wiki.source')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: { paddingVertical: 2 },
  link: { minHeight: 32 },
});
