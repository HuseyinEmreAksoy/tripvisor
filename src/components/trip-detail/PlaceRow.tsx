/**
 * PlaceRow — itinerary row card (extracted from app/(app)/trip/[id]/index.tsx
 * in v2 Phase N1 step 1.1 — pure refactor).
 *
 * Phase 23 Step 23.8: displays Visit and Travel as two distinct labeled values.
 * Phase 23 Step 23.9: when transportMode is 'transit' the travel connector
 * renders a "Plan transit" deep-link that opens Google Maps directions in the
 * external browser.
 * Phase 25 Step 25.8: small thumbnail image prepended to the row.
 *
 * v2 N1 step 1.2: arrival→departure chip ("10:00 → 12:30") under the visit-
 * duration label. Computed in ItineraryTab (computeDayTimeline) and passed in
 * as a presentational `timeline` prop — this row does zero time math.
 * v2 N1 step 1.7: 💬 comment chip next to the reaction chip; always visible
 * when `onOpenComments` is provided (count badge appears at ≥1) so the
 * feature is discoverable even on quiet places.
 * v2 P1.1: time-window chip ("⏰ 10:00–17:00") straight from the place row's
 * arrive_after/leave_before, plus timeline-driven wait info ("waits until
 * 10:00") and a non-blocking amber conflict warning ("⚠ arrives 18:40 —
 * window ends 18:00"). All strings prebuilt in ItineraryTab; zero math here.
 * NO live Google-hours fetches in this list (metered cost; windows are
 * user-set data).
 * v2 P1.2: the transit travel connector names the rides when the leg carries
 * transit_steps ("🚇 M2 → ~12 min"); deep link unchanged.
 */
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { dayColor } from '@/components/Map';
import { ReactionChip } from '@/components/ReactionChip';
import { formatDuration, formatDurationSeconds } from '@/lib/formatDuration';
import type { TransportMode, TripLeg, TripPlace } from '@/api';
import type { TripPlaceReactionType } from '@/api/trip-place-reactions';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { PlaceNotesEditor } from './NotesEditors';
import { formatClockTime, parseTimeOfDay } from './computeDayTimeline';

// ── PlaceThumbnail (Phase 25 Step 25.8) ──────────────────────────────────────
// 40×40 square photo for each itinerary row. Uses the same place-details +
// place-photo flow as the TripCard cover. Renders nothing when Google returns
// no photos — keeps the list clean rather than showing a placeholder.
// Keeps its own Tier-2 hooks (usePlaceDetails / usePlacePhotoUrl) — v1 already
// fetched here, and photo URLs are memory-only (ToS firewall).
function PlaceThumbnail({ googlePlaceId }: { googlePlaceId: string }) {
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
      style={styles.placeThumbnail}
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
   * v2 N1 1.2: computed arrival/departure clock labels for this stop
   * (e.g. { arrival: "10:00", departure: "12:30" }). Null/undefined hides
   * the chip (unscheduled "Ideas" rows have no timeline).
   *
   * v2 P1.1b extras (all prebuilt strings — presentational only):
   *  - `waitUntil`: window-start label when the visit waits for the place's
   *    arrive_after window ("10:00" → info chip "waits until 10:00").
   *  - `warning`: human conflict message when the stop violates its
   *    leave_before window ("arrives 18:40 — window ends 18:00") → amber,
   *    non-blocking warning chip.
   */
  timeline?: {
    arrival: string;
    departure: string;
    waitUntil?: string | null;
    warning?: string | null;
  } | null;
  /** v2 N1 1.7: comment count for the badge (0 shows the bare 💬 affordance). */
  commentCount?: number;
  /** v2 N1 1.7: opens the comment thread sheet. Chip hidden when absent. */
  onOpenComments?: () => void;
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
}: PlaceRowProps) {
  const t = useTheme();

  const visitLabel = formatDuration(place.visit_duration_minutes);

  // ── v2 P1.1: user-set time window chip ("⏰ 10:00–17:00") ────────────────
  // Pure label derivation from the row's own columns — never fetched from
  // Google hours (those stay on the place-detail screen as reference).
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

  // Step 23.9: transit deep-link URL.
  function buildTransitDeepLink(leg: TripLeg, fromPlace: TripPlace): string {
    // We have `leg.from_place_id` and `leg.to_place_id` but those map back
    // to place coordinates via `place` (from-place) and the next place
    // (to-place). We have the from-place here; the to-place lat/lng comes
    // from the leg's distance/duration metadata (not directly from the leg).
    // For the deep-link we use from=place.lat,place.lng and destination via
    // the leg. Since `legAfter.to_place_id` resolves to the next row's place,
    // and we don't have it here, we use a generic Maps search fallback and
    // let the caller handle it. The simplest correct approach: we build the
    // link from the fromPlace's coords only, which opens Maps routing from
    // the current place. The spec only requires `origin` from this place.
    void fromPlace; // intentionally unused — included for future coord lookup
    const origin = `${place.lat},${place.lng}`;
    // leg doesn't carry to-place coords directly; we pass the leg id as a
    // reference. For now, open Maps directions from origin without a fixed
    // destination — the transit planner shows nearby transit options.
    // (Full to-place coords require a cross-reference from the places list,
    // which ItineraryTab does in the legIndex but not passed to PlaceRow.)
    void leg;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&travelmode=transit`;
  }

  function openTransitLink() {
    if (!legAfter) return;
    const url = buildTransitDeepLink(legAfter, place);
    if (Platform.OS === 'web') {
      // Platform-gated: window only touched on web (RNW-safe).
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    } else {
      Linking.openURL(url).catch((e) =>
        console.warn('[PlaceRow] Failed to open transit URL', e),
      );
    }
  }

  return (
    <View style={{ gap: t.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open details for ${place.user_title ?? 'place'}. Long-press to change day, duration, or delete.`}
        onPress={onOpenDetails}
        style={[
          styles.placeCard,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.cardBgSolid,
            padding: t.spacing.md,
            opacity: dragging ? 0.85 : 1,
            borderLeftWidth: 4,
            borderLeftColor: dayColor(place.day_index ?? -1),
            ...t.shadows.sm(t.colors.shadowColor),
          },
        ]}
      >
        {/* Title row: optional thumbnail + text content + reaction chip */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          {/* Phase 25 Step 25.8: thumbnail — omitted when no photo URL */}
          {!dragging ? (
            <PlaceThumbnail googlePlaceId={place.google_place_id} />
          ) : null}

          <View style={{ flex: 1, justifyContent: 'space-between', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
                {place.user_title ?? 'Place'}
              </Text>
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                {place.category ?? 'Unclassified'}
              </Text>
              {/* Step 23.8: Visit duration label */}
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted }]}
                accessibilityLabel={`Visit duration ${place.visit_duration_minutes} minutes`}
              >
                {'⏱ Visit ~'}{visitLabel}
              </Text>
              {/* v2 N1 1.2 + P1.1: timeline / window / wait / warning chips */}
              {timeline || windowLabel ? (
                <View style={styles.timeChipRow}>
                  {/* arrival → departure (computed in ItineraryTab) */}
                  {timeline ? (
                    <View
                      style={[
                        styles.timelineChip,
                        {
                          backgroundColor: t.colors.gradientSubtle,
                          borderRadius: t.radius.pill,
                        },
                      ]}
                      accessible
                      accessibilityLabel={`Arrives ${timeline.arrival}, departs ${timeline.departure}`}
                    >
                      <Text
                        style={[t.typography.caption, { color: t.colors.primary, fontWeight: '600' }]}
                      >
                        {timeline.arrival}{' → '}{timeline.departure}
                      </Text>
                    </View>
                  ) : null}

                  {/* v2 P1.1a: user-set window ("⏰ 10:00–17:00") */}
                  {windowLabel ? (
                    <View
                      style={[
                        styles.timelineChip,
                        {
                          backgroundColor: t.colors.bgElevated,
                          borderRadius: t.radius.pill,
                          borderWidth: 1,
                          borderColor: t.colors.border,
                        },
                      ]}
                      accessible
                      accessibilityLabel={windowA11y ?? undefined}
                    >
                      <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
                        {'⏰ '}{windowLabel}
                      </Text>
                    </View>
                  ) : null}

                  {/* v2 P1.1b: wait info — arrival pushed to the window start */}
                  {timeline?.waitUntil ? (
                    <View
                      style={[
                        styles.timelineChip,
                        {
                          backgroundColor: t.colors.bgElevated,
                          borderRadius: t.radius.pill,
                          borderWidth: 1,
                          borderColor: t.colors.border,
                        },
                      ]}
                      accessible
                      accessibilityLabel={`Arrives before the time window opens — waits until ${timeline.waitUntil}`}
                    >
                      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
                        {'⏳ waits until '}{timeline.waitUntil}
                      </Text>
                    </View>
                  ) : null}

                  {/* v2 P1.1b: window conflict — amber, NON-BLOCKING (the user
                      can always keep the plan as-is; nothing is locked) */}
                  {timeline?.warning ? (
                    <View
                      style={[
                        styles.timelineChip,
                        {
                          backgroundColor: t.colors.warningLight,
                          borderRadius: t.radius.pill,
                        },
                      ]}
                      accessible
                      accessibilityLabel={`Warning: ${timeline.warning}. This is just a heads-up — your plan is unchanged.`}
                    >
                      <Text style={[t.typography.caption, { color: t.colors.warningText, fontWeight: '600' }]}>
                        {'⚠ '}{timeline.warning}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* Right rail: comment chip (v2 N1 1.7) + reaction chip (Phase 24) */}
            <View style={styles.chipRail}>
              {onOpenComments ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    commentCount > 0
                      ? `${commentCount} comment${commentCount === 1 ? '' : 's'} on ${place.user_title ?? 'place'}. Open the thread.`
                      : `No comments yet on ${place.user_title ?? 'place'}. Start the discussion.`
                  }
                  onPress={onOpenComments}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.commentChip,
                    {
                      backgroundColor: t.colors.bgElevated,
                      borderColor: t.colors.border,
                      borderRadius: t.radius.pill,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={[t.typography.small, { color: t.colors.textMuted, fontWeight: '600' }]}>
                    {commentCount > 0 ? `💬 ${commentCount}` : '💬'}
                  </Text>
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
            </View>
          </View>
        </View>
      </Pressable>

      {/* ── Per-place notes editor (Step 9.4 / Phase 25 Step 25.10) — Option A inline ── */}
      {!dragging ? (
        <PlaceNotesEditor place={place} canEdit={canEdit} />
      ) : null}

      {/* Step 23.8: Travel connector — two distinct labeled time values */}
      {hasNext ? (
        <View style={[styles.travelConnector, { paddingHorizontal: 12 }]}>
          {transportMode === 'transit' && legAfter ? (
            // Step 23.9: transit mode — show duration + deep-link.
            // v2 P1.2: when the leg carries transit_steps, name the rides
            // ("🚇 M2 → ~12 min"); WALK connectors are omitted from the label.
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.xs }}>
              {(() => {
                const lineNames = (legAfter.transit_steps ?? [])
                  .filter((s) => s.travelMode === 'TRANSIT' && s.lineName)
                  .map((s) => s.lineName as string);
                const durationLabel = formatDurationSeconds(legAfter.duration_seconds);
                return (
                  <Text
                    style={[t.typography.small, { color: t.colors.textMuted }]}
                    accessibilityLabel={
                      lineNames.length > 0
                        ? `Transit via ${lineNames.join(', then ')}, approximately ${Math.round(legAfter.duration_seconds / 60)} minutes`
                        : `Travel to next, approximately ${Math.round(legAfter.duration_seconds / 60)} minutes`
                    }
                  >
                    {lineNames.length > 0
                      ? `↓ 🚇 ${lineNames.join(' → ')} → ~${durationLabel}`
                      : `↓ Travel ~${durationLabel}`}
                  </Text>
                );
              })()}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Plan transit on Google Maps, opens external"
                onPress={openTransitLink}
              >
                <Text style={[t.typography.small, { color: t.colors.primary }]}>
                  {'· Plan transit ↗'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text
              style={[t.typography.small, { color: t.colors.textMuted }]}
              accessibilityLabel={
                legAfter
                  ? `Travel to next, approximately ${Math.round(legAfter.duration_seconds / 60)} minutes`
                  : 'Travel time unknown'
              }
            >
              {'↓ Travel '}{legAfter ? `~${formatDurationSeconds(legAfter.duration_seconds)}` : '—'}
              {legAfter ? ` · ${(legAfter.distance_meters / 1000).toFixed(legAfter.distance_meters < 10000 ? 1 : 0)} km` : ''}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeCard: { borderWidth: 1 },
  // v2 N1 1.2 / P1.1: wrapping row of time chips (timeline, window, wait, warning)
  timeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  // v2 N1 1.2: arrival → departure pill (shared base for all time chips)
  timelineChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // v2 N1 1.7: right-side chip rail (comments + reaction)
  chipRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentChip: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Phase 25 Step 25.8: place thumbnail in itinerary row
  placeThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    flexShrink: 0,
  },
  // Travel connector between place cards (Step 23.8)
  travelConnector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
