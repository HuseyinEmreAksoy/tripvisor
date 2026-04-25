import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { BackButton, Button, Heading, PoweredByGoogle, Screen } from '@/components';
import { usePlaceDetails } from '@/api';
import { useTheme } from '@/theme';
import type { PlacePhoto, PlaceReview } from '@/api';

export default function PlaceDetailsScreen() {
  const { placeId } = useLocalSearchParams<{ placeId: string }>();
  const router = useRouter();
  const t = useTheme();
  const { data: place, isLoading, error } = usePlaceDetails({ placeId });

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

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md }}>
        <BackButton onPress={() => router.back()} />

        <Heading level={1}>{place.displayName}</Heading>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          {place.formattedAddress}
        </Text>

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

        {place.reviews.length ? (
          <View style={{ gap: t.spacing.sm }}>
            <Heading level={3}>Reviews</Heading>
            {place.reviews.slice(0, 5).map((r) => (
              <ReviewCard key={r.name} review={r} />
            ))}
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

function ReviewCard({ review }: { review: PlaceReview }) {
  const t = useTheme();
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
            accessibilityLabel={`${review.authorAttribution.displayName}'s profile photo`}
            style={[styles.avatar, { backgroundColor: t.colors.bgMuted }]}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: t.colors.bgMuted }]} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
            {review.authorAttribution.displayName}
          </Text>
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            {review.relativePublishTimeDescription} · ★ {review.rating.toFixed(1)}
          </Text>
        </View>
      </View>
      {review.text?.text ? (
        <Text
          style={[t.typography.body, { color: t.colors.text, marginTop: 8 }]}
          numberOfLines={6}
        >
          {review.text.text}
        </Text>
      ) : null}
    </View>
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
});
