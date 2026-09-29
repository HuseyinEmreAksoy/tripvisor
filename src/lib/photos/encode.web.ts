/**
 * encode.web.ts — browser re-encoder on <canvas> (M5 Y2.1).
 *
 * EXIF: pixels are decoded into a bitmap, drawn onto a canvas and exported
 * with `toBlob('image/jpeg', q)`. A canvas has no notion of the source's
 * metadata, so the exported JPEG carries only a JFIF header — no EXIF, no
 * GPS, no XMP. pipeline.ts still strips + verifies the bytes (exif.ts).
 * ORIENTATION: `createImageBitmap(blob, { imageOrientation: 'from-image' })`
 * (and <img> decoding in current browsers) applies the EXIF orientation, so
 * the canvas pixels are upright before the orientation tag is dropped.
 * FORMATS: whatever the browser can decode (JPEG/PNG/WebP/GIF/AVIF;
 * HEIC only in Safari). Anything else → PhotoEncodeError('unsupported_image')
 * (the UI shows a translated "unsupported photo format" message).
 *
 * The ORIGINAL bytes are read once, locally, to extract the capture date
 * (DateTimeOriginal) — then dropped. They are never uploaded or persisted.
 */

import type { PickedPhoto } from '../../api/memories.types';
import { exifDateToIso, readJpegExif, takenAtFromPickerExif } from './exif';
import { PhotoEncodeError, fitWithin, type DecodedPhoto, type EncodedJpeg } from './encode.types';

type Drawable = CanvasImageSource & { width: number; height: number };

interface LoadedBitmap {
  image: Drawable;
  width: number;
  height: number;
  close(): void;
}

async function sourceBlob(source: PickedPhoto): Promise<Blob> {
  if (source.file) return source.file;
  const res = await fetch(source.uri);
  if (!res.ok) throw new PhotoEncodeError('unsupported_image', `cannot read picked image (HTTP ${res.status})`);
  return res.blob();
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  // Older engines: FileReader fallback.
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

async function loadBitmap(blob: Blob): Promise<LoadedBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img> (e.g. an engine that rejects the options bag)
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new PhotoEncodeError('unsupported_image', 'no image decoder available in this environment');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new PhotoEncodeError('unsupported_image', 'no canvas available in this environment');
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const html = canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => {
    html.toBlob(
      (b) => (b ? resolve(b) : reject(new PhotoEncodeError('unsupported_image', 'canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Draw `image` at `width`×`height` on a white background (JPEG has no alpha:
 * transparent PNG areas would otherwise turn black) and export a JPEG.
 * Exported for the real-browser verification script.
 */
export async function renderJpeg(image: Drawable, width: number, height: number, quality: number): Promise<Uint8Array> {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new PhotoEncodeError('unsupported_image', 'canvas 2d context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await canvasToJpeg(canvas, quality);
  return blobBytes(blob);
}

export async function decodePhoto(source: PickedPhoto): Promise<DecodedPhoto> {
  let blob: Blob;
  try {
    blob = await sourceBlob(source);
  } catch (e) {
    if (e instanceof PhotoEncodeError) throw e;
    throw new PhotoEncodeError('unsupported_image', `cannot read picked image: ${String(e)}`);
  }
  // Capture date: picker EXIF if given, else parse the original JPEG locally.
  let takenAt = takenAtFromPickerExif(source.exif ?? null);
  if (!takenAt) {
    try {
      const exif = readJpegExif(await blobBytes(blob));
      takenAt = exifDateToIso(exif?.dateTimeOriginal ?? null, exif?.offsetTimeOriginal ?? null);
    } catch {
      takenAt = null;
    }
  }
  let bitmap: LoadedBitmap;
  try {
    bitmap = await loadBitmap(blob);
  } catch (e) {
    if (e instanceof PhotoEncodeError) throw e;
    throw new PhotoEncodeError('unsupported_image', `the browser cannot decode this image (${blob.type || 'unknown type'})`);
  }
  if (!(bitmap.width > 0 && bitmap.height > 0)) {
    bitmap.close();
    throw new PhotoEncodeError('unsupported_image', 'image has no pixels');
  }
  let released = false;
  return {
    width: bitmap.width,
    height: bitmap.height,
    takenAt,
    async encodeJpeg(maxEdge: number, quality: number): Promise<EncodedJpeg> {
      if (released) throw new Error('[photos] decoded photo already released');
      const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
      const bytes = await renderJpeg(bitmap.image, size.width, size.height, quality);
      return { bytes, width: size.width, height: size.height };
    },
    release() {
      if (released) return;
      released = true;
      bitmap.close();
    },
  };
}
