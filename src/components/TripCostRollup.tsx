/**
 * TripCostRollup
 *
 * Displays the aggregate cost, distance, and drive time for a trip based on
 * the legs returned from the optimizer. Uses Intl.NumberFormat for currency
 * formatting so it works consistently on iOS, Android, and web without any
 * polyfill (all three platforms include Intl in their JS engines).
 *
 * Usage:
 *   <TripCostRollup trip={trip} legs={legs} />
 *
 * Empty state (legs.length === 0): renders the same card with "—" placeholders
 * and a prompt to run the optimizer.
 *
 * Memoization: the cost/distance/duration reductions are wrapped in useMemo
 * keyed on [legs, cost_per_km, currency] so unrelated re-renders (e.g. tab
 * changes) do not recompute. Intl.NumberFormat construction is NOT memoized
 * because its overhead is negligible compared to the DOM diffing cost.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { Trip, TripLeg } from '@/api/types';

export interface TripCostRollupProps {
  trip: Trip;
  legs: TripLeg[];
}

export function TripCostRollup({ trip, legs }: TripCostRollupProps) {
  const t = useTheme();

  // Explicit dep array includes cost_per_km and currency as required by spec.
  const totals = useMemo(() => {
    if (legs.length === 0) return null;
    const totalMeters = legs.reduce((s, l) => s + l.distance_meters, 0);
    const totalSeconds = legs.reduce((s, l) => s + l.duration_seconds, 0);
    const totalKm = totalMeters / 1000;
    const cost = totalKm * trip.cost_per_km;
    return { totalMeters, totalSeconds, totalKm, cost };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, trip.cost_per_km, trip.currency]);

  const formattedCost = totals
    ? new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: trip.currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(totals.cost)
    : '—';

  const formattedDistance = totals ? `${totals.totalKm.toFixed(0)} km` : '—';
  const formattedDuration = totals ? humanizeDuration(totals.totalSeconds) : '—';

  const isEmpty = legs.length === 0;

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
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={
        isEmpty
          ? 'Estimated travel cost: optimize the trip to see estimate'
          : `Estimated travel cost ${formattedCost}, ${formattedDistance}, drive time ${formattedDuration}`
      }
    >
      {/* Header row — Step 5: "Estimated travel cost" clarifies this is
          derived from km × rate (fuel/transport), not the full trip budget. */}
      <View style={styles.headerRow}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
          Estimated travel cost
        </Text>
        <Text
          style={[t.typography.title, { color: isEmpty ? t.colors.textMuted : t.colors.text }]}
          accessibilityRole="text"
        >
          {formattedCost}
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatItem label="Distance" value={formattedDistance} t={t} />
        <Divider t={t} />
        <StatItem label="Drive time" value={formattedDuration} t={t} />
      </View>

      {/* Empty hint */}
      {isEmpty ? (
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted }]}
          accessibilityLiveRegion="polite"
        >
          Optimize the trip to see estimated travel cost
        </Text>
      ) : null}

      {/* Google attribution footer — required per Tripvisor rule #4 */}
      <Text style={[t.typography.small, { color: t.colors.attribution }]}>
        estimate · Powered by Google
      </Text>
    </View>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function StatItem({
  label,
  value,
  t,
}: {
  label: string;
  value: string;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.statItem}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{value}</Text>
    </View>
  );
}

function Divider({ t }: { t: ReturnType<typeof useTheme> }) {
  return (
    <View
      style={[styles.divider, { backgroundColor: t.colors.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/**
 * Convert seconds → "Xh Ym". Returns "—" when seconds is 0.
 * Exported so DaySummaryCard can reuse it without re-declaring.
 */
export function humanizeDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 0,
  },
  statItem: {
    flex: 1,
    gap: 2,
  },
  divider: {
    width: 1,
    marginHorizontal: 12,
    alignSelf: 'stretch',
  },
});
