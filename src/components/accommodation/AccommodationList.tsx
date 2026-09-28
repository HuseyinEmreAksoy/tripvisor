/**
 * AccommodationList — wraps AccommodationCard rows with a section header and
 * an "Add accommodation" button (canEdit only).
 *
 * Consumed in the Settings tab of the trip detail screen.
 * v2 M4 X2.4: stays render in check-in order (earliest first).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { AccommodationCard } from './AccommodationCard';
import type { TripAccommodation } from '@/api/types';
import { Pressable } from 'react-native';

export interface AccommodationListProps {
  accommodations: TripAccommodation[];
  tripStartDate: string | null;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (accommodation: TripAccommodation) => void;
  onDelete: (accommodation: TripAccommodation) => void;
}

export function AccommodationList({
  accommodations,
  tripStartDate,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
}: AccommodationListProps) {
  const t = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      {/* Header */}
      <View style={[styles.row, { justifyContent: 'space-between', marginBottom: t.spacing.xs }]}>
        <Text
          style={[t.typography.subtitle, { color: t.colors.text }]}
          accessibilityRole="header"
          aria-level={4}
        >
          Accommodation
        </Text>
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add accommodation"
            onPress={onAdd}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.primary,
                borderRadius: t.radius.md,
                paddingHorizontal: t.spacing.md,
                paddingVertical: t.spacing.xs,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.primaryText, fontWeight: '600' }]}>
              + Add
            </Text>
          </Pressable>
        ) : null}
      </View>

      {accommodations.length === 0 ? (
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          No accommodations added yet.
        </Text>
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {[...accommodations]
            .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
            .map((acc) => (
            <AccommodationCard
              key={acc.id}
              accommodation={acc}
              tripStartDate={tripStartDate}
              canEdit={canEdit}
              onEdit={() => onEdit(acc)}
              onDelete={() => onDelete(acc)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  addBtn: {},
});
