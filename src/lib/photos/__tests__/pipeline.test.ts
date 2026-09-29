/**
 * M5 Y2.1 — photo pipeline: size targets, EXIF stripping of the bytes that
 * get uploaded, and both platform encoders (web canvas, native
 * expo-image-manipulator) with their platform APIs faked.
 *
 * The fakes deliberately behave like a LEAKY encoder: they return JPEGs that
 * still carry the fixture's EXIF/GPS/XMP/COM segments. The pipeline must
 * strip them anyway — the privacy promise may not depend on the encoder.
 * (Real-browser proof that canvas output carries no EXIF at all:
 * scripts/verify-photo-exif-web.mjs, run with Playwright's Chromium.)
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { inspectJpeg } from '../exif';
import { PhotoEncodeError, type DecodedPhoto, type EncodedJpeg } from '../encode.types';
import {
  PHOTO_FULL_MAX_BYTES,
  PHOTO_QUALITY_LADDER,
  PHOTO_THUMB_MAX_BYTES,
  preparePhoto,
  sanitizeEncodedJpeg,
} from '../pipeline';

const mockFixture = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'gps-exif.jpg')));

/** The fixture (EXIF/GPS included) grown to `size` bytes by padding its scan data. */
function mockLeakyJpegOfSize(size: number): Uint8Array {
  const body = mockFixture.subarray(0, mockFixture.length - 2); // without EOI
  const pad = Math.max(0, size - mockFixture.length);
  const out = new Uint8Array(body.length + pad + 2);
  out.set(body, 0);
  out.fill(0x55, body.length, body.length + pad);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

/** Bytes ∝ pixel area × quality (roughly how JPEG behaves). */
function fakeDecoder(opts: { width: number; height: number; k: number; takenAt?: string | null }) {
  const calls: Array<{ maxEdge: number; quality: number }> = [];
  const release = jest.fn();
  const decoded: DecodedPhoto = {
    width: opts.width,
    height: opts.height,
    takenAt: opts.takenAt ?? null,
    async encodeJpeg(maxEdge: number, quality: number): Promise<EncodedJpeg> {
      calls.push({ maxEdge, quality });
      const scale = Math.min(1, maxEdge / Math.max(opts.width, opts.height));
      const w = Math.round(opts.width * scale);
      const h = Math.round(opts.height * scale);
      return { bytes: mockLeakyJpegOfSize(Math.round(w * h * quality * opts.k)), width: w, height: h };
    },
    release,
  };
  return { decoder: jest.fn(async () => decoded), calls, release };
}

function expectClean(bytes: Uint8Array): void {
  const r = inspectJpeg(bytes);
  expect(r.isJpeg).toBe(true);
  expect(r.hasExif).toBe(false);
  expect(r.hasGps).toBe(false);
  expect(r.hasXmp).toBe(false);
  expect(r.hasComment).toBe(false);
  expect(Buffer.from(bytes).includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
  expect(Buffer.from(bytes).includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false);
}

describe('preparePhoto — size ladder + stripping', () => {
  it('steps quality down from 0.75 until the full image is <= 350 KB, thumb <= 60 KB, EXIF stripped', async () => {
    const { decoder, calls, release } = fakeDecoder({ width: 4000, height: 3000, k: 0.3556, takenAt: '2026-07-14T12:30:00.000Z' });
    const out = await preparePhoto({ uri: 'file:///picked.jpg' }, decoder);
    expect(calls.slice(0, 4).map((c) => c.quality)).toEqual([0.75, 0.68, 0.6, 0.52]);
    expect(calls.slice(0, 4).every((c) => c.maxEdge === 1600)).toBe(true);
    expect(out.full.quality).toBe(0.52);
    expect(out.full.bytes.length).toBeLessThanOrEqual(PHOTO_FULL_MAX_BYTES);
    expect(out.full.bytes.length).toBeGreaterThan(250 * 1024); // near the ~300 KB target, not over-compressed
    expect([out.full.width, out.full.height]).toEqual([1600, 1200]);
    expect([out.thumb.width, out.thumb.height]).toEqual([400, 300]);
    expect(out.thumb.bytes.length).toBeLessThanOrEqual(PHOTO_THUMB_MAX_BYTES);
    expectClean(out.full.bytes);
    expectClean(out.thumb.bytes);
    expect(out.takenAt).toBe('2026-07-14T12:30:00.000Z');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falls back to a smaller long edge when even the lowest quality is too big', async () => {
    const { decoder, calls } = fakeDecoder({ width: 4000, height: 3000, k: 1.2 });
    const out = await preparePhoto({ uri: 'file:///huge.jpg' }, decoder);
    expect(calls.some((c) => c.maxEdge === 1280)).toBe(true);
    expect(out.full.bytes.length).toBeLessThanOrEqual(PHOTO_FULL_MAX_BYTES);
    expect(Math.max(out.full.width, out.full.height)).toBeLessThan(1600);
  });

  it('never upscales a small photo', async () => {
    const { decoder } = fakeDecoder({ width: 800, height: 600, k: 0.3 });
    const out = await preparePhoto({ uri: 'file:///small.jpg' }, decoder);
    expect([out.full.width, out.full.height]).toEqual([800, 600]);
  });

  it('image_too_large when nothing fits (and still releases the decoder)', async () => {
    const { decoder, release } = fakeDecoder({ width: 4000, height: 3000, k: 50 });
    await expect(preparePhoto({ uri: 'file:///x.jpg' }, decoder)).rejects.toMatchObject({ code: 'image_too_large' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(PHOTO_QUALITY_LADDER[0]).toBe(0.75);
  });

  it('exif_strip_failed when an encoder returns something that is not a JPEG (never uploaded)', () => {
    expect(() => sanitizeEncodedJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toThrow(PhotoEncodeError);
    try {
      sanitizeEncodedJpeg(new Uint8Array([1, 2, 3]));
    } catch (e) {
      expect((e as PhotoEncodeError).code).toBe('exif_strip_failed');
    }
  });
});

// ---------------------------------------------------------------------------
// Web encoder (canvas) — platform APIs faked on globalThis
// ---------------------------------------------------------------------------

describe('encode.web (canvas path)', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  let draws: Array<{ w: number; h: number }>;
  let toBlobCalls: Array<{ type: string; quality: number }>;
  let fills: number;
  let bitmapClosed: number;

  beforeEach(() => {
    draws = [];
    toBlobCalls = [];
    fills = 0;
    bitmapClosed = 0;
    for (const k of ['document', 'createImageBitmap']) saved[k] = g[k];
    g['createImageBitmap'] = jest.fn(async (_blob: unknown, opts: unknown) => {
      expect(opts).toEqual({ imageOrientation: 'from-image' });
      return { width: 4032, height: 3024, close: () => void bitmapClosed++ };
    });
    g['document'] = {
      createElement: (tag: string) => {
        expect(tag).toBe('canvas');
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            fillRect: () => void fills++,
            drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => draws.push({ w, h }),
          }),
          // A LEAKY fake: returns EXIF-laden bytes sized by area × quality.
          toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
            toBlobCalls.push({ type, quality });
            const size = Math.round(canvas.width * canvas.height * quality * 0.3556);
            cb(new Blob([mockLeakyJpegOfSize(size) as BlobPart], { type }));
          },
        };
        return canvas;
      },
    };
  });

  afterEach(() => {
    for (const k of Object.keys(saved)) g[k] = saved[k];
  });

  it('re-encodes via canvas as JPEG, strips what a leaky encoder left, reads taken_at from the ORIGINAL', async () => {
    const { decodePhoto } = require('../encode.web') as typeof import('../encode.web');
    const file = new Blob([mockFixture as BlobPart], { type: 'image/jpeg' });
    const out = await preparePhoto({ uri: 'blob:local/1', file, mimeType: 'image/jpeg' }, decodePhoto);
    expect(toBlobCalls.every((c) => c.type === 'image/jpeg')).toBe(true);
    expect(draws[0]).toEqual({ w: 1600, h: 1200 });
    expect(draws[draws.length - 1]).toEqual({ w: 400, h: 300 });
    expect(fills).toBe(draws.length); // white background under every draw (no black alpha)
    expectClean(out.full.bytes);
    expectClean(out.thumb.bytes);
    // The uploaded bytes are never the original file.
    expect(Buffer.from(out.full.bytes).equals(Buffer.from(mockFixture))).toBe(false);
    expect(out.takenAt).toBe('2026-07-14T12:30:00.000Z');
    expect(bitmapClosed).toBe(1);
  });

  it('unsupported_image when the browser cannot decode (e.g. HEIC outside Safari)', async () => {
    g['createImageBitmap'] = jest.fn(async () => {
      throw new Error('InvalidStateError');
    });
    g['Image'] = undefined;
    const { decodePhoto } = require('../encode.web') as typeof import('../encode.web');
    const file = new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) as BlobPart], { type: 'image/heic' });
    await expect(decodePhoto({ uri: 'blob:x', file, mimeType: 'image/heic' })).rejects.toMatchObject({
      code: 'unsupported_image',
    });
  });
});

// ---------------------------------------------------------------------------
// Native encoder (expo-image-manipulator) — module mocked
// ---------------------------------------------------------------------------

const mockSaveCalls: Array<Record<string, unknown>> = [];
const mockResizeCalls: Array<Record<string, unknown>> = [];
const mockReleased: string[] = [];
const mockDeleted: string[] = [];

jest.mock('expo-image-manipulator', () => {
  const makeRef = (name: string, width: number, height: number) => ({
    width,
    height,
    release: () => mockReleased.push(name),
    saveAsync: async (opts: Record<string, unknown>) => {
      mockSaveCalls.push({ ref: name, ...opts });
      const size = Math.round(width * height * (opts['compress'] as number) * 0.3556);
      return {
        uri: `file:///cache/${name}-${mockSaveCalls.length}.jpg`,
        width,
        height,
        base64: Buffer.from(mockLeakyJpegOfSize(size)).toString('base64'),
      };
    },
  });
  return {
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    ImageManipulator: {
      manipulate: (source: unknown) => {
        let size: { width: number; height: number } | null = null;
        const ctx = {
          resize: (s: { width: number; height: number }) => {
            mockResizeCalls.push(s);
            size = s;
            return ctx;
          },
          renderAsync: async () =>
            size
              ? makeRef(`resized-${size.width}`, size.width, size.height)
              : makeRef(typeof source === 'string' ? 'original' : 'copy', 4032, 3024),
        };
        return ctx;
      },
    },
  };
});

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
    async bytes() {
      return mockFixture;
    }
  },
}));

describe('encode.native (expo-image-manipulator path)', () => {
  beforeEach(() => {
    mockSaveCalls.length = 0;
    mockResizeCalls.length = 0;
    mockReleased.length = 0;
    mockDeleted.length = 0;
  });

  it('saves fresh JPEGs (base64), resizes once per edge, strips leaks, cleans cache files, releases refs', async () => {
    const { decodePhoto } = require('../encode.native') as typeof import('../encode.native');
    const out = await preparePhoto(
      {
        uri: 'file:///picker/IMG_0001.JPG',
        mimeType: 'image/jpeg',
        exif: { DateTimeOriginal: '2026:07:14 15:30:00', OffsetTimeOriginal: '+03:00', GPSLatitude: 41.0082 },
      },
      decodePhoto,
    );
    expect(mockSaveCalls.length).toBeGreaterThan(1);
    expect(mockSaveCalls.every((c) => c['format'] === 'jpeg' && c['base64'] === true)).toBe(true);
    expect(mockSaveCalls.map((c) => c['compress']).slice(0, 4)).toEqual([0.75, 0.68, 0.6, 0.52]);
    // One resize per target edge, reused across the quality ladder.
    expect(mockResizeCalls).toEqual([
      { width: 1600, height: 1200 },
      { width: 400, height: 300 },
    ]);
    expect(mockDeleted.length).toBe(mockSaveCalls.length);
    expect(mockReleased.sort()).toEqual(['original', 'resized-1600', 'resized-400'].sort());
    expectClean(out.full.bytes);
    expectClean(out.thumb.bytes);
    expect(out.full.bytes.length).toBeLessThanOrEqual(PHOTO_FULL_MAX_BYTES);
    // Only the DATE came from the picker EXIF (GPS ignored).
    expect(out.takenAt).toBe('2026-07-14T12:30:00.000Z');
  });

  it('reads the capture date from the original file when the picker gave no EXIF', async () => {
    const { decodePhoto } = require('../encode.native') as typeof import('../encode.native');
    const decoded = await decodePhoto({ uri: 'file:///picker/IMG_0002.jpg', mimeType: 'image/jpeg' });
    expect(decoded.takenAt).toBe('2026-07-14T12:30:00.000Z');
    decoded.release();
  });
});
