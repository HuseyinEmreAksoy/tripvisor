/**
 * MapUnavailable — fallback rendered when a map key is absent: Map.web.tsx (Google
 * provider without EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY) and Map.native.tsx (Android
 * build without GOOGLE_MAPS_ANDROID_KEY). `keyName` tailors the hint.
 * Shows a card with a place list grouped by day, using day-color chips consistent with the real map.
 * No Google logo: we are not rendering any Google data (names and coords come from our own DB).
 *
 * Usage:
 *   <MapUnavailable markers={markers} polylines={polylines} />
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ON_DAY_COLOR, dayColor, dayTint, useTheme } from '@/theme';
import { Trans, useT } from '@/i18n';
import type { MapViewProps } from './Map/types';

type Props = MapViewProps & {
  /** Env var the hint tells the developer to set. Default: the web key. */
  keyName?: string;
};

export function MapUnavailable({
  markers: maybeMarkers,
  keyName = 'EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY',
}: Props) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  // Defensive: tolerate transient undefined during data hydration.
  const markers = maybeMarkers ?? [];

  // Group markers by dayIndex (null/-1 → unscheduled bucket)
  const groups: Map<number, typeof markers> = new Map();
  for (const m of markers) {
    const key = m.dayIndex ?? -1;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  // Sort entries: unscheduled last, rest ascending by dayIndex
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    if (a < 0) return 1;
    if (b < 0) return -1;
    return a - b;
  });

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          backgroundColor: t.colors.bgElevated,
          margin: t.spacing.lg,
          padding: t.spacing.lg,
        },
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={tx('mapUnavailable.a11y')}
    >
      {/* Title */}
      <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
        {tx('mapUnavailable.title')}
      </Text>
      <Text style={[t.typography.body, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}>
        <Trans
          t={tx}
          i18nKey="mapUnavailable.hint"
          values={{ keyName, doc: 'docs/google-maps-setup.md' }}
          components={{ code: <Text style={{ fontFamily: 'monospace', color: t.colors.text }} /> }}
        />
      </Text>

      {markers.length === 0 ? (
        <Text
          style={[
            t.typography.body,
            { color: t.colors.textMuted, marginTop: t.spacing.md, textAlign: 'center' },
          ]}
        >
          {tx('mapUnavailable.empty')}
        </Text>
      ) : (
        <ScrollView
          style={{ marginTop: t.spacing.md }}
          contentContainerStyle={{ gap: t.spacing.sm }}
          scrollEnabled={sorted.length > 4}
        >
          {sorted.map(([dayIndex, pins]) => (
            <View key={`day-${dayIndex}`} style={{ gap: t.spacing.xs }}>
              {/* Day header chip */}
              <View
                style={[
                  styles.dayChip,
                  {
                    // Y2.4: the theme day tint (was a raw hex-alpha suffix).
                    backgroundColor: dayIndex < 0 ? t.colors.bgMuted : dayTint(dayIndex, t.name),
                    borderColor: dayIndex < 0 ? t.colors.border : dayColor(dayIndex),
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: t.spacing.xs,
                    alignSelf: 'flex-start',
                  },
                ]}
                accessibilityRole="header"
                aria-level={3}
              >
                <Text
                  style={[
                    t.typography.caption,
                    {
                      // Day colours are never text colours (AA): the chip's
                      // border + tint carry the day; the label stays ink.
                      color: dayIndex < 0 ? t.colors.textMuted : t.colors.text,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {dayIndex < 0 ? tx('mapUnavailable.unscheduled') : tx('dayLabel', { day: dayIndex + 1 })}
                </Text>
              </View>

              {/* Place rows */}
              {pins.map((pin) => (
                <View
                  key={pin.id}
                  style={[
                    styles.placeRow,
                    {
                      borderColor: t.colors.border,
                      borderRadius: t.radius.md,
                      backgroundColor: t.colors.bg,
                      paddingHorizontal: t.spacing.md,
                      paddingVertical: t.spacing.sm,
                    },
                  ]}
                >
                  {/* Order badge */}
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: dayIndex < 0 ? t.colors.bgMuted : dayColor(dayIndex),
                        borderRadius: t.radius.pill,
                        width: 22,
                        height: 22,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        t.typography.small,
                        {
                          color:
                            dayIndex < 0 ? t.colors.textMuted : ON_DAY_COLOR,
                          fontWeight: '700',
                          textAlign: 'center',
                        },
                      ]}
                    >
                      {pin.orderInDay != null ? pin.orderInDay + 1 : '·'}
                    </Text>
                  </View>

                  <Text
                    style={[t.typography.body, { color: t.colors.text, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {pin.title}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  dayChip: { borderWidth: 1 },
  placeRow: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
