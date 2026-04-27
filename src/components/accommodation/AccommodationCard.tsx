/**
 * AccommodationCard — single accommodation row in the list.
 *
 * Shows: name, date range, day-bridge indicator, address / place chip, optional notes.
 * Edit + delete affordances, gated by canEdit.
 *
 * Phase 25 Step 25.10: inline notes editor — editors/owners can add/edit/delete
 * notes; viewers see existing notes read-only, nothing if no notes.
 */
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { useUpdateTripAccommodation } from '@/api/trip-accommodations';
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

      {/* Phase 25 Step 25.10: Inline notes editor (editors/owners) or read-only (viewers) */}
      <AccommodationNotesEditor accommodation={accommodation} canEdit={canEdit} />

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

// ── AccommodationNotesEditor ─────────────────────────────────────────────────
// Inline note editor matching the PlaceNotesEditor pattern. Viewers see
// existing notes read-only; editors/owners can tap to edit.
function AccommodationNotesEditor({
  accommodation,
  canEdit,
}: {
  accommodation: TripAccommodation;
  canEdit: boolean;
}) {
  const t = useTheme();
  const updateAcc = useUpdateTripAccommodation();
  const [focused, setFocused] = useState(false);
  const [localText, setLocalText] = useState(accommodation.notes ?? '');

  useEffect(() => {
    setLocalText(accommodation.notes ?? '');
  }, [accommodation.notes]);

  function handleBlur() {
    setFocused(false);
    const trimmed = localText.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    if (next !== accommodation.notes) {
      updateAcc.mutate({ id: accommodation.id, notes: next });
    }
  }

  // Viewer with no notes — render nothing.
  if (!canEdit && !localText) return null;

  if (!canEdit) {
    return (
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={3}>
        {localText}
      </Text>
    );
  }

  if (focused) {
    return (
      <TextInput
        multiline
        numberOfLines={3}
        maxLength={2000}
        value={localText}
        onChangeText={setLocalText}
        onBlur={handleBlur}
        placeholder="Add notes…"
        placeholderTextColor={t.colors.textMuted}
        accessibilityLabel={`Notes for accommodation: ${accommodation.name}`}
        style={[
          accNotesStyles.input,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.sm,
            backgroundColor: t.colors.bg,
            color: t.colors.text,
            ...t.typography.caption,
          },
        ]}
        autoFocus
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        localText
          ? `Notes: ${localText.slice(0, 60)}. Tap to edit.`
          : `Add note for ${accommodation.name}`
      }
      onPress={() => setFocused(true)}
    >
      <Text
        style={[
          t.typography.caption,
          { color: localText ? t.colors.textMuted : t.colors.primary },
        ]}
        numberOfLines={localText ? 2 : undefined}
      >
        {localText || 'Add note…'}
      </Text>
    </Pressable>
  );
}

const accNotesStyles = StyleSheet.create({
  input: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 60,
    textAlignVertical: 'top',
  },
});

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
