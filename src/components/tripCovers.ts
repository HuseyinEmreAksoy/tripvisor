/**
 * Bundled destination-style fallback covers for trips without a Google cover
 * photo. Generic scenes (no landmarks/text/faces) so any trip can wear one.
 * 800x533 JPEGs, each < 120 KB.
 *
 * M5 Y2.4: cover-7 (river valley at sunrise) and cover-8 (a meze table over
 * the sea) joined the pool. The pick is `hash(trip id) % length`, so adding
 * them re-rolls the fallback of some existing trips once — they are
 * decorative, never user-chosen, so that is acceptable.
 */
import type { ImageSourcePropType } from 'react-native';

export const TRIP_FALLBACK_COVERS: readonly ImageSourcePropType[] = [
  require('../../assets/images/cover-1.jpg'),
  require('../../assets/images/cover-2.jpg'),
  require('../../assets/images/cover-3.jpg'),
  require('../../assets/images/cover-4.jpg'),
  require('../../assets/images/cover-5.jpg'),
  require('../../assets/images/cover-6.jpg'),
  require('../../assets/images/cover-7.jpg'),
  require('../../assets/images/cover-8.jpg'),
];

/** Stable string hash (FNV-1a, 32-bit) — same trip id → same cover everywhere. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function fallbackCoverIndex(tripId: string): number {
  return hashId(tripId) % TRIP_FALLBACK_COVERS.length;
}

export function fallbackCoverFor(tripId: string): ImageSourcePropType {
  // Index is always in range (modulo length); ?? satisfies noUncheckedIndexedAccess.
  return TRIP_FALLBACK_COVERS[fallbackCoverIndex(tripId)] ?? TRIP_FALLBACK_COVERS[0]!;
}
