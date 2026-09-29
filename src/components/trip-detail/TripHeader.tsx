/**
 * TripHeader — the trip detail header (extracted in v2 N1 1.1; phone
 * layout M4 X2.2; cover hero M5 Y2.4).
 *
 * The hero: the trip's cover (Google cover → generated cover, `TripCover`)
 * under a scrim, with the status chip ("Day 3 of 7" / "In 12 days" /
 * "Relive"), the title and the dates in white.
 *   - Phones (`compact`): a 208 px hero that collapses to the M4 one-line bar
 *     (back · title + dates · ⋯) when the list scrolls or on the Map tab
 *     (`collapsed`, owned by the route shell — see heroCollapse.ts). The
 *     height animates unless the user prefers reduced motion.
 *   - Desktop: a 200 px banner with back, Print and ⋯ on the image.
 * Below the hero, one chip row: places · travel time · distance · the
 * optimize status pill (a translucent pill would not hold AA on a photo,
 * so it never sits on the image).
 *
 * The ⋯ button opens `TripMenuSheet` (below), owned by the route shell:
 * Trip settings · Print · Share · Duplicate · People.
 *
 * Pure presentational: trip/legs data and the optimize mutation state come
 * from the route shell, which owns the auto-optimize debounce.
 */
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BackButton, BottomSheet, Icon, StatusPill, type IconName } from '@/components';
import { TripCover } from '@/components/TripCover';
import { TripStatusChip } from '@/components/TripStatusChip';
import { tripPhase } from '@/components/tripStatus';
import { transportKey } from '@/components/transportModes';
import { useTheme } from '@/theme';
import { formatDateRange, useT } from '@/i18n';
import { OptimizeError, type Trip, type TripLeg } from '@/api';
import { IOS_MODAL_HANDOFF_MS } from './modalHandoff';
import { CollapsingHero, GlassButton, RouteChipRow, heroTextStyle } from './TripHero';

const BANNER_HEIGHT = 200;

export interface TripHeaderProps {
  trip: Trip;
  legs: TripLeg[];
  /** Number of places in the trip — drives the "Add places to optimize" pill. */
  placesCount: number;
  /**
   * Whether the viewer may edit the trip (owner or editor). Viewers can't
   * add places, so they never get the "Add places to optimize" nudge.
   */
  canEdit: boolean;
  /** Auto-optimize mutation state (owned by the route shell). */
  optimizePending: boolean;
  optimizeError: unknown;
  onBack: () => void;
  onPrint: () => void;
  /** Opens the ⋯ overflow menu (TripMenuSheet). */
  onOpenMenu: () => void;
  /** Phone layout: collapsible hero + chip row. Desktop: banner. */
  compact?: boolean;
  /** Phones: show the one-line bar instead of the full hero. */
  collapsed?: boolean;
}

export function TripHeader({
  trip,
  legs,
  placesCount,
  canEdit,
  optimizePending,
  optimizeError,
  onBack,
  onPrint,
  onOpenMenu,
  compact = false,
  collapsed = false,
}: TripHeaderProps) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  const phase = tripPhase(trip.start_date, trip.end_date);
  const dates = formatDateRange(trip.start_date, trip.end_date) ?? tx('header.noDates');

  const statusPill = optimizePending ? (
    <StatusPill tone="info" label={tx('optimize.running')} loading />
  ) : optimizeError ? (
    (() => {
      const { tone, labelKey } = pillForOptimizeError(optimizeError);
      return <StatusPill tone={tone} label={tx(labelKey)} />;
    })()
  ) : placesCount < 2 && canEdit ? (
    <StatusPill tone="info" label={tx('optimize.addPlaces')} />
  ) : null;

  const menuButton = (
    <GlassButton
      icon="ellipsis-vertical"
      accessibilityLabel={tx('header.menu')}
      accessibilityHint={tx('header.menuHint')}
      onPress={onOpenMenu}
    />
  );
  const backButton = <BackButton onPress={onBack} label={tx('header.back')} tone="onImage" />;

  if (compact) {
    return (
      <View>
        <CollapsingHero
          trip={trip}
          collapsed={collapsed}
          phaseChip={<TripStatusChip phase={phase} tone="onImage" />}
          dates={dates}
          back={backButton}
          menu={menuButton}
        />
        <View style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.sm }}>
          <RouteChipRow legs={legs} placesCount={placesCount} statusPill={statusPill} />
        </View>
      </View>
    );
  }

  const meta = tx('header.meta', {
    dates,
    hours: trip.daily_hours_budget,
    mode: tx(transportKey(trip.transport_mode)),
  });

  return (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg, gap: t.spacing.md }}>
      <TripCover
        tripId={trip.id}
        coverPlaceId={trip.cover_photo_google_place_id}
        photoWidth={1600}
        scrim="hero"
        style={{ height: BANNER_HEIGHT, borderRadius: t.radius.xl }}
      >
        <View style={[styles.bannerTop, { padding: t.spacing.lg }]}>
          {backButton}
          <View style={styles.actionsRow}>
            <GlassButton
              icon="printer"
              label={tx('header.print')}
              accessibilityLabel={tx('header.printA11y')}
              onPress={onPrint}
            />
            {menuButton}
          </View>
        </View>
        <View style={[styles.bannerBottom, { padding: t.spacing.xl, gap: t.spacing.xs }]}>
          <TripStatusChip phase={phase} tone="onImage" />
          <Text
            accessibilityRole="header"
            aria-level={1}
            numberOfLines={1}
            style={[t.typography.title, heroTextStyle(t)]}
          >
            {trip.title}
          </Text>
          <Text numberOfLines={1} style={[t.typography.body, heroTextStyle(t)]}>
            {meta}
          </Text>
        </View>
      </TripCover>
      <RouteChipRow legs={legs} placesCount={placesCount} statusPill={statusPill} />
    </View>
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
  const { t: tx } = useT('trip');
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
    { key: 'settings', icon: 'settings', label: tx('menu.settings'), a11y: tx('menu.settingsA11y'), run: onOpenSettings },
    { key: 'print', icon: 'printer', label: tx('menu.print'), a11y: tx('menu.print'), run: onPrint },
    { key: 'share', icon: 'share-2', label: tx('menu.share'), a11y: tx('menu.shareA11y'), run: onShare },
    { key: 'people', icon: 'users', label: tx('menu.people'), a11y: tx('menu.peopleA11y'), run: onOpenPeople },
  ];
  if (onDuplicate) {
    rows.push({
      key: 'duplicate',
      icon: 'file-text',
      label: duplicating ? tx('menu.duplicating') : tx('menu.duplicate'),
      a11y: tx('menu.duplicateA11y'),
      run: onDuplicate,
    });
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={tx('header.menu')}>
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
 * - `not_editor` (403, security audit #6) is not a failure either: the
 *   caller is a viewer. The route shell no longer auto-runs optimize for
 *   viewers, so this only shows if the role changed mid-session — render a
 *   neutral "View only" pill, never a red error.
 * - `quota_exceeded` (429) is the caller's daily routing quota; it resets
 *   tomorrow, so say that (info tone — an expected limit, not a failure).
 * - All other known codes map to danger tone with a code-specific label.
 * - Unknown codes / non-OptimizeError (network failures, parse fallthrough)
 *   fall back to the generic "Optimize failed" label.
 *
 * Returns a `trip` namespace key (translated at render), not a string.
 */
export type OptimizePillKey =
  | 'optimize.inProgress'
  | 'optimize.viewOnly'
  | 'optimize.quotaExceeded'
  | 'optimize.tooManyPlaces'
  | 'optimize.routingUnavailable'
  | 'optimize.notFound'
  | 'optimize.failed';

export function pillForOptimizeError(
  err: unknown,
): { tone: 'info' | 'success' | 'danger'; labelKey: OptimizePillKey } {
  if (err instanceof OptimizeError) {
    switch (err.code) {
      case 'already_optimizing':
        return { tone: 'info', labelKey: 'optimize.inProgress' };
      case 'not_editor':
        return { tone: 'info', labelKey: 'optimize.viewOnly' };
      case 'quota_exceeded':
        return { tone: 'info', labelKey: 'optimize.quotaExceeded' };
      case 'too_many_places':
        return { tone: 'danger', labelKey: 'optimize.tooManyPlaces' };
      case 'matrix_failed':
        return { tone: 'danger', labelKey: 'optimize.routingUnavailable' };
      case 'not_found':
        return { tone: 'danger', labelKey: 'optimize.notFound' };
      case 'rpc_failed':
      case 'db_error':
      case 'invalid_input':
      default:
        return { tone: 'danger', labelKey: 'optimize.failed' };
    }
  }
  return { tone: 'danger', labelKey: 'optimize.failed' };
}

const styles = StyleSheet.create({
  bannerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
  },
});
