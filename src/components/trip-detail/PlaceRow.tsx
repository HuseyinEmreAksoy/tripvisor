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
 */
import { Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
// Direct types import: keeps the map runtime out of this module graph.
import { dayColor } from '@/components/Map/types';
import { Icon } from '@/components/Icon';
import { ReactionChip } from '@/components/ReactionChip';
import { formatDuration } from '@/lib/formatDuration';
import type { DirectionsPoint } from '@/lib/directions';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { TransportMode, TripLeg, TripPlace } from '@/api';
import type { TripPlaceReactionType } from '@/api/trip-place-reactions';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { PlaceNotesEditor } from './NotesEditors';
import { formatClockTime, parseTimeOfDay } from './computeDayTimeline';
import { TravelConnector } from './itinerary/TravelConnector';

// ── PlaceThumbnail (Phase 25 Step 25.8) ──────────────────────────────────────
// Square photo for each itinerary row. Uses the same place-details +
// place-photo flow as the TripCard cover. Renders nothing when Google returns
// no photos. Keeps its own Tier-2 hooks — photo URLs are memory-only (ToS).
function PlaceThumbnail({ googlePlaceId, size }: { googlePlaceId: string; size: number }) {
  const { data: details } = usePlaceDetails({
    placeId: googlePlaceId,
    fields: ['photos'],
    enabled: Boolean(googlePlaceId),
  });
  const firstName = details?.photos?.[0]?.name ?? null;
  const { url } = usePlacePhotoUrl(firstName, { maxWidthPx: 100 });
  if (!url) return null;
  return (
    <Image
      source={{ uri: url }}
      style={[styles.placeThumbnail, { width: size, height: size }]}
      resizeMode="cover"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

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
}: PlaceRowProps) {
  const t = useTheme();
  // v2 M4 X2.3: denser card on phones (one-handed scanning).
  const compact = useBreakpoint() === 'mobile';
  const title = place.user_title ?? 'place';
  const visitLabel = formatDuration(place.visit_duration_minutes);

  return (
    <View style={{ gap: compact ? 2 : t.spacing.xs }}>
      <View
        style={[
          styles.placeCard,
          {
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.cardBgSolid,
            padding: compact ? t.spacing.sm + 2 : t.spacing.md,
            opacity: dragging ? 0.85 : 1,
            // Slim day-color rail keeps the map↔list color link.
            borderLeftWidth: 3,
            borderLeftColor: dayColor(place.day_index ?? -1),
            ...t.shadows.sm(t.colors.shadowColor),
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
                `Open details for ${title}.`
              : `Open details for ${title}. Long-press to drag, change day, duration, or delete.`
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
              <PlaceThumbnail googlePlaceId={place.google_place_id} size={compact ? 44 : 52} />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text
                style={[t.typography.bodyStrong, { color: t.colors.text }]}
                numberOfLines={compact ? 2 : undefined}
              >
                {place.user_title ?? 'Place'}
              </Text>
              {compact ? (
                <Text
                  style={[t.typography.small, { color: t.colors.textMuted }]}
                  numberOfLines={1}
                  accessibilityLabel={`${place.category ?? 'Unclassified'}, visit duration ${place.visit_duration_minutes} minutes`}
                >
                  {place.category ?? 'Unclassified'}
                  {' · ⏱ ~'}
                  {visitLabel}
                </Text>
              ) : (
                <>
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                    {place.category ?? 'Unclassified'}
                  </Text>
                  {/* Step 23.8: Visit duration label */}
                  <Text
                    style={[t.typography.caption, { color: t.colors.textMuted }]}
                    accessibilityLabel={`Visit duration ${place.visit_duration_minutes} minutes`}
                  >
                    {'⏱ Visit ~'}
                    {visitLabel}
                  </Text>
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
                    ? `${commentCount} comment${commentCount === 1 ? '' : 's'} on ${title}. Open the thread.`
                    : `No comments yet on ${title}. Start the discussion.`
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
                accessibilityLabel="Place actions"
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
  const windowStart = parseTimeOfDay(place.arrive_after);
  const windowEnd = parseTimeOfDay(place.leave_before);
  const windowLabel =
    windowStart !== null && windowEnd !== null
      ? `${formatClockTime(windowStart)}–${formatClockTime(windowEnd)}`
      : windowStart !== null
        ? `from ${formatClockTime(windowStart)}`
        : windowEnd !== null
          ? `until ${formatClockTime(windowEnd)}`
          : null;
  const windowA11y =
    windowStart !== null && windowEnd !== null
      ? `Time window: arrive after ${formatClockTime(windowStart)}, leave before ${formatClockTime(windowEnd)}`
      : windowStart !== null
        ? `Time window: arrive after ${formatClockTime(windowStart)}`
        : windowEnd !== null
          ? `Time window: leave before ${formatClockTime(windowEnd)}`
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
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            },
          ]}
          accessible
          accessibilityLabel={
            timeline.pinnedAt
              ? `Arrival pinned to ${timeline.pinnedAt}, departs ${timeline.departure}`
              : `Arrives ${timeline.arrival}, departs ${timeline.departure}`
          }
        >
          {timeline.pinnedAt ? <Icon name="pin" size={11} color={t.colors.primary} /> : null}
          <Text style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}>
            {timeline.arrival}
            {' → '}
            {timeline.departure}
          </Text>
        </View>
      ) : null}

      {windowLabel ? (
        <View style={muted} accessible accessibilityLabel={windowA11y ?? undefined}>
          <Text style={mutedText}>
            {'⏰ '}
            {windowLabel}
          </Text>
        </View>
      ) : null}

      {timeline?.waitUntil ? (
        <View
          style={muted}
          accessible
          accessibilityLabel={`Arrives before the time window opens — waits until ${timeline.waitUntil}`}
        >
          <Text style={mutedText}>
            {'⏳ waits until '}
            {timeline.waitUntil}
          </Text>
        </View>
      ) : null}

      {/* v2 S2.6: offline reorder saved; travel times refresh with the next
          route recompute. Muted info pill — never a warning. */}
      {pendingRecompute ? (
        <View
          style={muted}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel="Order saved on this device. Travel times update with the next route recompute once you're back online."
        >
          <Text style={mutedText}>{'⟳ route recompute pending'}</Text>
        </View>
      ) : null}

      {/* v2 P1.1b: window conflict — amber, NON-BLOCKING */}
      {timeline?.warning ? (
        <View
          style={[styles.timelineChip, { backgroundColor: t.colors.warningLight, borderRadius: t.radius.pill }]}
          accessible
          accessibilityLabel={`Warning: ${timeline.warning}. This is just a heads-up — your plan is unchanged.`}
        >
          <Text style={[t.typography.caption, { color: t.colors.warningText, fontWeight: '600' }]}>
            {'⚠ '}
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
  },
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
  placeThumbnail: {
    borderRadius: 12,
    flexShrink: 0,
  },
  travelConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
  },
});
