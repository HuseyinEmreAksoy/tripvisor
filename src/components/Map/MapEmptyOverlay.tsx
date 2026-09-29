/**
 * MapEmptyOverlay — subtle card floated over an empty trip map (zero places)
 * so the user sees a hint instead of a bare world map. Shared (no platform
 * code); callers (MapTab, share page) render it as a sibling after the map.
 * `pointerEvents="box-none"` keeps the map pannable around the card.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';

export interface MapEmptyOverlayProps {
  title?: string;
  body?: string;
  /** 'bottom' keeps the card clear of controls floated at the map's top. */
  placement?: 'center' | 'bottom';
}

export function MapEmptyOverlay({
  title = 'Add places to see your route',
  body = 'Stops and the route between them will appear here.',
  placement = 'center',
}: MapEmptyOverlayProps) {
  const t = useTheme();
  return (
    <View
      style={[styles.fill, placement === 'bottom' && { justifyContent: 'flex-end', paddingBottom: 48 }]}
      pointerEvents="box-none"
    >
      <View
        accessible
        accessibilityLabel={`${title}. ${body}`}
        style={[
          styles.card,
          {
            backgroundColor: t.colors.cardBgSolid,
            borderRadius: t.radius.lg,
            borderColor: t.colors.border,
            padding: t.spacing.lg,
            gap: t.spacing.xs,
            ...t.shadows.md(t.colors.shadowColor),
          },
        ]}
      >
        <Icon name="route" size={22} color={t.colors.primary} />
        <Text style={[t.typography.bodyStrong, { color: t.colors.text, textAlign: 'center' }]}>
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    alignItems: 'center',
    maxWidth: 320,
    borderWidth: 1,
  },
});
