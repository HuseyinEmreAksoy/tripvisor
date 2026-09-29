/**
 * encode.types.ts — platform-agnostic contract of the photo re-encoder
 * (M5 Y2.1). Implementations:
 *   - encode.native.ts  expo-image-manipulator (iOS / Android)
 *   - encode.web.ts     <canvas> (every browser)
 * Both DECODE the picked image to pixels and write a FRESH JPEG, which is
 * what strips EXIF/GPS; pipeline.ts then strips any metadata segment an
 * encoder might still emit and verifies the bytes before queuing them.
 */

import type { PickedPhoto } from '../../api/memories.types';

export interface EncodedJpeg {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** A decoded source image, encodable at several sizes/qualities. */
export interface DecodedPhoto {
  /** Pixel size AFTER applying the source's EXIF orientation. */
  width: number;
  height: number;
  /** Capture date (ISO) read from the SOURCE before re-encoding; the only EXIF value kept. */
  takenAt: string | null;
  /** Fresh JPEG whose long edge is <= maxEdge (never upscaled). quality 0..1. */
  encodeJpeg(maxEdge: number, quality: number): Promise<EncodedJpeg>;
  /** Free native/bitmap resources. Idempotent. */
  release(): void;
}

export type PhotoDecoder = (source: PickedPhoto) => Promise<DecodedPhoto>;

export type PhotoEncodeErrorCode = 'unsupported_image' | 'image_too_large' | 'exif_strip_failed';

export class PhotoEncodeError extends Error {
  readonly code: PhotoEncodeErrorCode;

  constructor(code: PhotoEncodeErrorCode, message: string) {
    super(`[photos] ${message}`);
    this.name = 'PhotoEncodeError';
    this.code = code;
  }
}

/** Target size for a long edge, never upscaling. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge || long <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
