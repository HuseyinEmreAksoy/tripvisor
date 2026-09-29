import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import {
  BackButton,
  Button,
  Heading,
  Icon,
  PoweredByGoogle,
  Screen,
  Skeleton,
  SkeletonGroup,
  themedRefresh,
} from '@/components';
import { ReactionChip } from '@/components/ReactionChip';
import { EmptyState } from '@/components/EmptyState';
import { notFoundArt } from '@/components/emptyStates';
import { usePlaceDetails } from '@/api';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useTripPlaceReaction, useSetTripPlaceReaction } from '@/api/trip-place-reactions';
import { useSession } from '@/api/auth';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { useTripRole } from '@/hooks/useTripRole';
import { PlaceReviewBlock } from '@/components/memories/PlaceReviewBlock';
import type { PlacePhoto, PlaceReview } from '@/api';

// Minimum character count beyond which the "Show more / Show less" toggle
// is offered for a review card. Reviews shorter than this are shown in full.
const REVIEW_TRUNCATE_CHARS = 280;
// numberOfLines passed to the collapsed Text so the card has a natural height
// before the user expands it.
const REVIEW_COLLAPSED_LINES = 5;
// Max number of reviews we render (Google Places API hard limit = 5).
const GOOGLE_REVIEW_LIMIT = 5;
// Place Details is a paid Google call. Pull-to-refresh within this window of
// the last successful fetch just ends the spinner instead of re-billing.
const PULL_REFRESH_MIN_AGE_MS = 5 * 60 * 1000;

export default function PlaceDetailsScreen() {
  // `tripPlaceId` is optionally passed when navigating from a trip context,
  // enabling the reaction control.
  // `tripId` is also optional — required to invalidate the per-trip cache.
  const { placeId, tripPlaceId, tripId } = useLocalSearchParams<{
    placeId: string;
    tripPlaceId?: string;
    tripId?: string;
  }>();
  const goBack = useSafeBack('/trips');
  const t = useTheme();
  const isDesktop = useBreakpoint() === 'desktop';
  const {
    data: place,
    isLoading,
    error,
    refetch,
    isRefetching,
    dataUpdatedAt,
  } = usePlaceDetails({ placeId });
  // Brief spinner for a skipped (data still fresh) pull, so the gesture
  // still gets visible feedback and the native control always settles.
  const [skippedPull, setSkippedPull] = useState(false);
  const onPullRefresh = () => {
    if (dataUpdatedAt > 0 && Date.now() - dataUpdatedAt < PULL_REFRESH_MIN_AGE_MS) {
      setSkippedPull(true);
      setTimeout(() => setSkippedPull(false), 350);
      return;
    }
    void refetch();
  };
  // Desktop: a readable centered column instead of a full-bleed stretch.
  const column = [
    { padding: t.spacing.lg, gap: t.spacing.md },
    isDesktop && styles.desktopColumn,
  ];

  // Phase 24 Step 24.4: reaction control — only shown when reached from a trip context.
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: currentReaction } = useTripPlaceReaction(tripPlaceId, currentUserId);
  const setReaction = useSetTripPlaceReaction();

  const hasTripContext = Boolean(tripPlaceId && tripId);
  // M5 Y3.1: the user's own rating & review (any trip member may write one).
  const { t: tx } = useT('memories');
  const { t: txPlace } = useT('place');
  const { role: tripRole, isLoading: roleLoading } = useTripRole(hasTripContext ? tripId : undefined);

  if (isLoading) {
    return (
      <Screen padded={false}>
        <View style={column}>
          <BackButton onPress={goBack} />
          <PlaceDetailSkeleton />
        </View>
      </Screen>
    );
  }

  if (error || !place) {
    return (
      <Screen padded={false}>
        <View style={column}>
          <BackButton onPress={goBack} />
          <EmptyState
            illustration={notFoundArt}
            title={txPlace('detail.loadError.title')}
            body={txPlace('detail.loadError.body')}
            action={
              <View style={{ gap: t.spacing.sm, alignSelf: 'stretch' }}>
                <Button
                  label={txPlace('detail.loadError.retry')}
                  onPress={() => void refetch()}
                  loading={isRefetching}
                />
                <Button variant="secondary" label={txPlace('detail.loadError.back')} onPress={goBack} />
              </View>
            }
          />
        </View>
      </Screen>
    );
  }

  const renderedReviews = place.reviews.slice(0, GOOGLE_REVIEW_LIMIT);
  const totalCount = place.userRatingCount;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={column}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || skippedPull}
            onRefresh={onPullRefresh}
            {...themedRefresh(t)}
          />
        }
      >
        <BackButton onPress={goBack} />

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

        {hasTripContext && tripId && tripPlaceId ? (
          <PlaceReviewBlock
            tripId={tripId}
            tripPlaceId={tripPlaceId}
            canWrite={tripRole !== null || roleLoading}
            isOwner={tripRole === 'owner'}
          />
        ) : null}

        {place.rating != null ? (
          <View style={styles.ratingRow}>
            <Icon name="star" size={18} color={t.colors.warning} />
            <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
              {place.rating.toFixed(1)}
              {place.userRatingCount != null ? (
                <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
                  {' '}
                  ({place.userRatingCount.toLocaleString('en-GB')} reviews)
                </Text>
              ) : null}
            </Text>
          </View>
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
            <Heading level={3}>{tx('review.googleHeading')}</Heading>
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
              <ExternalLink
                url={place.websiteUri}
                label={`Website: ${place.websiteUri}`}
                accessibilityLabel={`Open website for ${place.displayName}`}
              />
            ) : null}
            {place.googleMapsUri ? (
              <ExternalLink
                url={place.googleMapsUri}
                label="View on Google Maps"
                accessibilityLabel={`View ${place.displayName} on Google Maps`}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Tappable external URL — opens in the browser / Maps app. */
function ExternalLink({
  url,
  label,
  accessibilityLabel,
}: {
  url: string;
  label: string;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens outside the app"
      onPress={() => {
        Linking.openURL(url).catch(() => {
          // No handler for this URL on the device — nothing to recover.
        });
      }}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text
        style={[
          t.typography.body,
          styles.linkText,
          { color: t.colors.primaryInk, textDecorationLine: 'underline' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Icon name="external-link" size={16} color={t.colors.primaryInk} />
    </Pressable>
  );
}

function PhotoCard({ photo }: { photo: PlacePhoto }) {
  const t = useTheme();
  // Proxied through the `place-photo` Edge Function — no Google key on the client.
  const { url: photoUrl } = usePlacePhotoUrl(photo.name, { maxWidthPx: 600 });
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
          <View style={styles.ratingRow}>
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {review.relativePublishTimeDescription} ·
            </Text>
            <Icon name="star" size={12} color={t.colors.warning} />
            <Text
              style={[t.typography.small, { color: t.colors.textMuted }]}
              accessibilityLabel={`Rated ${review.rating.toFixed(1)} of 5`}
            >
              {review.rating.toFixed(1)}
            </Text>
          </View>
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
          style={({ pressed }) => [styles.reviewToggle, pressed && { opacity: 0.6 }]}
        >
          <Text style={[t.typography.caption, { color: t.colors.primaryInk }]}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Loading placeholder shaped like the real screen (title, address, rating,
 * photo strip, two review cards) so the layout doesn't jump on arrival. */
function PlaceDetailSkeleton() {
  const t = useTheme();
  return (
    <SkeletonGroup label="Loading place details" style={{ gap: t.spacing.md }}>
      <Skeleton width="70%" height={34} />
      <Skeleton width="90%" height={18} />
      <Skeleton width={140} height={20} />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <Skeleton width={200} height={140} />
        <Skeleton width={200} height={140} />
      </View>
      <Skeleton height={110} radius="lg" />
      <Skeleton height={110} radius="lg" />
    </SkeletonGroup>
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
    label = `Showing ${rendered} of ${total.toLocaleString('en-GB')} reviews (Google API limit)`;
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

const styles = StyleSheet.create({
  photo: { width: 200, height: 140 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  reviewCard: { borderWidth: 1 },
  // Step 23.6: minimum 44px touch target for the toggle.
  reviewToggle: { marginTop: 6, minHeight: 44, justifyContent: 'center' },
  // Phase 24 Step 24.4: reaction control container.
  reactionContainer: { borderWidth: 1 },
  link: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  linkText: { flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  desktopColumn: { width: '100%', maxWidth: 760, alignSelf: 'center' },
});
