/**
 * encode.native.ts — iOS/Android re-encoder on expo-image-manipulator
 * (SDK 54, v14 contextual API). Metro picks this over encode.ts on native.
 *
 * EXIF: the manipulator decodes the source to a bitmap and saves a NEW JPEG
 * (iOS UIImageJPEGRepresentation / Android Bitmap.compress): neither writes
 * the source's EXIF, so GPS is gone after this step. pipeline.ts then strips
 * and verifies the bytes anyway (exif.ts) — the upload gate does not trust
 * the platform encoder.
 * ORIENTATION: the manipulator's loader applies the EXIF orientation when it
 * decodes, so the saved pixels are upright even though the orientation tag
 * itself is dropped (verify on a device: rotate-tagged portrait photos from
 * the camera roll must upload upright — docs/v2 "what to try").
 *
 * The picker's original file (asset.uri) is only READ here; it is never
 * uploaded or copied into the queue. Intermediate files the manipulator
 * writes to the cache directory are deleted right after reading them.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageRef } from 'expo-image-manipulator';
import type { PickedPhoto } from '../../api/memories.types';
import { base64ToBytes } from './base64';
import { exifDateToIso, readJpegExif, takenAtFromPickerExif } from './exif';
import { PhotoEncodeError, fitWithin, type DecodedPhoto, type EncodedJpeg } from './encode.types';

function deleteCacheFile(uri: string | undefined): void {
  if (!uri) return;
  try {
    // Lazy: keep expo-file-system off this module's import graph for tests.
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // best-effort — the OS may clear the cache directory anyway
  }
}

/**
 * Capture date when the picker gave no EXIF object (the caller did not pass
 * `exif: true`): parse the ORIGINAL file's EXIF locally (date only). JPEG
 * only; any failure (content:// URI, HEIC, unreadable) → null.
 */
async function takenAtFromFile(source: PickedPhoto): Promise<string | null> {
  const isJpeg = /jpe?g/i.test(source.mimeType ?? '') || /\.jpe?g$/i.test(source.uri);
  if (!isJpeg) return null;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const bytes = await new File(source.uri).bytes();
    const exif = readJpegExif(bytes);
    return exifDateToIso(exif?.dateTimeOriginal ?? null, exif?.offsetTimeOriginal ?? null);
  } catch {
    return null;
  }
}

export async function decodePhoto(source: PickedPhoto): Promise<DecodedPhoto> {
  const takenAt = takenAtFromPickerExif(source.exif ?? null) ?? (await takenAtFromFile(source));
  let original: ImageRef;
  try {
    original = await ImageManipulator.manipulate(source.uri).renderAsync();
  } catch (e) {
    throw new PhotoEncodeError('unsupported_image', `cannot decode ${source.mimeType ?? 'image'}: ${String(e)}`);
  }
  const width = original.width;
  const height = original.height;
  const resized = new Map<number, ImageRef>();
  let released = false;

  async function refFor(maxEdge: number): Promise<{ ref: ImageRef; width: number; height: number }> {
    const size = fitWithin(width, height, maxEdge);
    if (size.width === width && size.height === height) return { ref: original, ...size };
    let ref = resized.get(maxEdge);
    if (!ref) {
      ref = await ImageManipulator.manipulate(original).resize({ width: size.width, height: size.height }).renderAsync();
      resized.set(maxEdge, ref);
    }
    return { ref, width: ref.width, height: ref.height };
  }

  return {
    width,
    height,
    takenAt,
    async encodeJpeg(maxEdge: number, quality: number): Promise<EncodedJpeg> {
      if (released) throw new Error('[photos] decoded photo already released');
      const { ref, width: w, height: h } = await refFor(maxEdge);
      const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      deleteCacheFile(saved.uri);
      if (!saved.base64) throw new PhotoEncodeError('unsupported_image', 'encoder returned no data');
      return { bytes: base64ToBytes(saved.base64), width: saved.width || w, height: saved.height || h };
    },
    release() {
      if (released) return;
      released = true;
      for (const ref of resized.values()) {
        try {
          ref.release();
        } catch {
          // already released
        }
      }
      try {
        original.release();
      } catch {
        // already released
      }
    },
  };
}
