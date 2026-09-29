/**
 * TripCover — a trip's cover image, shared by the trips-list card and the
 * trip hero (M5 Y2.4).
 *
 * Source order:
 *   1. The Google cover (`trips.cover_photo_google_place_id`): one
 *      place-details call with the `photos`-only mask, cached for an hour,
 *      and the signed place-photo URL (Tier-2 memory only, Google ToS).
 *   2. Otherwise — or while that has no photo, or it fails — the bundled
 *      generated cover picked from the trip id (`tripCovers.ts`).
 * A neutral well shows while the Google lookup is in flight, so a trip with
 * a real cover never flashes the fallback first.
 *
 * The image layer is decorative (hidden from assistive tech). `children`
 * render above the image and the optional bottom scrim, which is what makes
 * white hero text hold AA over any photo (see `heroScrim` in tokens.ts).
 *
 * Sizing: the frame clips (`overflow: hidden`) and the image fills it with
 * explicit 100% sizes. React Native Web otherwise sizes a bundled image
 * from its intrinsic dimensions and it spills over the card below (the
 * pre-Y2.4 trips-list bug).
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { useTheme } from '@/theme';
import { fallbackCoverFor } from './tripCovers';

export type CoverScrim = 'none' | 'soft' | 'hero';

export interface TripCoverProps {
  tripId: string;
  /** `trips.cover_photo_google_place_id`; null → the generated cover. */
  coverPlaceId?: string | null;
  /** Requested photo width in px (place-photo snaps it to 200/400/800/1600). */
  photoWidth?: number;
  /** Frame style — the caller sets the height (or aspect ratio) and radius. */
  style?: StyleProp<ViewStyle>;
  /**
   * Bottom scrim: `soft` grounds a card edge; `hero` darkens the top edge for
   * buttons and the bottom ~45% for white text.
   */
  scrim?: CoverScrim;
  /** testID on the generated-cover image (tests query it). */
  fallbackTestID?: string;
  children?: ReactNode;
}

export function TripCover({
  tripId,
  coverPlaceId,
  photoWidth = 800,
  style,
  scrim = 'none',
  fallbackTestID,
  children,
}: TripCoverProps) {
  const t = useTheme();
  return (
    <View style={[styles.frame, { backgroundColor: t.colors.bgMuted }, style]}>
      <View
        style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {coverPlaceId ? (
          <GoogleCover
            placeId={coverPlaceId}
            tripId={tripId}
            width={photoWidth}
            fallbackTestID={fallbackTestID}
          />
        ) : (
          <FallbackImage tripId={tripId} testID={fallbackTestID} />
        )}
        {scrim !== 'none' ? <Scrim kind={scrim} /> : null}
      </View>
      {children}
    </View>
  );
}

function GoogleCover({
  placeId,
  tripId,
  width,
  fallbackTestID,
}: {
  placeId: string;
  tripId: string;
  width: number;
  fallbackTestID?: string;
}) {
  const { data, isLoading } = usePlaceDetails({ placeId, fields: ['photos'] });
  const photoName = data?.photos?.[0]?.name ?? null;
  const { url } = usePlacePhotoUrl(photoName, { maxWidthPx: width });
  if (isLoading) return null; // the neutral well shows
  if (!url) return <FallbackImage tripId={tripId} testID={fallbackTestID} />;
  return <Image source={{ uri: url }} style={styles.fill} contentFit="cover" transition={250} />;
}

function FallbackImage({ tripId, testID }: { tripId: string; testID?: string }) {
  return (
    <Image
      source={fallbackCoverFor(tripId)}
      style={styles.fill}
      contentFit="cover"
      transition={150}
      testID={testID}
    />
  );
}

function Scrim({ kind }: { kind: Exclude<CoverScrim, 'none'> }) {
  const t = useTheme();
  if (kind === 'soft') {
    return (
      <LinearGradient
        colors={['transparent', t.colors.heroOverlay]}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <LinearGradient
      colors={[t.colors.heroOverlay, 'transparent', 'transparent', t.colors.heroScrim, t.colors.heroScrim]}
      locations={[0, 0.3, 0.38, 0.78, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', position: 'relative' },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
