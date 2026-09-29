/**
 * TripCard — the trips-list card: cover image on top, a light body below.
 *
 * Cover (Phase 25 Step 25.7, M5 Y2.4): `TripCover` shows the Google cover
 * when `trip.cover_photo_google_place_id` is set (one photos-only
 * place-details call per card, cached 1 h), else the bundled generated cover
 * picked from the trip id. Y2.4 fixed the web overflow that let the
 * fallback image spill over the body (dark text on a photo, unreadable in
 * light mode) and added the trip status chip ("Day 2 of 4" / "In 12 days"
 * / "Relive") on the cover.
 *
 * Contract notes (Jest queries by role/label — keep stable):
 *   - role "link", accessible name = trip:card.open (`Open trip ${title}`)
 *   - overflow trigger: role "button", label = trip:card.actions. It is a
 *     SIBLING of the link (absolutely positioned over the body), never a
 *     child: iOS collapses an accessible Pressable into one VoiceOver element
 *     and web would nest a button inside role=link. The link also exposes an
 *     "actions" accessibility action that opens the same sheet.
 */
import { useRef, useState, type ComponentProps } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';
import { formatDateRange, useT } from '@/i18n';
import { StatusPill } from './StatusPill';
import { Icon } from './Icon';
import { TripActionsSheet } from './TripActionsSheet';
import { TripCover } from './TripCover';
import { TripStatusChip } from './TripStatusChip';
import { tripPhase } from './tripStatus';
import { transportIcon, transportKey } from './transportModes';
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

const COVER_HEIGHT = 148;

export function TripCard({
  trip,
  onPress,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}: TripCardProps) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  const reducedMotion = useReducedMotion();
  const [sheetOpen, setSheetOpen] = useState(false);
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const isArchived = trip.archived_at != null;
  const phase = tripPhase(trip.start_date, trip.end_date);

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

  const modeIcon = transportIcon(trip.transport_mode);
  const modeLabel = tx(transportKey(trip.transport_mode));

  return (
    <>
      {/* The shadow lives on the outer view and the clip on the inner one:
          iOS drops a shadow on a view that clips its own bounds. */}
      <Animated.View
        style={[
          surfaceStyle(t, 'raised'),
          { borderRadius: t.radius.xl, transform: [{ scale: scaleAnim }] },
          Platform.OS === 'web' && ({
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          } as ViewStyle),
        ]}
      >
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={tx('card.open', { title: trip.title })}
          accessibilityActions={[{ name: 'actions', label: tx('card.actions') }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'actions') setSheetOpen(true);
          }}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [
            styles.card,
            { borderRadius: t.radius.xl },
            pressed && { backgroundColor: t.colors.bgMuted },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          <TripCover
            tripId={trip.id}
            coverPlaceId={trip.cover_photo_google_place_id}
            photoWidth={400}
            scrim="soft"
            fallbackTestID="trip-card-fallback-cover"
            style={{ height: COVER_HEIGHT }}
          >
            {!isArchived ? (
              <View style={[styles.coverChip, { top: t.spacing.md, left: t.spacing.md }]}>
                <TripStatusChip phase={phase} tone="onImage" />
              </View>
            ) : null}
          </TripCover>

          <View style={{ padding: t.layout.cardPadding, gap: t.spacing.sm }}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text style={[t.typography.subtitle, { color: t.colors.text }]} numberOfLines={1}>
                  {trip.title}
                </Text>
                {/* Always one date line (even "No dates set") so cards in a
                    desktop grid row line up. */}
                <View style={styles.dateRow}>
                  <Icon name="calendar" size={13} color={t.colors.textMuted} />
                  <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
                    {dateRange ?? tx('header.noDates')}
                  </Text>
                </View>
              </View>

              {/* Reserves room for the overflow button rendered above. */}
              <View style={styles.overflowSpacer} />
            </View>

            <View style={styles.metaRow}>
              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor: t.colors.gradientSubtle,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.md,
                    paddingVertical: 4,
                  },
                ]}
              >
                <Icon name={modeIcon} size={13} color={t.colors.primaryInk} />
                <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '700' }]}>
                  {tx('card.meta', { hours: trip.daily_hours_budget, mode: modeLabel })}
                </Text>
              </View>

              {isArchived ? <StatusPill tone="info" label={tx('card.archived')} /> : null}
            </View>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tx('card.actions')}
          onPress={handleOverflowPress}
          hitSlop={6}
          style={({ pressed }) => [
            styles.overflowTrigger,
            {
              top: COVER_HEIGHT + t.layout.cardPadding - 8,
              right: t.layout.cardPadding - 8,
              backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Icon name="ellipsis-vertical" size={20} color={t.colors.textMuted} />
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

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  coverChip: { position: 'absolute' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  overflowTrigger: {
    position: 'absolute',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 44px trigger minus the 8px it overhangs the body padding.
  overflowSpacer: { width: 36, height: 28 },
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
    gap: 5,
  },
});
