/**
 * DaySummaryCard
 *
 * Per-day summary: place count, total visit hours, drive time, drive distance,
 * and estimated cost. Filters places + legs by dayIndex internally.
 *
 * Usage:
 *   <DaySummaryCard dayIndex={0} places={places} legs={legs} trip={trip} />
 *
 * When no legs exist for this day the drive metrics show "—" but visit hours
 * and place count still render.
 *
 * Memoization: reductions are in useMemo keyed on the filtered slices plus
 * cost_per_km and currency so unrelated parent renders don't cause extra work.
 *
 * TripLeg.day_index is confirmed present in src/api/types.ts (number, non-null).
 * No derivation needed.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { Trip, TripLeg, TripPlace } from '@/api/types';
import { humanizeDuration } from './TripCostRollup';

export interface DaySummaryCardProps {
  dayIndex: number;
  places: TripPlace[];
  legs: TripLeg[];
  trip: Trip;
}

export function DaySummaryCard({ dayIndex, places, legs, trip }: DaySummaryCardProps) {
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
    const visitHours = visitMinutes / 60;

    if (dayLegs.length === 0) {
      return {
        visitHours,
        driveSeconds: null,
        distanceMeters: null,
        cost: null,
      };
    }

    const driveSeconds = dayLegs.reduce((s, l) => s + l.duration_seconds, 0);
    const distanceMeters = dayLegs.reduce((s, l) => s + l.distance_meters, 0);
    const cost = (distanceMeters / 1000) * trip.cost_per_km;

    return { visitHours, driveSeconds, distanceMeters, cost };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayPlaces, dayLegs, trip.cost_per_km, trip.currency]);

  const formattedCost =
    derived.cost !== null
      ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: trip.currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(derived.cost)
      : '—';

  const formattedDistance =
    derived.distanceMeters !== null
      ? `${(derived.distanceMeters / 1000).toFixed(0)} km`
      : '—';

  const formattedDrive =
    derived.driveSeconds !== null ? humanizeDuration(derived.driveSeconds) : '—';

  // Step 5: "Est. travel cost" in the a11y label makes clear this is the
  // fuel/transport cost derived from distance × rate, not the full budget.
  const accessLabel = [
    `${dayPlaces.length} place${dayPlaces.length !== 1 ? 's' : ''}`,
    `${derived.visitHours.toFixed(1)}h visit time`,
    `Drive ${formattedDrive}`,
    `${formattedDistance}`,
    `Est. travel cost ${formattedCost}`,
  ].join(', ');

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
        <Chip label={`${derived.visitHours.toFixed(1)}h visit`} t={t} />
        <Chip label={`Drive ${formattedDrive}`} t={t} />
        <Chip label={formattedDistance} t={t} />
        <Chip label={formattedCost} t={t} highlight />
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
