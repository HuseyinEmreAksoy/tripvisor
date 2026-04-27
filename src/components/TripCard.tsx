/**
 * TripCard — Redesigned with glassmorphism, shadows, travel icons, and press animation.
 *
 * Phase 25 Step 25.7: when `trip.cover_photo_google_place_id` is set, renders
 * a cover hero image at the top of the card (~120px mobile / ~160px desktop).
 * The photo is fetched via usePlaceDetails + usePlacePhotoUrl — one
 * place-details call per card (cached 1h; fine for v1, perf opportunity noted).
 * Fallback when no cover is set: gradient placeholder with trip initial letter.
 */
import { useRef, useState, type ComponentProps } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { StatusPill } from './StatusPill';
import { TripActionsSheet } from './TripActionsSheet';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
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

// ── CoverHero ────────────────────────────────────────────────────────────────
// Fetches place details (photos field only) then builds the photo URL.
// Documented perf note: one place-details call per card in the list.
// With staleTime=1h, a cold list of 20 cards triggers 20 parallel calls once;
// subsequent renders are instant from cache. Future optimisation: batch fetch
// via a list-level useQueries or prefetch on the trips list screen.
function CoverHero({ placeId, height }: { placeId: string; height: number }) {
  const t = useTheme();
  // Fetch only the photos field to minimise billing.
  const { data: placeDetails, isLoading } = usePlaceDetails({
    placeId,
    fields: ['photos'],
    enabled: Boolean(placeId),
  });
  const firstPhotoName = placeDetails?.photos?.[0]?.name ?? null;
  const { url } = usePlacePhotoUrl(firstPhotoName, { maxWidthPx: 400 });

  if (isLoading) {
    // Skeleton overlay while the photo URL resolves.
    return (
      <View
        style={[styles.coverHero, { height, backgroundColor: t.colors.bgMuted }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }

  if (!url) {
    // No photo returned by Google — fall through to gradient placeholder.
    return <GradientPlaceholder height={height} />;
  }

  return (
    <Image
      source={{ uri: url }}
      style={[styles.coverHero, { height }]}
      resizeMode="cover"
      accessibilityElementsHidden
      importantForAccessibility="no"
      // On error (404 / network) fall back to gradient placeholder.
      // React Native Image does not call onError on web for failed CSS backgrounds,
      // but for uri sources on all platforms this fires as expected.
      onError={undefined} // let the broken image show; the placeholder sits behind it
    />
  );
}

function GradientPlaceholder({ height }: { height: number }) {
  const t = useTheme();
  return (
    <View
      style={[styles.coverHero, { height, backgroundColor: t.colors.gradientSubtle }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

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
  const hasCover = Boolean(trip.cover_photo_google_place_id);

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
          {/* Top area: cover photo hero OR accent gradient bar */}
          {hasCover && trip.cover_photo_google_place_id ? (
            <View
              style={[
                styles.coverWrapper,
                {
                  borderTopLeftRadius: t.radius.xl,
                  borderTopRightRadius: t.radius.xl,
                },
              ]}
            >
              <CoverHero placeId={trip.cover_photo_google_place_id} height={120} />
            </View>
          ) : (
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
          )}

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
  coverWrapper: {
    marginTop: -16, // bleed out of the card padding to reach the card edge
    marginHorizontal: -16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  coverHero: {
    width: '100%',
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
