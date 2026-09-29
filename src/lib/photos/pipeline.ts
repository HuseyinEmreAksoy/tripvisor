/**
 * pipeline.ts — pick → re-encode → strip → verify (M5 Y2.1, ADR-0014 §1).
 *
 *   full   long edge 1600 px, JPEG quality stepped down from 0.75 until the
 *          file is <= 350 KB (target ~300 KB); if even the lowest quality is
 *          too big, the long edge steps down (1280, 1024) and the ladder
 *          repeats. Nothing fits → PhotoEncodeError('image_too_large').
 *   thumb  long edge 400 px, <= 60 KB (typically ~25–40 KB).
 *   both   → stripJpegMetadata → assertNoLocationMetadata. These are the
 *          EXACT bytes the upload queue persists and uploads; the picked
 *          original is never uploaded or stored (privacy policy: EXIF/GPS
 *          never leave the device).
 *
 * The bucket (0036) caps objects at 1 MiB and the author byte cap is 100 MiB,
 * so these targets keep ~300 photos per user within budget.
 */

import type { PickedPhoto } from '../../api/memories.types';
import { assertNoLocationMetadata, stripJpegMetadata } from './exif';
import { PhotoEncodeError, type DecodedPhoto, type PhotoDecoder } from './encode.types';

export const PHOTO_FULL_MAX_EDGE = 1600;
/** Fallback long edges when the ladder cannot reach the byte cap at 1600 px. */
export const PHOTO_FULL_FALLBACK_EDGES: readonly number[] = [1280, 1024];
export const PHOTO_FULL_MAX_BYTES = 350 * 1024;
export const PHOTO_THUMB_MAX_EDGE = 400;
export const PHOTO_THUMB_MAX_BYTES = 60 * 1024;
/** JPEG quality ladder (ADR-0014: start at 0.75, step down). */
export const PHOTO_QUALITY_LADDER: readonly number[] = [0.75, 0.68, 0.6, 0.52, 0.45, 0.38];
export const PHOTO_THUMB_QUALITY_LADDER: readonly number[] = [0.7, 0.6, 0.5, 0.4];

export interface PreparedImage {
  /** Metadata-free JPEG bytes (verified). */
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
}

export interface PreparedPhoto {
  full: PreparedImage;
  thumb: PreparedImage;
  /** From the source EXIF date (the only EXIF value kept), ISO or null. */
  takenAt: string | null;
}

/** Strip + verify one encoder output; a failure here must block the upload. */
export function sanitizeEncodedJpeg(bytes: Uint8Array): Uint8Array {
  let clean: Uint8Array;
  try {
    clean = stripJpegMetadata(bytes);
    assertNoLocationMetadata(clean);
  } catch (e) {
    throw new PhotoEncodeError('exif_strip_failed', e instanceof Error ? e.message : String(e));
  }
  return clean;
}

async function encodeUnder(
  decoded: DecodedPhoto,
  edges: readonly number[],
  ladder: readonly number[],
  maxBytes: number,
): Promise<PreparedImage | null> {
  for (const edge of edges) {
    for (const quality of ladder) {
      const out = await decoded.encodeJpeg(edge, quality);
      const bytes = sanitizeEncodedJpeg(out.bytes);
      if (bytes.length <= maxBytes) return { bytes, width: out.width, height: out.height, quality };
    }
  }
  return null;
}

/**
 * Re-encode one picked photo into the upload-ready full image + thumbnail.
 * `decoder` defaults to the platform encoder (./encode resolves to
 * encode.native.ts / encode.web.ts); tests inject a fake.
 */
export async function preparePhoto(source: PickedPhoto, decoder?: PhotoDecoder): Promise<PreparedPhoto> {
  const decode: PhotoDecoder =
    decoder ?? (require('./encode') as { decodePhoto: PhotoDecoder }).decodePhoto;
  const decoded = await decode(source);
  try {
    const full = await encodeUnder(
      decoded,
      [PHOTO_FULL_MAX_EDGE, ...PHOTO_FULL_FALLBACK_EDGES],
      PHOTO_QUALITY_LADDER,
      PHOTO_FULL_MAX_BYTES,
    );
    if (!full) {
      throw new PhotoEncodeError('image_too_large', `cannot compress below ${PHOTO_FULL_MAX_BYTES} bytes`);
    }
    const thumb = await encodeUnder(decoded, [PHOTO_THUMB_MAX_EDGE, 320], PHOTO_THUMB_QUALITY_LADDER, PHOTO_THUMB_MAX_BYTES);
    if (!thumb) {
      throw new PhotoEncodeError('image_too_large', `cannot compress the thumbnail below ${PHOTO_THUMB_MAX_BYTES} bytes`);
    }
    return { full, thumb, takenAt: decoded.takenAt };
  } finally {
    decoded.release();
  }
}
