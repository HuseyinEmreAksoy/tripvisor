/**
 * exif.ts — pure JPEG metadata inspection + stripping (M5 Y2.1).
 *
 * WHY THIS EXISTS: the privacy policy promises that photo location (EXIF
 * GPS) never leaves the device. The pipeline re-encodes every photo
 * (expo-image-manipulator on native, canvas on web — both write fresh JPEGs
 * without EXIF), and THEN runs `stripJpegMetadata` over the encoder output
 * and `assertNoLocationMetadata` before a single byte is queued for upload.
 * So the promise holds even if a platform encoder one day starts copying
 * metadata across (belt and braces; this module is what the jest fixture
 * test pins down).
 *
 * What is kept vs dropped (marker segments before/between scans):
 *   keep   SOI, DQT, SOFn, DHT, DAC, DRI, SOS + entropy data, EOI, DNL
 *   keep   APP2 "ICC_PROFILE" (colour profile only — no personal data; iOS
 *          writes Display-P3 profiles and dropping them shifts colours)
 *   keep   APP14 "Adobe" (colour-transform flag the decoder needs)
 *   rewrite APP0 → one canonical JFIF header WITHOUT an embedded thumbnail
 *   drop   APP1 (EXIF incl. GPS, XMP — both can carry location), APP3–13
 *          (APP13 = Photoshop/IPTC: city, location names), APP15, other APP2
 *          (MPF: extra images / depth maps), COM (free-text comments), JFXX
 *
 * Also: `readJpegExif` extracts the capture date (DateTimeOriginal +
 * OffsetTimeOriginal) from the ORIGINAL bytes on web, where the picker gives
 * no EXIF object — that date is the only EXIF value Tripvisor keeps
 * (trip_photos.taken_at). GPS is only ever *detected* (to prove absence),
 * never returned to callers beyond a boolean.
 *
 * Pure: no I/O, never throws on malformed input (inspection degrades to
 * "not a JPEG"; stripping throws JpegFormatError so the pipeline can refuse
 * to upload bytes it cannot vouch for).
 */

export class JpegFormatError extends Error {
  constructor(message: string) {
    super(`[photos.exif] ${message}`);
    this.name = 'JpegFormatError';
  }
}

const M_SOI = 0xd8;
const M_EOI = 0xd9;
const M_SOS = 0xda;
const M_APP0 = 0xe0;
const M_APP1 = 0xe1;
const M_APP2 = 0xe2;
const M_APP14 = 0xee;
const M_COM = 0xfe;

function isStandalone(marker: number): boolean {
  // TEM, RST0-7, SOI, EOI carry no length.
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

function startsWithAscii(bytes: Uint8Array, start: number, text: string): boolean {
  return ascii(bytes, start, text.length) === text;
}

interface Segment {
  marker: number;
  /** Offset of the 0xFF of the marker. */
  start: number;
  /** Exclusive end of the segment (marker + length field + payload). */
  end: number;
  /** Payload start (after the 2-byte length). */
  payload: number;
}

/**
 * Walk a JPEG: every length-bearing marker segment is reported through
 * `onSegment`; entropy-coded scan data (after each SOS) through `onData`.
 * Handles fill bytes, byte stuffing (FF 00), restart markers and
 * multi-scan (progressive) files. Throws JpegFormatError on a structurally
 * broken file.
 */
function walkJpeg(
  bytes: Uint8Array,
  onSegment: (seg: Segment) => void,
  onData: (start: number, end: number) => void,
): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== M_SOI) {
    throw new JpegFormatError('not a JPEG (missing SOI)');
  }
  let i = 2;
  for (;;) {
    if (i >= bytes.length) throw new JpegFormatError('truncated JPEG (no EOI)');
    if (bytes[i] !== 0xff) throw new JpegFormatError(`expected a marker at ${i}`);
    // Skip fill bytes (FF FF … FF xx).
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) throw new JpegFormatError('truncated marker');
    const marker = bytes[m] as number;
    const segStart = m - 1;
    if (marker === M_EOI) {
      onSegment({ marker, start: segStart, end: m + 1, payload: m + 1 });
      return;
    }
    if (isStandalone(marker)) {
      onSegment({ marker, start: segStart, end: m + 1, payload: m + 1 });
      i = m + 1;
      continue;
    }
    if (m + 2 >= bytes.length) throw new JpegFormatError('truncated segment length');
    const len = ((bytes[m + 1] as number) << 8) | (bytes[m + 2] as number);
    if (len < 2 || m + 1 + len > bytes.length) throw new JpegFormatError(`bad segment length at ${m}`);
    const end = m + 1 + len;
    onSegment({ marker, start: segStart, end, payload: m + 3 });
    i = end;
    if (marker === M_SOS) {
      // Entropy-coded data runs until the next marker that is not stuffing
      // (FF 00) or a restart marker (FF D0–D7).
      let j = i;
      while (j < bytes.length) {
        if (bytes[j] === 0xff) {
          const next = bytes[j + 1];
          if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            j += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j >= bytes.length) throw new JpegFormatError('truncated scan data');
      onData(i, j);
      i = j;
    }
  }
}

// ---------------------------------------------------------------------------
// TIFF / EXIF reading (bounds-checked; never throws)
// ---------------------------------------------------------------------------

interface Tiff {
  bytes: Uint8Array;
  base: number;
  little: boolean;
}

function u16(t: Tiff, off: number): number | null {
  const a = t.base + off;
  if (a < 0 || a + 2 > t.bytes.length) return null;
  const b0 = t.bytes[a] as number;
  const b1 = t.bytes[a + 1] as number;
  return t.little ? b0 | (b1 << 8) : (b0 << 8) | b1;
}

function u32(t: Tiff, off: number): number | null {
  const a = t.base + off;
  if (a < 0 || a + 4 > t.bytes.length) return null;
  const b = t.bytes;
  const v = t.little
    ? (b[a] as number) | ((b[a + 1] as number) << 8) | ((b[a + 2] as number) << 16) | ((b[a + 3] as number) << 24)
    : ((b[a] as number) << 24) | ((b[a + 1] as number) << 16) | ((b[a + 2] as number) << 8) | (b[a + 3] as number);
  return v >>> 0;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Offset (relative to the TIFF base) of the entry's 4-byte value field. */
  valueField: number;
}

function readIfd(t: Tiff, off: number): IfdEntry[] {
  const n = u16(t, off);
  if (n === null || n > 1000) return [];
  const out: IfdEntry[] = [];
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    const tag = u16(t, e);
    const type = u16(t, e + 2);
    const count = u32(t, e + 4);
    if (tag === null || type === null || count === null) break;
    out.push({ tag, type, count, valueField: e + 8 });
  }
  return out;
}

function readAsciiValue(t: Tiff, entry: IfdEntry): string | null {
  if (entry.type !== 2 || entry.count === 0 || entry.count > 256) return null;
  const off = entry.count <= 4 ? entry.valueField : u32(t, entry.valueField);
  if (off === null) return null;
  const start = t.base + off;
  if (start + entry.count > t.bytes.length) return null;
  const s = ascii(t.bytes, start, entry.count);
  const nul = s.indexOf('\0');
  return (nul >= 0 ? s.slice(0, nul) : s).trim();
}

function readRationals(t: Tiff, entry: IfdEntry): number[] | null {
  if (entry.type !== 5 || entry.count === 0 || entry.count > 16) return null;
  const off = u32(t, entry.valueField);
  if (off === null) return null;
  const out: number[] = [];
  for (let k = 0; k < entry.count; k++) {
    const num = u32(t, off + k * 8);
    const den = u32(t, off + k * 8 + 4);
    if (num === null || den === null || den === 0) return null;
    out.push(num / den);
  }
  return out;
}

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;

export interface ExifSummary {
  /** DateTimeOriginal (or DateTime) as written: 'YYYY:MM:DD HH:MM:SS'. */
  dateTimeOriginal: string | null;
  /** OffsetTimeOriginal, e.g. '+03:00'. */
  offsetTimeOriginal: string | null;
  /** A GPS IFD with at least one entry is present. */
  hasGps: boolean;
  /**
   * Decoded latitude/longitude — exposed ONLY so tests can prove a fixture
   * really carries a location before stripping. Production code must never
   * read it (the app never uses photo location).
   */
  gps: { lat: number; lng: number } | null;
}

function parseExifPayload(bytes: Uint8Array, tiffStart: number): ExifSummary {
  const out: ExifSummary = { dateTimeOriginal: null, offsetTimeOriginal: null, hasGps: false, gps: null };
  const order = ascii(bytes, tiffStart, 2);
  if (order !== 'II' && order !== 'MM') return out;
  const t: Tiff = { bytes, base: tiffStart, little: order === 'II' };
  if (u16(t, 2) !== 42) return out;
  const ifd0 = u32(t, 4);
  if (ifd0 === null) return out;
  let dateTime: string | null = null;
  for (const e of readIfd(t, ifd0)) {
    if (e.tag === TAG_DATETIME) dateTime = readAsciiValue(t, e);
    if (e.tag === TAG_EXIF_IFD) {
      const off = u32(t, e.valueField);
      if (off !== null) {
        for (const x of readIfd(t, off)) {
          if (x.tag === TAG_DATETIME_ORIGINAL) out.dateTimeOriginal = readAsciiValue(t, x);
          if (x.tag === TAG_OFFSET_TIME_ORIGINAL) out.offsetTimeOriginal = readAsciiValue(t, x);
        }
      }
    }
    if (e.tag === TAG_GPS_IFD) {
      const off = u32(t, e.valueField);
      if (off !== null) {
        const gpsEntries = readIfd(t, off);
        out.hasGps = gpsEntries.length > 0;
        let latRef: string | null = null;
        let lonRef: string | null = null;
        let lat: number[] | null = null;
        let lon: number[] | null = null;
        for (const g of gpsEntries) {
          if (g.tag === TAG_GPS_LAT_REF) latRef = readAsciiValue(t, g);
          if (g.tag === TAG_GPS_LON_REF) lonRef = readAsciiValue(t, g);
          if (g.tag === TAG_GPS_LAT) lat = readRationals(t, g);
          if (g.tag === TAG_GPS_LON) lon = readRationals(t, g);
        }
        if (lat && lon && lat.length === 3 && lon.length === 3) {
          const dms = (v: number[]) => (v[0] as number) + (v[1] as number) / 60 + (v[2] as number) / 3600;
          out.gps = {
            lat: dms(lat) * (latRef === 'S' ? -1 : 1),
            lng: dms(lon) * (lonRef === 'W' ? -1 : 1),
          };
        }
      }
    }
  }
  if (!out.dateTimeOriginal) out.dateTimeOriginal = dateTime;
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface JpegMetadataReport {
  isJpeg: boolean;
  /** An APP1 "Exif" segment is present. */
  hasExif: boolean;
  /** An APP1 XMP packet is present (can carry GPS too). */
  hasXmp: boolean;
  /** GPS IFD found in EXIF, or a GPS-looking XMP property. */
  hasGps: boolean;
  /** APP13 (Photoshop / IPTC — may hold place names). */
  hasIptc: boolean;
  hasComment: boolean;
  /** An APP0 carries an embedded thumbnail (JFIF thumb or JFXX). */
  hasEmbeddedThumbnail: boolean;
  /** Every APPn/COM marker name found, in order (e.g. ['APP0','APP1','APP2']). */
  metadataMarkers: string[];
  exif: ExifSummary | null;
}

function markerName(marker: number): string {
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  if (marker === M_COM) return 'COM';
  return `0x${marker.toString(16)}`;
}

/** Inspect a JPEG's metadata segments. Never throws (non-JPEG → isJpeg false). */
export function inspectJpeg(bytes: Uint8Array): JpegMetadataReport {
  const report: JpegMetadataReport = {
    isJpeg: false,
    hasExif: false,
    hasXmp: false,
    hasGps: false,
    hasIptc: false,
    hasComment: false,
    hasEmbeddedThumbnail: false,
    metadataMarkers: [],
    exif: null,
  };
  try {
    walkJpeg(
      bytes,
      (seg) => {
        const { marker, payload, end } = seg;
        if ((marker >= 0xe0 && marker <= 0xef) || marker === M_COM) report.metadataMarkers.push(markerName(marker));
        if (marker === M_APP1) {
          if (startsWithAscii(bytes, payload, 'Exif\0\0')) {
            report.hasExif = true;
            const summary = parseExifPayload(bytes.subarray(0, end), payload + 6);
            report.exif = summary;
            if (summary.hasGps) report.hasGps = true;
          } else if (startsWithAscii(bytes, payload, 'http://ns.adobe.com/xap/1.0/')) {
            report.hasXmp = true;
            const xmp = ascii(bytes, payload, end - payload);
            if (/exif:GPS|GPSLatitude|GPSLongitude/i.test(xmp)) report.hasGps = true;
          }
        }
        if (marker === 0xed) report.hasIptc = true;
        if (marker === M_COM) report.hasComment = true;
        if (marker === M_APP0) {
          if (startsWithAscii(bytes, payload, 'JFXX\0')) report.hasEmbeddedThumbnail = true;
          else if (startsWithAscii(bytes, payload, 'JFIF\0') && end - payload >= 14) {
            const tw = bytes[payload + 12] ?? 0;
            const th = bytes[payload + 13] ?? 0;
            if (tw > 0 && th > 0) report.hasEmbeddedThumbnail = true;
          }
        }
      },
      () => {},
    );
    report.isJpeg = true;
  } catch {
    report.isJpeg = false;
  }
  return report;
}

/** EXIF summary of a JPEG (the capture date on web), or null. Never throws. */
export function readJpegExif(bytes: Uint8Array): ExifSummary | null {
  return inspectJpeg(bytes).exif;
}

/** Canonical JFIF APP0: v1.01, no units, 1:1 density, NO thumbnail. */
const CANONICAL_APP0 = new Uint8Array([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

/**
 * Return a copy of `bytes` with every metadata segment that could carry
 * personal data removed (see the header for the keep/drop table). The image
 * data (tables, frame, scans) is copied byte-for-byte, so the result decodes
 * to exactly the same pixels. Throws JpegFormatError when `bytes` is not a
 * structurally valid JPEG — callers must then refuse to upload.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let wroteApp0 = false;
  walkJpeg(
    bytes,
    (seg) => {
      const { marker, start, end, payload } = seg;
      if (marker === M_APP0) {
        if (!wroteApp0 && startsWithAscii(bytes, payload, 'JFIF\0')) {
          parts.push(CANONICAL_APP0);
          wroteApp0 = true;
        }
        return; // JFXX / duplicate APP0 dropped
      }
      if (marker === M_APP2) {
        if (startsWithAscii(bytes, payload, 'ICC_PROFILE\0')) parts.push(bytes.subarray(start, end));
        return;
      }
      if (marker === M_APP14) {
        if (startsWithAscii(bytes, payload, 'Adobe')) parts.push(bytes.subarray(start, end));
        return;
      }
      if ((marker >= 0xe0 && marker <= 0xef) || marker === M_COM) return; // APP1, APP3-13, APP15, COM
      parts.push(bytes.subarray(start, end));
    },
    (start, end) => {
      parts.push(bytes.subarray(start, end));
    },
  );
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * The upload gate: throws JpegFormatError unless `bytes` is a JPEG with NO
 * EXIF, XMP, IPTC, comment or embedded thumbnail. Run on the exact bytes
 * that will be uploaded.
 */
export function assertNoLocationMetadata(bytes: Uint8Array): void {
  const r = inspectJpeg(bytes);
  if (!r.isJpeg) throw new JpegFormatError('refusing to upload: not a valid JPEG');
  if (r.hasExif || r.hasXmp || r.hasGps || r.hasIptc || r.hasComment || r.hasEmbeddedThumbnail) {
    throw new JpegFormatError(
      `refusing to upload: metadata survived stripping (${r.metadataMarkers.join(',')})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Capture date → trip_photos.taken_at
// ---------------------------------------------------------------------------

const EXIF_DATE_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * EXIF 'YYYY:MM:DD HH:MM:SS' (+ optional '+03:00') → ISO timestamp, or null.
 * Without an offset the time is read as DEVICE-local time (the usual case:
 * uploading on the trip); '0000:00:00 …' and impossible dates are null.
 */
export function exifDateToIso(dateTime: string | null | undefined, offset?: string | null): string | null {
  if (!dateTime) return null;
  const m = EXIF_DATE_RE.exec(dateTime.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const off = offset ? OFFSET_RE.exec(offset.trim()) : null;
  let ms: number;
  if (off) {
    const sign = off[1] === '-' ? -1 : 1;
    const offMin = sign * (Number(off[2]) * 60 + Number(off[3]));
    ms = Date.UTC(y, mo - 1, d, h, mi, s) - offMin * 60_000;
  } else {
    ms = new Date(y, mo - 1, d, h, mi, s).getTime();
  }
  const check = new Date(ms);
  if (!Number.isFinite(ms) || check.getUTCFullYear() < 1900) return null;
  return check.toISOString();
}

function pickString(obj: Record<string, unknown> | null | undefined, keys: readonly string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * Capture date from an expo-image-picker `exif` object (native, `exif: true`).
 * iOS nests EXIF under '{Exif}'; Android flattens. ONLY date keys are read —
 * the GPS keys the picker also returns are deliberately ignored.
 */
export function takenAtFromPickerExif(exif: Record<string, unknown> | null | undefined): string | null {
  if (!exif || typeof exif !== 'object') return null;
  const nested = exif['{Exif}'];
  const sub = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : null;
  const dateKeys = ['DateTimeOriginal', 'DateTimeDigitized'] as const;
  const date = pickString(exif, dateKeys) ?? pickString(sub, dateKeys) ?? pickString(exif, ['DateTime']);
  const offset =
    pickString(exif, ['OffsetTimeOriginal', 'OffsetTime']) ?? pickString(sub, ['OffsetTimeOriginal', 'OffsetTime']);
  return exifDateToIso(date, offset);
}
