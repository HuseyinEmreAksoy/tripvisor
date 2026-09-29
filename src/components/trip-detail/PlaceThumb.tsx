/**
 * PlaceThumb — the square thumbnail slot on an itinerary row (M5 Y2.4).
 *
 * Always renders the same-size tile, so rows never jump:
 *   1. the user's OWN memory photo thumbnail when one exists
 *      (`memoryThumbUri`, wired by the Wave-3 memories step);
 *   2. otherwise the place's Google photo — but only when cheap: the fetch
 *      starts once the row has actually been on screen (`useSeenOnScreen`),
 *      reuses the photos-only place-details cache the trip cards share, and
 *      stops for the whole session after the first error (the per-user
 *      place_details quota, offline). `ROW_GOOGLE_PHOTOS` turns it off in one
 *      place. Photo URLs stay memory-only (Tier-2, Google ToS);
 *   3. underneath / meanwhile: a category icon on the day's tint, so the row
 *      still carries the map ↔ list day colour.
 * Decorative: hidden from assistive tech (the row names the place).
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { dayColor, dayTint, useTheme } from '@/theme';
import { Icon } from '@/components/Icon';
import { usePlaceDetails } from '@/api/places';
import { usePlacePhotoUrl } from '@/api/place-photos';
import { useSeenOnScreen } from '@/hooks/useSeenOnScreen';
import { categoryIcon } from './placeCategory';

export { categoryIcon };

/** Kill switch for Google photos in rows (category tiles remain). */
// Off (orchestrator decision 2026-09-29): Google Place Photos require author
// attribution next to the image, which dense rows cannot show, and each row
// spends place-details quota. Rows use own memory photos or category tiles.
export const ROW_GOOGLE_PHOTOS = false;

let rowPhotosFailed = false;
/** Test hook: re-enable row photos after a simulated failure. */
export function resetRowPhotoKillSwitch(): void {
  rowPhotosFailed = false;
}

export interface PlaceThumbProps {
  dayIndex: number | null;
  category: string | null;
  size: number;
  /** The user's own memory photo thumbnail (signed URL), when there is one. */
  memoryThumbUri?: string | null;
  /** Google place id — enables the lazy Google photo upgrade. */
  googlePlaceId?: string | null;
}

export function PlaceThumb({ dayIndex, category, size, memoryThumbUri, googlePlaceId }: PlaceThumbProps) {
  const t = useTheme();
  const wantsGoogle = ROW_GOOGLE_PHOTOS && !memoryThumbUri && Boolean(googlePlaceId) && !rowPhotosFailed;
  const { ref, onLayout, seen } = useSeenOnScreen<View>({ enabled: wantsGoogle });
  const dark = t.name === 'dark';

  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.26),
          backgroundColor: dayTint(dayIndex, t.name),
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Icon
        name={categoryIcon(category)}
        size={Math.round(size * 0.44)}
        // Light: the day colour on its tint; dark: ink on the stronger tint.
        color={dark ? t.colors.text : dayColor(dayIndex)}
      />
      {memoryThumbUri ? (
        <Image source={{ uri: memoryThumbUri }} style={styles.fill} contentFit="cover" transition={150} />
      ) : wantsGoogle && seen && googlePlaceId ? (
        <GooglePhoto placeId={googlePlaceId} />
      ) : null}
    </View>
  );
}

function GooglePhoto({ placeId }: { placeId: string }) {
  // Same key as the trip cards' cover lookup ([details, ['photos']]) → shared cache.
  const { data, error } = usePlaceDetails({ placeId, fields: ['photos'], enabled: !rowPhotosFailed });
  useEffect(() => {
    if (error) rowPhotosFailed = true;
  }, [error]);
  const name = data?.photos?.[0]?.name ?? null;
  const { url } = usePlacePhotoUrl(name, { maxWidthPx: 200 });
  if (!url) return null;
  return <Image source={{ uri: url }} style={styles.fill} contentFit="cover" transition={200} />;
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
