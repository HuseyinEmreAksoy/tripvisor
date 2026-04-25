/**
 * TripCard — Redesigned with glassmorphism, shadows, travel icons, and press animation.
 */
import { useRef, useState, type ComponentProps } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { StatusPill } from './StatusPill';
import { TripActionsSheet } from './TripActionsSheet';
import type { Trip } from '@/api';

export interface TripCardProps {
  trip: Trip;
  onPress: () => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const TRANSPORT_EMOJI: Record<string, string> = {
  driving: '🚗',
  walking: '🚶',
  transit: '🚆',
};

export function TripCard({
  trip,
  onPress,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}: TripCardProps) {
  const t = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const isArchived = trip.archived_at != null;

  // Press animation
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  const handleOverflowPress = (e: Parameters<NonNullable<ComponentProps<typeof Pressable>['onPress']>>[0]) => {
    e?.stopPropagation?.();
    setSheetOpen(true);
  };

  const transportEmoji = TRANSPORT_EMOJI[trip.transport_mode] ?? '🚗';

  return (
    <>
      <Animated.View
        style={[
          { transform: [{ scale: scaleAnim }] },
          Platform.OS === 'web' && ({
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          } as ViewStyle),
        ]}
      >
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open trip ${trip.title}`}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: t.colors.cardBgSolid,
              borderColor: t.colors.border,
              borderRadius: t.radius.xl,
              padding: t.spacing.lg,
              ...t.shadows.md(t.colors.shadowColor),
            },
            pressed && { ...t.shadows.sm(t.colors.shadowColor) },
            Platform.OS === 'web' && ({
              cursor: 'pointer',
            } as ViewStyle),
          ]}
        >
          {/* Top accent gradient bar */}
          <View
            style={[
              styles.accentBar,
              {
                backgroundColor: t.colors.primary,
                borderTopLeftRadius: t.radius.xl,
                borderTopRightRadius: t.radius.xl,
              },
            ]}
          />

          {/* Header row: title + overflow trigger */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[t.typography.subtitle, { color: t.colors.text }]}
                numberOfLines={1}
              >
                {trip.title}
              </Text>
              {dateRange ? (
                <View style={styles.dateRow}>
                  <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
                    📅 {dateRange}
                  </Text>
                </View>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Trip actions"
              onPress={handleOverflowPress}
              hitSlop={8}
              style={({ pressed }) => [
                styles.overflowTrigger,
                {
                  backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                  borderRadius: t.radius.sm,
                },
              ]}
            >
              <Text style={[t.typography.subtitle, { color: t.colors.textMuted }]}>
                ⋮
              </Text>
            </Pressable>
          </View>

          {/* Meta row */}
          <View style={[styles.metaRow, { marginTop: t.spacing.sm }]}>
            <View style={[
              styles.metaPill,
              {
                backgroundColor: t.colors.gradientSubtle,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 3,
              },
            ]}>
              <Text style={[t.typography.small, { color: t.colors.primary }]}>
                {transportEmoji} {trip.daily_hours_budget}h / day · {trip.transport_mode}
              </Text>
            </View>

            {isArchived ? <StatusPill tone="info" label="Archived" /> : null}
          </View>
        </Pressable>
      </Animated.View>

      <TripActionsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        trip={trip}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </>
  );
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} → ${end}`;
  return start ?? end;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  overflowTrigger: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginTop: -2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
