/**
 * TripCostRollup — time-first route summary card.
 *
 * v2 Phase 0.1: the per-km cost estimate (km × trip.cost_per_km) was retired.
 * Money now lives exclusively in the category-based budget surface
 * (BudgetCard / CategoryBreakdown / trip_expenses), so this card is a pure
 * TIME + DISTANCE summary of the optimized route: total drive time as the
 * headline, plus distance and leg count. The component (and file) name is
 * kept to avoid churn — `humanizeDuration` is imported from this module by
 * DaySummaryCard and the unit tests. A rename to `TripRouteSummary` can ride
 * along with the Phase 15 `cost_per_km` column drop.
 *
 * Usage:
 *   <TripCostRollup legs={legs} />
 *
 * Empty state (legs.length === 0): renders the same card with "—" placeholders
 * and a prompt to run the optimizer.
 *
 * Memoization: the distance/duration reductions are wrapped in useMemo keyed
 * on [legs] so unrelated re-renders (e.g. tab changes) do not recompute.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripLeg } from '@/api/types';

export interface TripCostRollupProps {
  legs: TripLeg[];
}

export function TripCostRollup({ legs }: TripCostRollupProps) {
  const t = useTheme();

  const totals = useMemo(() => {
    // Fix (2026-06-11): trip_legs also stores the optimizer's pairwise
    // distance-matrix CACHE rows (day_index = -1, no polyline) — only rows
    // assigned to a day are real route hops. Summing everything inflated
    // the total massively on larger trips (a 14-place trip carries 182
    // cache rows); latent since v1 because small trips masked it.
    const routeLegs = legs.filter((l) => l.day_index >= 0);
    if (routeLegs.length === 0) return null;
    const totalMeters = routeLegs.reduce((s, l) => s + l.distance_meters, 0);
    const totalSeconds = routeLegs.reduce((s, l) => s + l.duration_seconds, 0);
    return { totalMeters, totalSeconds, totalKm: totalMeters / 1000, count: routeLegs.length };
  }, [legs]);

  const formattedDuration = totals ? humanizeDuration(totals.totalSeconds) : '—';
  const formattedDistance = totals ? `${totals.totalKm.toFixed(0)} km` : '—';
  const formattedLegs = totals ? `${totals.count}` : '—';

  const isEmpty = totals === null;

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
          ? 'Route summary: optimize the trip to see drive time and distance'
          : `Route summary: total drive time ${formattedDuration}, ${formattedDistance}, ${formattedLegs} travel legs`
      }
    >
      {/* Header row — drive time is the headline metric (time-first model). */}
      <View style={styles.headerRow}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
          Total drive time
        </Text>
        <Text
          style={[t.typography.title, { color: isEmpty ? t.colors.textMuted : t.colors.text }]}
          accessibilityRole="text"
        >
          {formattedDuration}
        </Text>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatItem label="Distance" value={formattedDistance} t={t} />
        <Divider t={t} />
        <StatItem label="Travel legs" value={formattedLegs} t={t} />
      </View>

      {/* Empty hint */}
      {isEmpty ? (
        <Text
          style={[t.typography.caption, { color: t.colors.textMuted }]}
          accessibilityLiveRegion="polite"
        >
          Optimize the trip to see drive time and distance
        </Text>
      ) : null}

      {/* Google attribution footer — required per Tripvisor rule #4 (drive
          times + distances are Routes API data). */}
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
