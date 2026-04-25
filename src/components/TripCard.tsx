/**
 * TripCard
 *
 * Renders a single trip summary row. Includes:
 * - Card press → navigates to trip (via onPress prop)
 * - Overflow trigger (⋮) → opens TripActionsSheet
 * - "Archived" StatusPill when trip.archived_at is set
 *
 * DOM nesting fix (Problem 3, Phase 20):
 * The outer card uses `accessibilityRole="link"` so RN Web renders it as <a>
 * rather than <button>. An <a> can legally contain a <button> child, which is
 * what the inner overflow Pressable renders as. This resolves the
 * <button>-inside-<button> invalid HTML pattern that caused React DOM warnings
 * and broken keyboard navigation on web.
 *
 * On native, accessibilityRole="link" still triggers `onPress` correctly — the
 * difference is only in the rendered host element on web.
 *
 * The overflow trigger still calls stopPropagation() on the synthetic web event
 * to prevent the card's onPress from firing when the user taps the kebab.
 *
 * Handler props (onArchive, onUnarchive, onDuplicate, onDelete) are
 * optional here; Step 7.8 will pass real mutation calls from trips.tsx.
 */
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

  // On web we stop the synthetic event propagating up to the card Pressable.
  // On native, RN's touch system does not bubble tap events between nested
  // Pressables the same way, so no extra handling is needed.
  const handleOverflowPress = (e: Parameters<NonNullable<ComponentProps<typeof Pressable>['onPress']>>[0]) => {
    // @ts-expect-error — stopPropagation exists on the web synthetic event but is absent from GestureResponderEvent types
    e?.stopPropagation?.();
    setSheetOpen(true);
  };

  return (
    <>
      {/*
       * accessibilityRole="link" renders as <a> on web (not <button>), which
       * legally accepts the inner overflow <button> child without a DOM nesting
       * violation. On native the role still fires onPress correctly.
       */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open trip ${trip.title}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: t.colors.border,
            borderRadius: t.radius.lg,
            padding: t.spacing.lg,
            gap: t.spacing.xs,
          },
          pressed && styles.pressed,
        ]}
      >
        {/* ─── Header row: title + overflow trigger ─────────────────── */}
        <View style={styles.headerRow}>
          <Text
            style={[t.typography.subtitle, { color: t.colors.text, flex: 1 }]}
            numberOfLines={1}
          >
            {trip.title}
          </Text>

          {/* Overflow trigger — separate Pressable to avoid propagation */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Trip actions"
            onPress={handleOverflowPress}
            hitSlop={8}
            style={styles.overflowTrigger}
          >
            <Text style={[t.typography.subtitle, { color: t.colors.textMuted, lineHeight: 20 }]}>
              ⋮
            </Text>
          </Pressable>
        </View>

        {/* ─── Date range ───────────────────────────────────────────── */}
        {dateRange ? (
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{dateRange}</Text>
        ) : null}

        {/* ─── Meta row ─────────────────────────────────────────────── */}
        <View style={styles.metaRow}>
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            {trip.daily_hours_budget}h / day · {trip.transport_mode}
          </Text>

          {/* Archived pill */}
          {isArchived ? <StatusPill tone="info" label="Archived" /> : null}
        </View>
      </Pressable>

      {/* Bottom sheet rendered outside the card Pressable */}
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
  card: { borderWidth: 1 },
  pressed: { opacity: 0.85 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  overflowTrigger: {
    // 44×44 min hit area is achieved via hitSlop={8} + the natural 28×28 area
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginTop: -2,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
