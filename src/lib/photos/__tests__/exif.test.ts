/**
 * M5 Y2.1 — EXIF/GPS stripping (the privacy-policy promise).
 *
 * Fixture: fixtures/gps-exif.jpg — a real JPEG (Pillow, quality 90) carrying
 * EXIF with a GPS IFD (41°0'29.52"N 28°58'42.24"E, Istanbul),
 * DateTimeOriginal 2026:07:14 15:30:00 + OffsetTimeOriginal +03:00, an XMP
 * packet with exif:GPSLatitude/Longitude, and a COM comment. Regenerate with
 * the script quoted in the Y2.1 hand-off if it ever needs to change.
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  JpegFormatError,
  assertNoLocationMetadata,
  exifDateToIso,
  inspectJpeg,
  readJpegExif,
  stripJpegMetadata,
  takenAtFromPickerExif,
} from '../exif';
import { base64ToBytes, bytesToBase64, toArrayBuffer } from '../base64';

const FIXTURE = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'gps-exif.jpg')));

/** Offset of the first SOS marker (FF DA) — everything after it is image data. */
function sosOffset(bytes: Uint8Array): number {
  for (let i = 2; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) return i;
  }
  return -1;
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}

describe('fixture sanity: the original really carries location data', () => {
  it('inspectJpeg sees EXIF with a GPS position, XMP GPS and a comment', () => {
    const r = inspectJpeg(FIXTURE);
    expect(r.isJpeg).toBe(true);
    expect(r.hasExif).toBe(true);
    expect(r.hasGps).toBe(true);
    expect(r.hasXmp).toBe(true);
    expect(r.hasComment).toBe(true);
    expect(r.exif?.gps?.lat).toBeCloseTo(41.0082, 4);
    expect(r.exif?.gps?.lng).toBeCloseTo(28.9784, 4);
    expect(r.metadataMarkers).toEqual(expect.arrayContaining(['APP0', 'APP1', 'COM']));
    expect(containsAscii(FIXTURE, 'Exif\0\0')).toBe(true);
    expect(containsAscii(FIXTURE, 'GPSLatitude')).toBe(true);
  });

  it('readJpegExif returns the capture date + offset', () => {
    const exif = readJpegExif(FIXTURE);
    expect(exif?.dateTimeOriginal).toBe('2026:07:14 15:30:00');
    expect(exif?.offsetTimeOriginal).toBe('+03:00');
    expect(exifDateToIso(exif?.dateTimeOriginal, exif?.offsetTimeOriginal)).toBe('2026-07-14T12:30:00.000Z');
  });

  it('the upload gate refuses the original', () => {
    expect(() => assertNoLocationMetadata(FIXTURE)).toThrow(JpegFormatError);
  });
});

describe('stripJpegMetadata', () => {
  const stripped = stripJpegMetadata(FIXTURE);

  it('removes EXIF, GPS, XMP and comments', () => {
    const r = inspectJpeg(stripped);
    expect(r.isJpeg).toBe(true);
    expect(r.hasExif).toBe(false);
    expect(r.hasGps).toBe(false);
    expect(r.hasXmp).toBe(false);
    expect(r.hasComment).toBe(false);
    expect(r.exif).toBeNull();
    expect(r.metadataMarkers).toEqual(['APP0']);
    // Byte-level: no trace of the EXIF header, GPS tags, XMP or the comment text.
    for (const needle of ['Exif\0\0', 'GPSLatitude', 'http://ns.adobe.com/xap', 'Hagia Sophia', 'TripvisorTestCam']) {
      expect({ needle, found: containsAscii(stripped, needle) }).toEqual({ needle, found: false });
    }
    expect(() => assertNoLocationMetadata(stripped)).not.toThrow();
  });

  it('keeps the image data byte-for-byte (same pixels) and stays a valid JPEG', () => {
    const a = FIXTURE.subarray(sosOffset(FIXTURE));
    const b = stripped.subarray(sosOffset(stripped));
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect(stripped[stripped.length - 2]).toBe(0xff);
    expect(stripped[stripped.length - 1]).toBe(0xd9);
    expect(stripped.length).toBeLessThan(FIXTURE.length);
  });

  it('is idempotent', () => {
    const twice = stripJpegMetadata(stripped);
    expect(Buffer.from(twice).equals(Buffer.from(stripped))).toBe(true);
  });

  it('keeps an ICC profile and drops MPF / JFXX / IPTC segments', () => {
    const seg = (marker: number, payload: string) => {
      const body = Buffer.from(payload, 'latin1');
      const len = body.length + 2;
      return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), body]);
    };
    const soi = Buffer.from(FIXTURE.subarray(0, 2));
    const rest = Buffer.from(FIXTURE.subarray(2));
    const crafted = new Uint8Array(
      Buffer.concat([
        soi,
        seg(0xe2, 'ICC_PROFILE\0\x01\x01profile-bytes'),
        seg(0xe2, 'MPF\0depth-map-and-original'),
        seg(0xe0, 'JFXX\0\x10thumbnail'),
        seg(0xed, 'Photoshop 3.0\0city=Istanbul'),
        rest,
      ]),
    );
    const out = stripJpegMetadata(crafted);
    expect(containsAscii(out, 'ICC_PROFILE')).toBe(true);
    expect(containsAscii(out, 'MPF\0')).toBe(false);
    expect(containsAscii(out, 'JFXX')).toBe(false);
    expect(containsAscii(out, 'Istanbul')).toBe(false);
    expect(() => assertNoLocationMetadata(out)).not.toThrow();
  });

  it('throws on bytes that are not a JPEG (so they are never uploaded)', () => {
    expect(() => stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(JpegFormatError);
    expect(() => stripJpegMetadata(FIXTURE.subarray(0, 200))).toThrow(JpegFormatError);
    expect(inspectJpeg(new Uint8Array([1, 2, 3])).isJpeg).toBe(false);
    expect(() => assertNoLocationMetadata(new Uint8Array([1, 2, 3]))).toThrow(JpegFormatError);
  });
});

describe('capture date helpers', () => {
  it('exifDateToIso: offset-aware, local without offset, junk → null', () => {
    expect(exifDateToIso('2026:07:14 15:30:00', '+03:00')).toBe('2026-07-14T12:30:00.000Z');
    expect(exifDateToIso('2026:07:14 15:30:00', '-0500')).toBe('2026-07-14T20:30:00.000Z');
    expect(exifDateToIso('2026:07:14 15:30:00')).toBe(new Date(2026, 6, 14, 15, 30, 0).toISOString());
    expect(exifDateToIso('0000:00:00 00:00:00')).toBeNull();
    expect(exifDateToIso('2026-07-14')).toBeNull();
    expect(exifDateToIso(null)).toBeNull();
  });

  it('takenAtFromPickerExif reads only the date (iOS nested + Android flat)', () => {
    expect(
      takenAtFromPickerExif({ '{Exif}': { DateTimeOriginal: '2026:07:14 15:30:00', OffsetTimeOriginal: '+03:00' }, '{GPS}': { Latitude: 41 } }),
    ).toBe('2026-07-14T12:30:00.000Z');
    expect(takenAtFromPickerExif({ DateTimeOriginal: '2026:07:14 15:30:00', OffsetTimeOriginal: '+03:00', GPSLatitude: 41 })).toBe(
      '2026-07-14T12:30:00.000Z',
    );
    expect(takenAtFromPickerExif({ GPSLatitude: 41 })).toBeNull();
    expect(takenAtFromPickerExif(null)).toBeNull();
  });
});

describe('base64', () => {
  it('round-trips the fixture and tolerates a data: prefix', () => {
    const b64 = bytesToBase64(FIXTURE);
    expect(b64).toBe(Buffer.from(FIXTURE).toString('base64'));
    expect(Buffer.from(base64ToBytes(b64)).equals(Buffer.from(FIXTURE))).toBe(true);
    expect(Buffer.from(base64ToBytes(`data:image/jpeg;base64,${b64}`)).equals(Buffer.from(FIXTURE))).toBe(true);
  });

  it('toArrayBuffer returns an exact standalone buffer', () => {
    const view = FIXTURE.subarray(10, 20);
    const ab = toArrayBuffer(view);
    expect(ab.byteLength).toBe(10);
    expect(Buffer.from(new Uint8Array(ab)).equals(Buffer.from(view))).toBe(true);
  });
});
