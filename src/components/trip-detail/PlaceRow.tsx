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
 * N1 extension points (not yet implemented):
 *  - 1.2 timeline: computed arrival/departure chips mount in the title row /
 *    under the visit-duration label (PlaceRow already receives `legAfter`;
 *    cumulative arrival time will arrive as a new prop from ItineraryTab).
 *  - 1.7 comments: per-place comment entry point mounts below PlaceNotesEditor.
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
}: PlaceRowProps) {
  const t = useTheme();

  const visitLabel = formatDuration(place.visit_duration_minutes);

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
            </View>
            {/* Phase 24 Step 24.3: Reaction chip — right side of row */}
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
      </Pressable>

      {/* ── Per-place notes editor (Step 9.4 / Phase 25 Step 25.10) — Option A inline ── */}
      {!dragging ? (
        <PlaceNotesEditor place={place} canEdit={canEdit} />
      ) : null}

      {/* Step 23.8: Travel connector — two distinct labeled time values */}
      {hasNext ? (
        <View style={[styles.travelConnector, { paddingHorizontal: 12 }]}>
          {transportMode === 'transit' && legAfter ? (
            // Step 23.9: transit mode — show duration + deep-link
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
              <Text
                style={[t.typography.small, { color: t.colors.textMuted }]}
                accessibilityLabel={
                  `Travel to next, approximately ${legAfter ? Math.round(legAfter.duration_seconds / 60) : 0} minutes`
                }
              >
                {'↓ Travel ~'}{legAfter ? formatDurationSeconds(legAfter.duration_seconds) : '—'}
              </Text>
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
