/**
 * TripHeader — shared page header for the trip detail route (extracted from
 * app/(app)/trip/[id]/index.tsx in v2 Phase N1 step 1.1 — pure refactor).
 *
 * Two layouts (v2 M4 X2.2):
 *   - `compact` (phones/tablets): one row — back · title + dates · ⋯ menu —
 *     plus a single horizontally scrolling chip row (optimize status, travel
 *     time, distance, stops). The plan gets the vertical space.
 *   - full (desktop): back + title + Print + ⋯ + meta pill + optimize pill +
 *     the time-first route summary card, as before.
 *
 * The ⋯ button opens `TripMenuSheet` (below), owned by the route shell:
 * Trip settings · Print · Share · Duplicate · People.
 *
 * Pure presentational: trip/legs data and the optimize mutation state come
 * from the route shell, which owns the auto-optimize debounce.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BackButton,
  BottomSheet,
  Button,
  Heading,
  Icon,
  StatusPill,
  TripCostRollup,
  type IconName,
} from '@/components';
import { humanizeDuration } from '@/components/TripCostRollup';
import { useTheme } from '@/theme';
import { OptimizeError, type Trip, type TripLeg } from '@/api';
import { IOS_MODAL_HANDOFF_MS } from './modalHandoff';

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
  /** Opens the ⋯ overflow menu (TripMenuSheet). */
  onOpenMenu: () => void;
  /** Phone layout: one-line header + chip row instead of the summary card. */
  compact?: boolean;
}

export function TripHeader({
  trip,
  legs,
  placesCount,
  optimizePending,
  optimizeError,
  onBack,
  onPrint,
  onOpenMenu,
  compact = false,
}: TripHeaderProps) {
  const t = useTheme();

  const statusPill = optimizePending ? (
    <StatusPill tone="info" label="Optimizing…" loading />
  ) : optimizeError ? (
    (() => {
      const { tone, label } = pillForOptimizeError(optimizeError);
      return <StatusPill tone={tone} label={label} />;
    })()
  ) : placesCount < 2 ? (
    <StatusPill tone="info" label="Add places to optimize" />
  ) : null;

  const menuButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Trip menu"
      accessibilityHint="Trip settings, print, share and more"
      onPress={onOpenMenu}
      hitSlop={6}
      style={({ pressed }) => [
        styles.menuBtn,
        {
          backgroundColor: pressed ? t.colors.bgMuted : t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.pill,
        },
      ]}
    >
      <Icon name="ellipsis-vertical" size={20} color={t.colors.text} />
    </Pressable>
  );

  if (compact) {
    return (
      <View style={{ backgroundColor: t.colors.gradientSubtle }}>
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingTop: t.spacing.sm,
            paddingBottom: t.spacing.sm,
            gap: t.spacing.sm,
          }}
        >
          <View style={styles.compactRow}>
            <BackButton onPress={onBack} label="Trips" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[t.typography.bodyStrong, { color: t.colors.text, fontSize: 18 }]}
              >
                {trip.title}
              </Text>
              <Text numberOfLines={1} style={[t.typography.caption, { color: t.colors.textMuted }]}>
                {formatRange(trip.start_date, trip.end_date)}
              </Text>
            </View>
            {menuButton}
          </View>
          <RouteChipRow legs={legs} placesCount={placesCount} statusPill={statusPill} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: t.colors.gradientSubtle }}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <BackButton onPress={onBack} label="Trips" />
        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
            <Text style={[t.typography.overline, { color: t.colors.primaryInk }]}>
              Itinerary
            </Text>
            <Heading level={1}>{trip.title}</Heading>
          </View>
          <View style={styles.actionsRow}>
            <Button
              label="Print"
              variant="secondary"
              fullWidth={false}
              onPress={onPrint}
              accessibilityLabel="Print itinerary"
            />
            {menuButton}
          </View>
        </View>
        <View style={styles.metaRow}>
          <View style={{
            backgroundColor: t.colors.bgElevated,
            borderWidth: 1,
            borderColor: t.colors.border,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            paddingVertical: 5,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            ...t.shadows.sm(t.colors.shadowColor),
          }}>
            <Icon name="calendar" size={13} color={t.colors.textMuted} />
            <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
              {formatRange(trip.start_date, trip.end_date)} · {trip.daily_hours_budget}h/day · {trip.transport_mode}
            </Text>
          </View>
          {statusPill}
        </View>

        {/* Route summary card (time-first, v2 Phase 0.1) */}
        <TripCostRollup legs={legs} />
      </View>
    </View>
  );
}

/**
 * One-line replacement for the route summary card on phones: the same
 * time-first totals (day-assigned legs only — day_index -1 rows are the
 * optimizer's matrix cache, see TripCostRollup) as compact chips.
 */
function RouteChipRow({
  legs,
  placesCount,
  statusPill,
}: {
  legs: TripLeg[];
  placesCount: number;
  statusPill: React.ReactNode;
}) {
  const t = useTheme();
  const totals = useMemo(() => {
    const routeLegs = legs.filter((l) => l.day_index >= 0);
    if (routeLegs.length === 0) return null;
    return {
      seconds: routeLegs.reduce((s, l) => s + l.duration_seconds, 0),
      km: routeLegs.reduce((s, l) => s + l.distance_meters, 0) / 1000,
    };
  }, [legs]);

  const chips: Array<{ key: string; icon: IconName; label: string; a11y: string }> = [
    {
      key: 'stops',
      icon: 'map-pin',
      label: `${placesCount} ${placesCount === 1 ? 'place' : 'places'}`,
      a11y: `${placesCount} places`,
    },
  ];
  if (totals) {
    chips.push(
      {
        key: 'time',
        icon: 'clock',
        label: humanizeDuration(totals.seconds),
        a11y: `Total travel time ${humanizeDuration(totals.seconds)}`,
      },
      {
        key: 'km',
        icon: 'compass',
        label: `${totals.km.toFixed(0)} km`,
        a11y: `Total distance ${totals.km.toFixed(0)} kilometres`,
      },
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: t.spacing.sm, alignItems: 'center' }}
      accessibilityLabel="Route summary"
    >
      {chips.map((c) => (
        <View
          key={c.key}
          accessible
          accessibilityLabel={c.a11y}
          style={[
            styles.chip,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Icon name={c.icon} size={14} color={t.colors.textMuted} />
          <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>
            {c.label}
          </Text>
        </View>
      ))}
      {statusPill}
    </ScrollView>
  );
}

// ── ⋯ overflow menu ─────────────────────────────────────────────────────────

export interface TripMenuSheetProps {
  visible: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onPrint: () => void;
  onShare: () => void;
  onOpenPeople: () => void;
  /** Owner-only (duplicate_trip RPC); omitted → row hidden. */
  onDuplicate?: () => void;
  duplicating?: boolean;
}

/**
 * The header's overflow menu. Each row closes the sheet, then runs its
 * action. Role gating is the caller's job (pass `onDuplicate` only when
 * the user may duplicate).
 */
export function TripMenuSheet({
  visible,
  onClose,
  onOpenSettings,
  onPrint,
  onShare,
  onOpenPeople,
  onDuplicate,
  duplicating = false,
}: TripMenuSheetProps) {
  // iOS drops a modal presented while this one is still dismissing, so the
  // chosen action runs after the handoff delay there (settings/share sheets).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const choose = (run: () => void) => {
    onClose();
    if (timer.current) clearTimeout(timer.current);
    if (Platform.OS === 'ios') timer.current = setTimeout(run, IOS_MODAL_HANDOFF_MS);
    else run();
  };
  const rows: Array<{ key: string; icon: IconName; label: string; a11y: string; run: () => void }> = [
    { key: 'settings', icon: 'settings', label: 'Trip settings', a11y: 'Open trip settings', run: onOpenSettings },
    { key: 'print', icon: 'printer', label: 'Print itinerary', a11y: 'Print itinerary', run: onPrint },
    { key: 'share', icon: 'share-2', label: 'Share trip', a11y: 'Share this trip', run: onShare },
    { key: 'people', icon: 'users', label: 'People', a11y: 'Manage collaborators', run: onOpenPeople },
  ];
  if (onDuplicate) {
    rows.push({
      key: 'duplicate',
      icon: 'file-text',
      label: duplicating ? 'Duplicating…' : 'Duplicate trip',
      a11y: 'Duplicate this trip',
      run: onDuplicate,
    });
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Trip menu">
      {rows.map((r) => (
        <MenuRow
          key={r.key}
          icon={r.icon}
          label={r.label}
          accessibilityLabel={r.a11y}
          disabled={r.key === 'duplicate' && duplicating}
          onPress={() => choose(r.run)}
        />
      ))}
    </BottomSheet>
  );
}

function MenuRow({
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        {
          backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing.sm,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Icon name={icon} size={20} color={t.colors.primary} />
      <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{label}</Text>
    </Pressable>
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
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  menuBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
});
