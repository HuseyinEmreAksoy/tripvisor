/**
 * DaySummaryCard
 *
 * Per-day summary: place count, total visit time, total travel time,
 * total day time, and drive distance.
 * Filters places + legs by dayIndex internally.
 *
 * Phase 23 Step 23.8: three time columns added:
 *   - Total visit   (sum of visit_duration_minutes)
 *   - Total travel  (sum of trip_legs.duration_seconds for that day)
 *   - Total day     (sum of the two)
 *
 * v2 Phase 0.1: the per-day estimated cost chip (km × trip.cost_per_km) was
 * retired — time and duration are the primary planning model; money lives in
 * the category-based budget surface (BudgetCard / trip_expenses).
 *
 * Usage:
 *   <DaySummaryCard dayIndex={0} places={places} legs={legs} />
 *
 * Memoization: reductions are in useMemo keyed on the filtered slices so
 * unrelated parent renders don't cause extra work.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripLeg, TripPlace } from '@/api/types';
import { humanizeDuration } from './TripCostRollup';
import { formatDuration } from '@/lib/formatDuration';

export interface DaySummaryCardProps {
  dayIndex: number;
  places: TripPlace[];
  legs: TripLeg[];
}

export function DaySummaryCard({ dayIndex, places, legs }: DaySummaryCardProps) {
  const t = useTheme();

  const dayPlaces = useMemo(
    () => places.filter((p) => p.day_index === dayIndex),
    [places, dayIndex],
  );

  const dayLegs = useMemo(
    () => legs.filter((l) => l.day_index === dayIndex),
    [legs, dayIndex],
  );

  // Reductions — dep array covers all inputs that affect the derived values.
  const derived = useMemo(() => {
    const visitMinutes = dayPlaces.reduce((s, p) => s + p.visit_duration_minutes, 0);

    if (dayLegs.length === 0) {
      return {
        visitMinutes,
        travelSeconds: null,
        distanceMeters: null,
      };
    }

    const travelSeconds = dayLegs.reduce((s, l) => s + l.duration_seconds, 0);
    const distanceMeters = dayLegs.reduce((s, l) => s + l.distance_meters, 0);

    return { visitMinutes, travelSeconds, distanceMeters };
  }, [dayPlaces, dayLegs]);

  const travelMinutes =
    derived.travelSeconds !== null ? Math.floor(derived.travelSeconds / 60) : null;

  const totalMinutes =
    travelMinutes !== null ? derived.visitMinutes + travelMinutes : derived.visitMinutes;

  const formattedVisit = formatDuration(derived.visitMinutes);
  const formattedTravel = travelMinutes !== null ? formatDuration(travelMinutes) : '—';
  const formattedTotal = formatDuration(totalMinutes);

  const formattedDistance =
    derived.distanceMeters !== null
      ? `${(derived.distanceMeters / 1000).toFixed(0)} km`
      : '—';

  const formattedDrive =
    derived.travelSeconds !== null ? humanizeDuration(derived.travelSeconds) : '—';

  // Accessibility label covering all the key numbers.
  const accessLabel = [
    `${dayPlaces.length} place${dayPlaces.length !== 1 ? 's' : ''}`,
    `Total visit ${formattedVisit}`,
    `Total travel ${formattedTravel}`,
    `Total day ${formattedTotal}`,
    `${formattedDistance}`,
  ].join(', ');

  void formattedDrive; // retained for future use; drive label is now superseded by formattedTravel

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.cardBgSolid,
          borderRadius: t.radius.lg,
          padding: t.spacing.md,
          borderWidth: 1,
          borderColor: t.colors.border,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessLabel}
    >
      <View style={styles.row}>
        <Chip
          label={`${dayPlaces.length} place${dayPlaces.length !== 1 ? 's' : ''}`}
          t={t}
        />
        {/* Step 23.8: three distinct time chips */}
        <Chip
          label={`Visit ${formattedVisit}`}
          t={t}
        />
        <Chip
          label={`Travel ${formattedTravel}`}
          t={t}
        />
        <Chip
          label={`Day ${formattedTotal}`}
          t={t}
          highlight
        />
        <Chip label={formattedDistance} t={t} />
      </View>
    </View>
  );
}

function Chip({
  label,
  t,
  highlight = false,
}: {
  label: string;
  t: ReturnType<typeof useTheme>;
  highlight?: boolean;
}) {
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: highlight ? t.colors.primary : t.colors.bgElevated,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.sm,
          paddingVertical: 3,
        },
      ]}
    >
      <Text
        style={[
          t.typography.small,
          { color: highlight ? t.colors.primaryText : t.colors.textMuted },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  chip: {},
});
