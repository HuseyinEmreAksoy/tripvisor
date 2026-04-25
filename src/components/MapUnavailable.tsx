/**
 * MapUnavailable — fallback rendered by Map.web.tsx when EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is absent.
 * Shows a card with a place list grouped by day, using day-color chips consistent with the real map.
 * No Google logo: we are not rendering any Google data (names and coords come from our own DB).
 *
 * Usage:
 *   <MapUnavailable markers={markers} polylines={polylines} />
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { dayColor, DAY_COLORS, type MapViewProps } from './Map/types';

type Props = MapViewProps;

export function MapUnavailable({ markers: maybeMarkers }: Props) {
  const t = useTheme();
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
      accessibilityLabel="Map unavailable — list of places"
    >
      {/* Title */}
      <Text style={[t.typography.subtitle, { color: t.colors.text }]}>
        Map unavailable
      </Text>
      <Text style={[t.typography.body, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}>
        Set{' '}
        <Text style={{ fontFamily: 'monospace', color: t.colors.text }}>
          EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY
        </Text>{' '}
        to view the map — see{' '}
        <Text style={{ fontFamily: 'monospace', color: t.colors.text }}>
          docs/google-maps-setup.md
        </Text>
        . Here's the list of places:
      </Text>

      {markers.length === 0 ? (
        <Text
          style={[
            t.typography.body,
            { color: t.colors.textMuted, marginTop: t.spacing.md, textAlign: 'center' },
          ]}
        >
          No places added yet.
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
                    backgroundColor:
                      dayIndex < 0
                        ? t.colors.bgMuted
                        : `${dayColor(dayIndex)}22`, // 13% opacity hex tint
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
                      color: dayIndex < 0 ? t.colors.textMuted : dayColor(dayIndex),
                      fontWeight: '600',
                    },
                  ]}
                >
                  {dayIndex < 0 ? 'Unscheduled' : `Day ${dayIndex + 1}`}
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
                            dayIndex < 0 ? t.colors.textMuted : '#FFFFFF',
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
