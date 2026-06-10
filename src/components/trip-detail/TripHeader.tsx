/**
 * TripHeader — shared page header for the trip detail route (extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 — pure refactor).
 *
 * Back affordance + title + Print action + meta pill (dates · daily hours ·
 * transport mode) + optimize status pill + the time-first route summary card.
 * Used by both the desktop split layout and the mobile tab layout.
 *
 * Pure presentational: trip/legs data and the optimize mutation state come
 * from the route shell, which owns the auto-optimize debounce.
 */
import { StyleSheet, Text, View } from 'react-native';
import { BackButton, Button, Heading, StatusPill, TripCostRollup } from '@/components';
import { useTheme } from '@/theme';
import { OptimizeError, type Trip, type TripLeg } from '@/api';

export interface TripHeaderProps {
  trip: Trip;
  legs: TripLeg[];
  /** Number of places in the trip — drives the "Add places to optimize" pill. */
  placesCount: number;
  /** Auto-optimize mutation state (owned by the route shell). */
  optimizePending: boolean;
  optimizeError: unknown;
  onBack: () => void;
  onPrint: () => void;
}

export function TripHeader({
  trip,
  legs,
  placesCount,
  optimizePending,
  optimizeError,
  onBack,
  onPrint,
}: TripHeaderProps) {
  const t = useTheme();

  return (
    <View style={{ backgroundColor: t.colors.gradientSubtle }}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
        <BackButton onPress={onBack} label="Trips" />
        <View style={styles.titleRow}>
          <Heading level={1}>{trip.title}</Heading>
          <Button
            label="🖨️ Print"
            variant="secondary"
            fullWidth={false}
            onPress={onPrint}
            accessibilityLabel="Print itinerary"
          />
        </View>
        <View style={styles.metaRow}>
          <View style={{
            backgroundColor: t.colors.cardBgSolid,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            paddingVertical: t.spacing.xs,
            ...t.shadows.sm(t.colors.shadowColor),
          }}>
            <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '500' }]}>
              📅 {formatRange(trip.start_date, trip.end_date)} · {trip.daily_hours_budget}h/day · {trip.transport_mode}
            </Text>
          </View>
          {optimizePending ? (
            <StatusPill tone="info" label="Optimizing…" loading />
          ) : optimizeError ? (
            (() => {
              const { tone, label } = pillForOptimizeError(optimizeError);
              return <StatusPill tone={tone} label={label} />;
            })()
          ) : placesCount < 2 ? (
            <StatusPill tone="info" label="Add places to optimize" />
          ) : null}
        </View>

        {/* Route summary card (time-first, v2 Phase 0.1) */}
        <TripCostRollup legs={legs} />
      </View>
    </View>
  );
}

/**
 * Map an optimize-trip error to a user-facing status pill.
 *
 * - `already_optimizing` (409) is a transient state, not a failure: another
 *   optimize is already running for the trip (typically a double-click or a
 *   rapid state-key change). Render as info tone — the auto-optimize effect
 *   in the route shell will re-run when the in-flight call settles, no user
 *   action needed.
 * - All other known codes map to danger tone with a code-specific label.
 * - Unknown codes / non-OptimizeError (network failures, parse fallthrough)
 *   fall back to the generic "Optimize failed" label.
 */
function pillForOptimizeError(
  err: unknown,
): { tone: 'info' | 'success' | 'danger'; label: string } {
  if (err instanceof OptimizeError) {
    switch (err.code) {
      case 'already_optimizing':
        return { tone: 'info', label: 'Optimizing in progress…' };
      case 'too_many_places':
        return { tone: 'danger', label: 'Trip is too large' };
      case 'matrix_failed':
        return { tone: 'danger', label: 'Routing service unavailable' };
      case 'not_found':
        return { tone: 'danger', label: 'Trip not found' };
      case 'rpc_failed':
      case 'db_error':
      case 'invalid_input':
      default:
        return { tone: 'danger', label: 'Optimize failed' };
    }
  }
  return { tone: 'danger', label: 'Optimize failed' };
}

function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} → ${end}`;
  return start ?? end ?? 'No dates set';
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
});
