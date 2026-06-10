/**
 * TripCard — v2 "Tide & Terracotta" redesign: big rounded card (radius.xl),
 * borderless soft elevation, full-bleed cover treatment.
 *
 * Cover behaviour (Phase 25 Step 25.7): when `trip.cover_photo_google_place_id`
 * is set, a cover hero image fills the top of the card (~150px). The photo is
 * fetched via usePlaceDetails + usePlacePhotoUrl — one place-details call per
 * card (cached 1h). Fallback when no cover is set: a soft gradient-tinted
 * placeholder with the trip's initial letter (decorative).
 *
 * Contract notes (Jest queries by role/label/text — do not change):
 *   - role "link", accessible name `Open trip ${trip.title}`
 *   - date text renders as "📅 " + "YYYY-MM-DD → YYYY-MM-DD"
 *   - meta pill text: `${emoji} ${hours}h / day · ${mode}`
 *   - overflow trigger: role "button", label "Trip actions"
 */
import { useRef, useState, type ComponentProps } from 'react';
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { StatusPill } from './StatusPill';
import { TripActionsSheet } from './TripActionsSheet';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { useReducedMotion } from '@/hooks/useReducedMotion';
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

const COVER_HEIGHT = 150;

// ── CoverHero ────────────────────────────────────────────────────────────────
// Fetches place details (photos field only) then builds the photo URL.
// Documented perf note: one place-details call per card in the list.
// With staleTime=1h, a cold list of 20 cards triggers 20 parallel calls once;
// subsequent renders are instant from cache. Future optimisation: batch fetch
// via a list-level useQueries or prefetch on the trips list screen.
function CoverHero({ placeId, title }: { placeId: string; title: string }) {
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
    // Skeleton while the photo URL resolves.
    return (
      <View
        style={[styles.coverHero, { backgroundColor: t.colors.bgMuted }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }

  if (!url) {
    // No photo returned by Google — fall through to the initial placeholder.
    return <InitialPlaceholder title={title} />;
  }

  return (
    <Image
      source={{ uri: url }}
      style={styles.coverHero}
      resizeMode="cover"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

// ── InitialPlaceholder ───────────────────────────────────────────────────────
// Decorative cover stand-in: teal-tinted wash + the trip's big initial letter.
function InitialPlaceholder({ title }: { title: string }) {
  const t = useTheme();
  const initial = (title.trim().charAt(0) || '✈').toUpperCase();
  return (
    <View
      style={[styles.coverHero, styles.placeholderWrap, { backgroundColor: t.colors.gradientSubtle }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      aria-hidden
    >
      <Text style={[styles.placeholderInitial, { color: t.colors.primary }]}>{initial}</Text>
    </View>
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
  const reducedMotion = useReducedMotion();
  const [sheetOpen, setSheetOpen] = useState(false);
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const isArchived = trip.archived_at != null;
  const hasCover = Boolean(trip.cover_photo_google_place_id);

  // Press animation (skipped under reduced motion)
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn = () => {
    if (reducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };
  const handlePressOut = () => {
    if (reducedMotion) return;
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
              borderRadius: t.radius.xl,
              ...t.shadows.md(t.colors.shadowColor),
            },
            pressed && { ...t.shadows.sm(t.colors.shadowColor) },
            Platform.OS === 'web' && ({
              cursor: 'pointer',
            } as ViewStyle),
          ]}
        >
          {/* Full-bleed cover: photo when set, initial-letter wash otherwise */}
          {hasCover && trip.cover_photo_google_place_id ? (
            <CoverHero placeId={trip.cover_photo_google_place_id} title={trip.title} />
          ) : (
            <InitialPlaceholder title={trip.title} />
          )}

          {/* Content block */}
          <View style={[styles.content, { padding: t.spacing.lg, gap: t.spacing.sm }]}>
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
                    <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
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
                    borderRadius: t.radius.pill,
                  },
                ]}
              >
                <Text style={[t.typography.subtitle, { color: t.colors.textMuted }]}>
                  ⋮
                </Text>
              </Pressable>
            </View>

            {/* Meta row — pill chip language */}
            <View style={styles.metaRow}>
              <View style={[
                styles.metaPill,
                {
                  backgroundColor: t.colors.gradientSubtle,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.md,
                  paddingVertical: 4,
                },
              ]}>
                <Text style={[t.typography.small, { color: t.colors.primary, fontWeight: '700' }]}>
                  {transportEmoji} {trip.daily_hours_budget}h / day · {trip.transport_mode}
                </Text>
              </View>

              {isArchived ? <StatusPill tone="info" label="Archived" /> : null}
            </View>
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
    overflow: 'hidden',
  },
  coverHero: {
    width: '100%',
    height: COVER_HEIGHT,
  },
  placeholderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInitial: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '800',
    opacity: 0.55,
  },
  content: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  overflowTrigger: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginTop: -2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
