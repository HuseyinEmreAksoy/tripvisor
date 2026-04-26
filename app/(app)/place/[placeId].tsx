import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { BackButton, Button, Heading, PoweredByGoogle, Screen } from '@/components';
import { ReactionChip } from '@/components/ReactionChip';
import { usePlaceDetails } from '@/api';
import { useTripPlaceReaction, useSetTripPlaceReaction } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
import { useTheme } from '@/theme';
import type { PlacePhoto, PlaceReview } from '@/api';

// Minimum character count beyond which the "Show more / Show less" toggle
// is offered for a review card. Reviews shorter than this are shown in full.
const REVIEW_TRUNCATE_CHARS = 280;
// numberOfLines passed to the collapsed Text so the card has a natural height
// before the user expands it.
const REVIEW_COLLAPSED_LINES = 5;
// Max number of reviews we render (Google Places API hard limit = 5).
const GOOGLE_REVIEW_LIMIT = 5;

export default function PlaceDetailsScreen() {
  // `tripPlaceId` is optionally passed when navigating from a trip context,
  // enabling the reaction control.
  // `tripId` is also optional — required to invalidate the per-trip cache.
  const { placeId, tripPlaceId, tripId } = useLocalSearchParams<{
    placeId: string;
    tripPlaceId?: string;
    tripId?: string;
  }>();
  const router = useRouter();
  const t = useTheme();
  const { data: place, isLoading, error } = usePlaceDetails({ placeId });

  // Phase 24 Step 24.4: reaction control — only shown when reached from a trip context.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: currentReaction } = useTripPlaceReaction(tripPlaceId, currentUserId);
  const setReaction = useSetTripPlaceReaction();

  const hasTripContext = Boolean(tripPlaceId && tripId);

  if (isLoading) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Loading…</Text>
      </Screen>
    );
  }

  if (error || !place) {
    return (
      <Screen>
        <Heading level={2}>Couldn't load place</Heading>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {(error as Error | null)?.message ?? 'Unknown error'}
        </Text>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const renderedReviews = place.reviews.slice(0, GOOGLE_REVIEW_LIMIT);
  const totalCount = place.userRatingCount;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <BackButton onPress={() => router.back()} />

        <Heading level={1}>{place.displayName}</Heading>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {place.formattedAddress}
        </Text>

        {/* Phase 24 Step 24.4: reaction control — only shown in a trip context */}
        {hasTripContext ? (
          <View
            style={[
              styles.reactionContainer,
              {
                backgroundColor: t.colors.bgElevated,
                borderRadius: t.radius.md,
                borderColor: t.colors.border,
                padding: t.spacing.md,
                gap: t.spacing.sm,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {'Did you like it?'}
            </Text>
            <ReactionChip
              reaction={currentReaction?.reaction ?? null}
              size="lg"
              onChange={(next) => {
                if (!tripPlaceId || !tripId) return;
                setReaction.mutate({ tripPlaceId, reaction: next, tripId });
              }}
            />
          </View>
        ) : null}

        {place.rating != null ? (
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            ★ {place.rating.toFixed(1)}
            {place.userRatingCount != null ? (
              <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
                {' '}
                ({place.userRatingCount.toLocaleString()} reviews)
              </Text>
            ) : null}
          </Text>
        ) : null}

        {place.regularOpeningHours ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
              {place.regularOpeningHours.openNow ? 'Open now' : 'Closed now'}
            </Text>
            {place.regularOpeningHours.weekdayDescriptions.map((line) => (
              <Text
                key={line}
                style={[t.typography.small, { color: t.colors.textMuted }]}
              >
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        {place.photos.length ? (
          <View style={{ gap: t.spacing.sm }}>
            <Heading level={3}>Photos</Heading>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                {place.photos.slice(0, 8).map((p) => (
                  <PhotoCard key={p.name} photo={p} />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {/* ── Reviews — with per-card Show more / Show less (Step 23.5 + 23.6) */}
        {renderedReviews.length > 0 ? (
          <View style={{ gap: t.spacing.sm }}>
            <Heading level={3}>Reviews</Heading>
            {renderedReviews.map((r) => (
              <ReviewCard key={r.name} review={r} />
            ))}

            {/* Step 23.5: "N of M reviews (Google API limit)" footer */}
            <ReviewsFooter
              rendered={renderedReviews.length}
              total={totalCount}
            />
          </View>
        ) : null}

        <PoweredByGoogle />

        {place.websiteUri || place.googleMapsUri ? (
          <View style={{ gap: t.spacing.sm, marginTop: t.spacing.md }}>
            {place.websiteUri ? (
              <Text style={[t.typography.body, { color: t.colors.primary }]}>
                Website: {place.websiteUri}
              </Text>
            ) : null}
            {place.googleMapsUri ? (
              <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                View on Google Maps: {place.googleMapsUri}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function PhotoCard({ photo }: { photo: PlacePhoto }) {
  const t = useTheme();
  const photoUrl = buildPhotoUrl(photo.name, 600);
  return (
    <View style={{ gap: 4, width: 200 }}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          accessibilityLabel={`Photo of place by ${photo.attributions[0]?.displayName ?? 'Google user'}`}
          style={[styles.photo, { borderRadius: t.radius.md, backgroundColor: t.colors.bgMuted }]}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={[
            styles.photo,
            { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.md },
          ]}
        />
      )}
      {photo.attributions.slice(0, 1).map((a) => (
        <Text
          key={a.displayName}
          style={[t.typography.small, { color: t.colors.attribution }]}
          numberOfLines={1}
        >
          Photo: {a.displayName}
        </Text>
      ))}
    </View>
  );
}

/**
 * ReviewCard — expandable review card with per-review Show more / Show less.
 *
 * Step 23.5: review body text truncates at REVIEW_TRUNCATE_CHARS characters.
 * The toggle only renders when the text actually exceeds the threshold — short
 * reviews never show the button.
 *
 * Step 23.6: the toggle Pressable carries a correct accessibilityLabel (e.g.
 * "Expand review by Jane Doe") and accessibilityRole="button". Touch target is
 * at least 44 px tall via minHeight on the pressable.
 */
function ReviewCard({ review }: { review: PlaceReview }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);

  const fullText = review.text?.text ?? '';
  // Only offer the toggle when the text actually overflows the limit.
  const isLong = fullText.length > REVIEW_TRUNCATE_CHARS;
  const displayText =
    isLong && !expanded ? fullText.slice(0, REVIEW_TRUNCATE_CHARS) + '…' : fullText;

  const authorName = review.authorAttribution.displayName;

  return (
    <View
      style={[
        styles.reviewCard,
        {
          backgroundColor: t.colors.bgElevated,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          borderColor: t.colors.border,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
        {review.authorAttribution.photoUri ? (
          <Image
            source={{ uri: review.authorAttribution.photoUri }}
            accessibilityLabel={`${authorName}'s profile photo`}
            style={[styles.avatar, { backgroundColor: t.colors.bgMuted }]}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: t.colors.bgMuted }]} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
            {authorName}
          </Text>
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            {review.relativePublishTimeDescription} · ★ {review.rating.toFixed(1)}
          </Text>
        </View>
      </View>

      {fullText ? (
        <Text
          style={[t.typography.body, { color: t.colors.text, marginTop: 8 }]}
          // numberOfLines only applies when collapsed; expanded shows all.
          numberOfLines={expanded ? undefined : REVIEW_COLLAPSED_LINES}
        >
          {displayText}
        </Text>
      ) : null}

      {/* Step 23.5 + 23.6: Show more / Show less toggle — only for long reviews */}
      {isLong ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? `Collapse review by ${authorName}` : `Expand review by ${authorName}`
          }
          onPress={() => setExpanded((v) => !v)}
          style={styles.reviewToggle}
        >
          <Text style={[t.typography.caption, { color: t.colors.primary }]}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * ReviewsFooter — "Showing N of M reviews (Google API limit)" caption.
 *
 * Step 23.5: shows the cap explicitly when M > N (or M is unknown).
 * When M === N the note simplifies to just "Showing N reviews".
 */
function ReviewsFooter({
  rendered,
  total,
}: {
  rendered: number;
  total: number | null;
}) {
  const t = useTheme();

  let label: string;
  if (total == null || total <= rendered) {
    label = `Showing ${rendered} review${rendered !== 1 ? 's' : ''}`;
  } else {
    label = `Showing ${rendered} of ${total.toLocaleString()} reviews (Google API limit)`;
  }

  return (
    <Text
      accessibilityRole="text"
      style={[t.typography.caption, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}
    >
      {label}
    </Text>
  );
}

function buildPhotoUrl(photoName: string, maxWidth: number): string | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const key =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY) ||
    (typeof extra.googleMapsWebKey === 'string' ? (extra.googleMapsWebKey as string) : null);
  if (!key) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${key}`;
}

const styles = StyleSheet.create({
  photo: { width: 200, height: 140 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  reviewCard: { borderWidth: 1 },
  // Step 23.6: minimum 44px touch target for the toggle.
  reviewToggle: { marginTop: 6, minHeight: 44, justifyContent: 'center' },
  // Phase 24 Step 24.4: reaction control container.
  reactionContainer: { borderWidth: 1 },
});
