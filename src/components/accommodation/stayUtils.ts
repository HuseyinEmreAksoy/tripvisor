/**
 * stayUtils — pure helpers for the accommodation surfaces (v2 M4 X2.4).
 * NO hooks, NO network — unit-test friendly.
 *
 * Confirmation codes: `trip_accommodations` has no dedicated column, so the
 * code lives in `notes` as a line like "Confirmation: ABC123" (the edit sheet
 * writes exactly that shape; any non-space token round-trips through it).
 * `extractConfirmationCode` also recognizes common shapes pasted from booking
 * emails ("Booking ref #X7Y2", "Reservation number: 12345678", "PNR: QX8R2L")
 * for display only; those user lines are never rewritten or stripped. If a
 * backend column is ever added, only these helpers change.
 */
import { Platform } from 'react-native';
import { buildDirectionsUrl } from '@/lib/directions';
import type { TripAccommodation } from '@/api/types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(value: string): [number, number, number] | null {
  const m = DATE_RE.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Nights between check-in and check-out (calendar days; 0 for bad input). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parts(checkIn);
  const b = parts(checkOut);
  if (!a || !b) return 0;
  const diff = Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
  return Math.max(0, diff);
}

/** "Sun 10 May" (deterministic English, local calendar), or the raw string if malformed. */
export function formatStayDate(value: string): string {
  const p = parts(value);
  if (!p) return value;
  const d = new Date(p[0], p[1] - 1, p[2]);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function nightsLabel(n: number): string {
  return `${n} night${n === 1 ? '' : 's'}`;
}

// ── Confirmation code ───────────────────────────────────────────────────────

/**
 * The app's own line, exactly as `withConfirmationCode` writes it. Any
 * non-space token round-trips (lowercase, 2-char, "AB/12", "x.y_z", …).
 */
const APP_LINE_RE = /^Confirmation: (\S+)\s*$/;

/** Heuristic for shapes pasted from booking emails. Display-only: never rewritten or stripped. */
const PASTED_LINE_RE =
  /^\s*(?:confirmation|conf\.?|booking|reservation|ref(?:erence)?|pnr)(?:\s*(?:code|no\.?|number|ref(?:erence)?|id))?\s*[:#]?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{2,29})\s*$/i;

function lines(notes: string): string[] {
  return notes.split(/\r?\n/);
}

/** Code from the app's own "Confirmation: X" line only (what the edit sheet owns), or null. */
export function extractAppConfirmationCode(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const line of lines(notes)) {
    const code = APP_LINE_RE.exec(line)?.[1];
    if (code) return code;
  }
  return null;
}

/**
 * Code to show (Copy chip): the app's own line first, else a pasted
 * booking-email shape ("Booking ref #X7Y2", "PNR: QX8R2L"), else null.
 */
export function extractConfirmationCode(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const own = extractAppConfirmationCode(notes);
  if (own) return own;
  for (const line of lines(notes)) {
    const code = PASTED_LINE_RE.exec(line)?.[1];
    // Require a digit, or an all-caps code of 5+ chars, so "Booking: done" is not a code.
    if (code && (/\d/.test(code) || (code.length >= 5 && code === code.toUpperCase()))) return code;
  }
  return null;
}

/**
 * `notes` without the app's own "Confirmation: X" line(s) (trimmed; null when
 * nothing is left). User-written / pasted lines are always kept verbatim.
 */
export function stripConfirmationLine(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const rest = lines(notes)
    .filter((line) => !APP_LINE_RE.test(line))
    .join('\n')
    .trim();
  return rest.length > 0 ? rest : null;
}

/**
 * Compose notes with a single "Confirmation: CODE" first line (replacing any
 * existing app line, never duplicating it), or without one when code is blank.
 * Whitespace inside the code is dropped so the line always reads back.
 */
export function withConfirmationCode(notes: string | null | undefined, code: string | null | undefined): string | null {
  const body = stripConfirmationLine(notes);
  const c = code?.replace(/\s+/g, '');
  if (!c) return body;
  return body ? `Confirmation: ${c}\n${body}` : `Confirmation: ${c}`;
}

// ── Directions ──────────────────────────────────────────────────────────────

/**
 * Directions URL to the stay: coordinates (+ place id) when known, otherwise
 * the free-text address as the destination query. null when neither exists.
 */
export function stayDirectionsUrl(
  acc: Pick<TripAccommodation, 'lat' | 'lng' | 'google_place_id' | 'address' | 'name'>,
  platform: typeof Platform.OS = Platform.OS,
): string | null {
  if (acc.lat != null && acc.lng != null) {
    return buildDirectionsUrl({
      destination: { lat: acc.lat, lng: acc.lng, placeId: acc.google_place_id, label: acc.name },
      platform,
    });
  }
  const address = acc.address?.trim();
  if (!address) return null;
  const q = encodeURIComponent(address);
  return platform === 'ios'
    ? `https://maps.apple.com/?daddr=${q}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
