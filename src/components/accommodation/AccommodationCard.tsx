/**
 * AccommodationCard — single accommodation row in the list.
 *
 * Shows: name, date range, day-bridge indicator, address / place chip, optional notes.
 * Edit + delete affordances, gated by canEdit.
 */
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripAccommodation } from '@/api/types';

export interface AccommodationCardProps {
  accommodation: TripAccommodation;
  tripStartDate: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function AccommodationCard({
  accommodation,
  tripStartDate,
  canEdit,
  onEdit,
  onDelete,
}: AccommodationCardProps) {
  const t = useTheme();

  const dayBridge = computeDayBridge(accommodation, tripStartDate);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
      accessible
      accessibilityLabel={`${accommodation.name}, ${formatDateRange(accommodation.check_in_date, accommodation.check_out_date)}`}
    >
      {/* Name row */}
      <View style={[styles.row, { justifyContent: 'space-between', gap: t.spacing.sm }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
            {accommodation.name}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {formatDateRange(accommodation.check_in_date, accommodation.check_out_date)}
          </Text>
        </View>

        {/* Day bridge pill */}
        {dayBridge ? (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: t.colors.gradientSubtle,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 2,
              },
            ]}
          >
            <Text style={[t.typography.small, { color: t.colors.primary }]}>
              {dayBridge}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Address / place */}
      {accommodation.address ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={2}>
          {accommodation.address}
        </Text>
      ) : accommodation.google_place_id ? (
        <View
          style={[
            styles.placePill,
            {
              backgroundColor: t.colors.infoLight,
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.sm,
              paddingVertical: 2,
              alignSelf: 'flex-start',
            },
          ]}
        >
          <Text style={[t.typography.small, { color: t.colors.info }]}>
            Google Place
          </Text>
        </View>
      ) : null}

      {/* Notes */}
      {accommodation.notes ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={2}>
          {accommodation.notes}
        </Text>
      ) : null}

      {/* Actions */}
      {canEdit ? (
        <View style={[styles.row, { gap: t.spacing.sm, justifyContent: 'flex-end' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit accommodation: ${accommodation.name}`}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primary }]}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete accommodation: ${accommodation.name}`}
            onPress={() => confirmDelete(accommodation, onDelete)}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.danger }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Computes "Day X → Day Y" string for an accommodation, based on the trip
 * start date. Returns null if the trip has no start date.
 */
function computeDayBridge(
  acc: TripAccommodation,
  tripStartDate: string | null,
): string | null {
  if (!tripStartDate) return null;
  try {
    const start = new Date(tripStartDate);
    const checkIn = new Date(acc.check_in_date);
    const checkOut = new Date(acc.check_out_date);
    const inDay = Math.round((checkIn.getTime() - start.getTime()) / 86400000) + 1;
    const outDay = Math.round((checkOut.getTime() - start.getTime()) / 86400000) + 1;
    if (inDay < 1 && outDay < 1) return null;
    if (inDay === outDay) return `Day ${inDay}`;
    return `Day ${inDay} → Day ${outDay}`;
  } catch {
    return null;
  }
}

function formatDateRange(checkIn: string, checkOut: string): string {
  return `${checkIn} → ${checkOut}`;
}

function confirmDelete(acc: TripAccommodation, onDelete: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`Delete "${acc.name}"?`)) {
      onDelete();
    }
    return;
  }
  Alert.alert('Delete accommodation?', `Remove "${acc.name}"? This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onDelete },
  ]);
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: {},
  placePill: {},
  actionBtn: {},
});
