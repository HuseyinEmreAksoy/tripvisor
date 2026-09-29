/**
 * PlaceRow — itinerary row card (extracted from app/(app)/trip/[id]/index.tsx
 * in v2 Phase N1 step 1.1 — pure refactor).
 *
 * Phase 23 Step 23.8: displays Visit and Travel as two distinct labeled values.
 * Phase 23 Step 23.9: transit trips get a "Plan transit" deep link.
 * Phase 25 Step 25.8: small thumbnail image prepended to the row.
 *
 * v2 N1 step 1.2: arrival→departure chip ("10:00 → 12:30") under the visit-
 * duration label. Computed in ItineraryTab (computeDayTimeline) and passed in
 * as a presentational `timeline` prop — this row does zero time math.
 * v2 N1 step 1.7: comment chip next to the reaction chip; always visible
 * when `onOpenComments` is provided (count badge appears at ≥1).
 * v2 P1.1: time-window chip ("⏰ 10:00–17:00") straight from the place row's
 * arrive_after/leave_before, plus timeline-driven wait info and a
 * non-blocking amber conflict warning. All strings prebuilt in ItineraryTab.
 * NO live Google-hours fetches in this list (metered cost).
 * v2 P1.2: transit connectors name the rides ("🚇 M2 → ~12 min").
 * v2 S2.8.13 (F4): web-only "Place actions" kebab (⋮) in the chip rail opens
 * the same PlaceActionsSheet that long-press opens on native.
 *
 * v2 M4 X2.3:
 *  - The WHOLE card is the open-details target again, without nesting
 *    interactive elements (S2.8.13 had narrowed it to thumbnail + title to
 *    avoid <button>-in-<button> on web). An absolutely-positioned underlay
 *    Pressable fills the card; the read-only content above it is
 *    `pointerEvents="none"` so taps fall through to the underlay; the chip
 *    rail is a SIBLING on top and keeps its own buttons. The underlay also
 *    carries the drag long-press forwarded by DraggableItinerary
 *    (`onLongPress`), so pickup works from anywhere on the card.
 *  - Denser on phones (smaller thumbnail, category + visit on one line,
 *    tighter padding); ≥44pt touch targets via hitSlop.
 *  - The travel connector moved to itinerary/TravelConnector, which fixes
 *    the destination-less transit link (`nextStop`).
 *
 * M5 Y2.4: the thumbnail is a `PlaceThumb` slot (own memory photo → lazy,
 * on-screen-only Google photo → category tile in the day colour), the card
 * uses the shared `raised` surface, and every string is translated
 * (`trip:row.*`; machine categories via `trip:category.*`).
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { dayColor, surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { ReactionChip } from '@/components/ReactionChip';
import { formatDuration } from '@/lib/formatDuration';
import type { DirectionsPoint } from '@/lib/directions';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { TransportMode, TripLeg, TripPlace } from '@/api';
import type { TripPlaceReactionType } from '@/api/trip-place-reactions';
import { PlaceNotesEditor } from './NotesEditors';
import { PlaceThumb } from './PlaceThumb';
import { useCategoryLabel } from './placeCategory';
import { formatClockTime, parseTimeOfDay } from './computeDayTimeline';
import { TravelConnector } from './itinerary/TravelConnector';

export interface PlaceRowProps {
  place: TripPlace;
  dragging: boolean;
  legAfter: TripLeg | undefined;
  hasNext: boolean;
  transportMode: TransportMode;
  onOpenDetails: () => void;
  /** Phase 25 Step 25.10: role gate — viewers see notes read-only; owners + editors can edit. */
  canEdit?: boolean;
  reaction?: TripPlaceReactionType | null;
  onReactionChange?: (next: TripPlaceReactionType | null) => void;
  /**
   * v2 N1 1.2: computed arrival/departure clock labels for this stop.
   * Null/undefined hides the chip (unscheduled "Ideas" rows have no timeline).
   * v2 P1.1b extras (prebuilt strings): `waitUntil`, `warning`.
   */
  timeline?: {
    arrival: string;
    departure: string;
    waitUntil?: string | null;
    warning?: string | null;
    /** T1: non-null when the user pinned this stop's arrival ("14:00"). */
    pinnedAt?: string | null;
  } | null;
  /** v2 N1 1.7: comment count for the badge (0 shows the bare affordance). */
  commentCount?: number;
  /** v2 N1 1.7: opens the comment thread sheet. Chip hidden when absent. */
  onOpenComments?: () => void;
  /**
   * v2 S2.8.13 (F4): opens PlaceActionsSheet. Renders a web-only kebab (⋮)
   * in the chip rail — mouse users have no long-press. Hidden when absent.
   */
  onOpenActions?: () => void;
  /**
   * v2 S2.6 (sync flag-gated): true while this row's OFFLINE reorder awaits
   * its next route recompute. Defaults to false (flag-off renders unchanged).
   */
  pendingRecompute?: boolean;
  /**
   * v2 M4 X2.3: the next stop in this day — destination of the transit
   * "Plan transit ↗" link (resolved by ItineraryTab). Absent → link hidden.
   */
  nextStop?: DirectionsPoint | null;
  /**
   * v2 M4 X2.3: long-press on the card (drag pickup + actions, forwarded by
   * DraggableItinerary). The full-card underlay is the innermost pressable,
   * so it carries the gesture itself.
   */
  onLongPress?: () => void;
  /**
   * M5 Y2.4: the user's own memory photo thumbnail for this place (signed
   * URL). Wins over the Google photo in the thumbnail slot. Wave 3 wires it.
   */
  memoryThumbUri?: string | null;
}

export function PlaceRow({
  place,
  dragging,
  legAfter,
  hasNext,
  transportMode,
  onOpenDetails,
  canEdit = true,
  reaction,
  onReactionChange,
  timeline,
  commentCount = 0,
  onOpenComments,
  onOpenActions,
  pendingRecompute = false,
  nextStop,
  onLongPress,
  memoryThumbUri,
}: PlaceRowProps) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  // v2 M4 X2.3: denser card on phones (one-handed scanning).
  const compact = useBreakpoint() === 'mobile';
  const title = place.user_title ?? tx('row.untitled');
  const visitLabel = formatDuration(place.visit_duration_minutes);
  const categoryLabel = useCategoryLabel(place.category);

  return (
    <View style={{ gap: compact ? 2 : t.spacing.xs }}>
      <View
        style={[
          styles.placeCard,
          surfaceStyle(t, 'raised'),
          {
            padding: compact ? t.layout.cardPaddingCompact : t.spacing.md,
            opacity: dragging ? 0.85 : 1,
            // Slim day-color rail keeps the map↔list color link.
            borderLeftWidth: 3,
            borderLeftColor: dayColor(place.day_index ?? -1),
          },
        ]}
      >
        {/* Full-card open-details target (X2.3). Rendered FIRST so it sits
            beneath the content; the content layer lets taps through. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            Platform.OS === 'web'
              ? // Web: the kebab is the actions affordance — don't teach
                // mouse users a long-press gesture they don't have.
                tx('row.openDetails', { title })
              : tx('row.openDetailsNative', { title })
          }
          onPress={onOpenDetails}
          onLongPress={onLongPress}
          delayLongPress={180}
          style={({ pressed }) => [
            StyleSheet.absoluteFill,
            {
              borderRadius: t.radius.lg,
              backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
            },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        />

        <View style={[styles.cardRow, { pointerEvents: 'box-none' }]}>
          {/* Read-only content: taps fall through to the underlay. */}
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: compact ? 8 : 10,
              pointerEvents: 'none',
            }}
          >
            {!dragging ? (
              <PlaceThumb
                dayIndex={place.day_index}
                category={place.category}
                size={compact ? 44 : 52}
                googlePlaceId={place.google_place_id}
                memoryThumbUri={memoryThumbUri}
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text
                style={[t.typography.bodyStrong, { color: t.colors.text }]}
                numberOfLines={compact ? 2 : undefined}
              >
                {title}
              </Text>
              {compact ? (
                <Text
                  style={[t.typography.small, { color: t.colors.textMuted }]}
                  numberOfLines={1}
                  accessibilityLabel={tx('row.metaA11y', {
                    category: categoryLabel,
                    minutes: place.visit_duration_minutes,
                  })}
                >
                  {tx('row.meta', { category: categoryLabel, duration: visitLabel })}
                </Text>
              ) : (
                <>
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                    {categoryLabel}
                  </Text>
                  {/* Step 23.8: Visit duration label */}
                  <View style={styles.iconLine}>
                    <Icon name="timer" size={13} color={t.colors.textMuted} />
                    <Text
                      style={[t.typography.caption, { color: t.colors.textMuted }]}
                      accessibilityLabel={tx('row.visitA11y', { minutes: place.visit_duration_minutes })}
                    >
                      {tx('row.visit', { duration: visitLabel })}
                    </Text>
                  </View>
                </>
              )}
              <TimeChips place={place} timeline={timeline} pendingRecompute={pendingRecompute} />
            </View>
          </View>

          {/* Right rail: comment chip (N1 1.7) + reaction chip (Phase 24) +
              web-only kebab (S2.8.13 F4). Siblings of the open-details
              underlay — never its children — so the web DOM stays free of
              nested <button> elements. */}
          <View style={[styles.chipRail, { pointerEvents: 'box-none' }]}>
            {onOpenComments ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  commentCount > 0
                    ? tx('row.comments', { count: commentCount, title })
                    : tx('row.noComments', { title })
                }
                onPress={onOpenComments}
                // 32pt chip + 6pt vertical slop = 44pt target.
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                style={({ pressed }) => [
                  styles.commentChip,
                  {
                    backgroundColor: t.colors.bgMuted,
                    borderRadius: t.radius.pill,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Icon name="message-circle" size={13} color={t.colors.textMuted} />
                {commentCount > 0 ? (
                  <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
                    {commentCount}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
            {onReactionChange ? (
              <ReactionChip
                reaction={reaction ?? null}
                onChange={onReactionChange}
                accentColor={dayColor(place.day_index ?? -1)}
                size="sm"
              />
            ) : null}
            {onOpenActions && Platform.OS === 'web' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tx('row.actions')}
                onPress={onOpenActions}
                // styles.actionsKebab enforces the 44px minimum touch target.
                style={({ pressed }) => [
                  styles.actionsKebab,
                  {
                    borderRadius: t.radius.pill,
                    backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                  },
                  { cursor: 'pointer' } as ViewStyle,
                ]}
              >
                <Icon name="ellipsis-vertical" size={18} color={t.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Per-place notes editor (Step 9.4 / Phase 25 Step 25.10) */}
      {!dragging ? <PlaceNotesEditor place={place} canEdit={canEdit} /> : null}

      {/* Step 23.8: Travel connector — two distinct labeled time values */}
      {hasNext ? (
        <View style={[styles.travelConnector, { paddingHorizontal: 12 }]}>
          <TravelConnector
            legAfter={legAfter}
            transportMode={transportMode}
            from={{ lat: place.lat, lng: place.lng, placeId: place.google_place_id, label: place.user_title }}
            to={nextStop}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Timeline / window / wait / pending / warning chips (v2 N1 1.2 + P1.1 +
 * S2.6). Presentational only — every string is prebuilt by ItineraryTab
 * except the window label, derived from the row's own columns.
 */
function TimeChips({
  place,
  timeline,
  pendingRecompute,
}: {
  place: TripPlace;
  timeline: PlaceRowProps['timeline'];
  pendingRecompute: boolean;
}) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  const windowStart = parseTimeOfDay(place.arrive_after);
  const windowEnd = parseTimeOfDay(place.leave_before);
  const from = windowStart !== null ? formatClockTime(windowStart) : null;
  const to = windowEnd !== null ? formatClockTime(windowEnd) : null;
  const windowLabel =
    from && to
      ? tx('row.window.range', { from, to })
      : from
        ? tx('row.window.from', { time: from })
        : to
          ? tx('row.window.until', { time: to })
          : null;
  const windowA11y =
    from && to
      ? tx('row.window.rangeA11y', { from, to })
      : from
        ? tx('row.window.fromA11y', { time: from })
        : to
          ? tx('row.window.untilA11y', { time: to })
          : null;

  if (!timeline && !windowLabel && !pendingRecompute) return null;

  const muted = [styles.timelineChip, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }];
  const mutedText = [t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' as const }];

  return (
    <View style={styles.timeChipRow}>
      {timeline ? (
        <View
          style={[
            styles.timelineChip,
            {
              backgroundColor: t.colors.gradientSubtle,
              borderRadius: t.radius.pill,
              // T1: pinned arrivals read as deliberate — primary outline.
              borderWidth: timeline.pinnedAt ? 1 : 0,
              borderColor: timeline.pinnedAt ? t.colors.primary : 'transparent',
            },
          ]}
          accessible
          accessibilityLabel={
            timeline.pinnedAt
              ? tx('row.pinnedA11y', { time: timeline.pinnedAt, departure: timeline.departure })
              : tx('row.arrivesA11y', { arrival: timeline.arrival, departure: timeline.departure })
          }
        >
          {timeline.pinnedAt ? <Icon name="pin" size={11} color={t.colors.primary} /> : null}
          <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '600' }]}>
            {timeline.arrival}
            {' → '}
            {timeline.departure}
          </Text>
        </View>
      ) : null}

      {windowLabel ? (
        <View style={muted} accessible accessibilityLabel={windowA11y ?? undefined}>
          <Icon name="alarm-clock" size={12} color={t.colors.textMuted} />
          <Text style={mutedText}>{windowLabel}</Text>
        </View>
      ) : null}

      {timeline?.waitUntil ? (
        <View
          style={muted}
          accessible
          accessibilityLabel={tx('row.waitA11y', { time: timeline.waitUntil })}
        >
          <Icon name="hourglass" size={12} color={t.colors.textMuted} />
          <Text style={mutedText}>{tx('row.wait', { time: timeline.waitUntil })}</Text>
        </View>
      ) : null}

      {/* v2 S2.6: offline reorder saved; travel times refresh with the next
          route recompute. Muted info pill — never a warning. */}
      {pendingRecompute ? (
        <View
          style={muted}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={tx('row.pendingA11y')}
        >
          <Text style={mutedText}>{tx('row.pending')}</Text>
        </View>
      ) : null}

      {/* v2 P1.1b: window conflict — amber, NON-BLOCKING */}
      {timeline?.warning ? (
        <View
          style={[styles.timelineChip, { backgroundColor: t.colors.warningLight, borderRadius: t.radius.pill }]}
          accessible
          accessibilityLabel={tx('row.warningA11y', { warning: timeline.warning })}
        >
          <Icon name="alert-triangle" size={12} color={t.colors.warningText} />
          <Text style={[t.typography.caption, { color: t.colors.warningText, fontWeight: '600' }]}>
            {timeline.warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeCard: { position: 'relative' },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // wrapping row of time chips (timeline, window, wait, warning)
  timeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  // shared base for ALL time chips — one chip language
  timelineChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // right-side chip rail (comments + reaction + web kebab)
  chipRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 32,
    minWidth: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // web-only place-actions kebab — 44px minimum target (WCAG 2.5.8 / HIG)
  actionsKebab: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
  },
});
