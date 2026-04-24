// Tripvisor Phase 4 — .ics (RFC 5545) generator.
//
// Pure function. No I/O, no external deps. Produces a CRLF-joined
// VCALENDAR string with one VEVENT per place. Anchor for each day:
//   day_start = trip.start_date + day_index days at 09:00 local
// Within a day events run back-to-back per place visit_duration_minutes.
//
// Timezone policy (per ADR-0004):
//   - If `trip.timezone` is set and recognized → emit a VTIMEZONE block and
//     use `DTSTART;TZID=<tz>`.
//   - Otherwise → fall back to absolute UTC (`DTSTART:<ISO>Z`). Less pretty
//     in calendar UIs, but universally importable.
//
// Escaping + folding follow RFC 5545 §3.1 and §3.3.11.

export interface IcsTrip {
  id: string;
  title: string;
  start_date: string | null; // YYYY-MM-DD
  timezone: string | null;
}

export interface IcsPlace {
  id: string;
  user_title: string | null;
  lat: number;
  lng: number;
  visit_duration_minutes: number;
  day_index: number | null;
  order_in_day: number | null;
}

export interface IcsOptions {
  /** Override "now" — mostly for deterministic tests. */
  nowUtc?: Date;
  /** Override the PRODID — mostly for deterministic tests. */
  prodId?: string;
}

const DEFAULT_PRODID = '-//Tripvisor//EN';
const DAY_START_HOUR = 9; // 09:00 local
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// A small static map of common IANA zones → VTIMEZONE body. The body is
// intentionally minimal and generic: real-world importers (Google, Apple,
// Outlook) resolve the TZID against their own tz data, and a VTIMEZONE
// component only needs to be present + well-formed to satisfy strict parsers.
// For zones outside this list we fall back to absolute UTC (see below).
//
// Coverage: Europe + Americas majors + UTC. Add more as needed.
const VTZ_BODIES: Record<string, string> = {
  UTC: ['BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0000', 'TZNAME:UTC', 'END:STANDARD'].join('\r\n'),
  'Etc/UTC': ['BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0000', 'TZNAME:UTC', 'END:STANDARD'].join('\r\n'),
  'Europe/London': [
    'BEGIN:STANDARD',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'END:DAYLIGHT',
  ].join('\r\n'),
  'Europe/Lisbon': [
    'BEGIN:STANDARD',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:WET',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:WEST',
    'END:DAYLIGHT',
  ].join('\r\n'),
  'Europe/Paris': europeCET('Paris'),
  'Europe/Berlin': europeCET('Berlin'),
  'Europe/Madrid': europeCET('Madrid'),
  'Europe/Rome': europeCET('Rome'),
  'Europe/Amsterdam': europeCET('Amsterdam'),
  'Europe/Brussels': europeCET('Brussels'),
  'Europe/Zurich': europeCET('Zurich'),
  'Europe/Vienna': europeCET('Vienna'),
  'Europe/Prague': europeCET('Prague'),
  'Europe/Warsaw': europeCET('Warsaw'),
  'Europe/Stockholm': europeCET('Stockholm'),
  'America/New_York': americaUS('EST', 'EDT', '-0500', '-0400'),
  'America/Chicago': americaUS('CST', 'CDT', '-0600', '-0500'),
  'America/Denver': americaUS('MST', 'MDT', '-0700', '-0600'),
  'America/Los_Angeles': americaUS('PST', 'PDT', '-0800', '-0700'),
  'America/Toronto': americaUS('EST', 'EDT', '-0500', '-0400'),
  'Asia/Tokyo': [
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
  ].join('\r\n'),
  'Australia/Sydney': [
    'BEGIN:STANDARD',
    'DTSTART:19700405T030000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4',
    'TZOFFSETFROM:+1100',
    'TZOFFSETTO:+1000',
    'TZNAME:AEST',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19701004T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=10',
    'TZOFFSETFROM:+1000',
    'TZOFFSETTO:+1100',
    'TZNAME:AEDT',
    'END:DAYLIGHT',
  ].join('\r\n'),
};

function europeCET(city: string): string {
  return [
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    `TZNAME:CET`,
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    `TZNAME:CEST`,
    'END:DAYLIGHT',
    `X-CITY:${city}`,
  ].join('\r\n');
}

function americaUS(stdName: string, dstName: string, stdOff: string, dstOff: string): string {
  return [
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    `TZOFFSETFROM:${dstOff}`,
    `TZOFFSETTO:${stdOff}`,
    `TZNAME:${stdName}`,
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    `TZOFFSETFROM:${stdOff}`,
    `TZOFFSETTO:${dstOff}`,
    `TZNAME:${dstName}`,
    'END:DAYLIGHT',
  ].join('\r\n');
}

// Escape per RFC 5545 §3.3.11: \ , ; and newlines in TEXT values.
export function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// Line-fold to 75 octets per RFC 5545 §3.1. We approximate "octets" by UTF-8
// byte length via TextEncoder. Continuation lines begin with a single space.
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  // Walk the string char-by-char, tracking byte count; emit folds just under 75.
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  const limit = 75;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    // Leave room for the single-space continuation marker on subsequent lines.
    const cap = out.length === 0 ? limit : limit - 1;
    if (currentBytes + chBytes > cap) {
      out.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) out.push(current);
  return out.map((seg, i) => (i === 0 ? seg : ' ' + seg)).join('\r\n');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// YYYYMMDDTHHmmss (local, no TZ suffix) — for use with DTSTART;TZID=...
function localStamp(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds())
  );
}

// YYYYMMDDTHHmmssZ — absolute UTC form.
function utcStamp(d: Date): string {
  return localStamp(d) + 'Z';
}

function sanitizeFilenamePart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'trip'
  );
}

export function icsFilenameForTitle(title: string): string {
  return `tripvisor-${sanitizeFilenamePart(title)}.ics`;
}

/**
 * Generate an RFC 5545 .ics calendar for the given trip + places.
 *
 * @param trip    Trip shell (id, title, start_date, timezone)
 * @param places  Places that belong to the trip. Only those with a non-null
 *                `day_index` are emitted (ungrouped places are treated as
 *                scratch and skipped).
 * @param _legs   Currently ignored. Kept in the signature so callers can
 *                evolve the generator without a breaking API change (e.g. to
 *                emit travel VEVENTs between stops later).
 * @param opts    Test-only overrides for determinism.
 */
export function tripToIcs(
  trip: IcsTrip,
  places: IcsPlace[],
  _legs: unknown[] = [],
  opts: IcsOptions = {},
): string {
  const now = opts.nowUtc ?? new Date();
  const prodId = opts.prodId ?? DEFAULT_PRODID;

  // Normalize + group by day_index, sorted by order_in_day. Skip places without
  // a day assignment (they aren't scheduled yet).
  const scheduled = places
    .filter((p) => p.day_index !== null && p.day_index !== undefined)
    .slice()
    .sort((a, b) => {
      const da = a.day_index ?? 0;
      const db = b.day_index ?? 0;
      if (da !== db) return da - db;
      return (a.order_in_day ?? 0) - (b.order_in_day ?? 0);
    });

  // Base date: trip.start_date at 09:00 local. If missing, use today UTC.
  // When using UTC fallback, we treat "local" as "UTC" so timestamps still line up.
  const tz = trip.timezone && VTZ_BODIES[trip.timezone] ? trip.timezone : null;
  const useUtc = !tz;

  const base = parseDateAt9(trip.start_date, now);

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${prodId}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  if (tz) {
    lines.push('BEGIN:VTIMEZONE');
    lines.push(`TZID:${tz}`);
    // Body lines are already CRLF-joined; split back into individual lines so
    // we can fold each.
    for (const bodyLine of VTZ_BODIES[tz]!.split('\r\n')) {
      lines.push(bodyLine);
    }
    lines.push('END:VTIMEZONE');
  }

  // Walk places, keeping a per-day cursor that advances by visit_duration_minutes.
  let currentDay = -1;
  let cursor = new Date(base);
  let stopIndex = 0;

  for (const place of scheduled) {
    const dayIdx = place.day_index!;
    if (dayIdx !== currentDay) {
      cursor = new Date(base.getTime() + dayIdx * DAY_MS);
      currentDay = dayIdx;
      stopIndex = 0;
    }
    stopIndex += 1;

    const start = new Date(cursor);
    const durMin = Math.max(1, place.visit_duration_minutes ?? 60);
    const end = new Date(start.getTime() + durMin * MIN_MS);

    const title = place.user_title && place.user_title.trim() !== ''
      ? place.user_title
      : 'Visit';
    const description = `Day ${dayIdx + 1} - Stop ${stopIndex}`;
    const location = `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${trip.id}-${place.id}@tripvisor`);
    lines.push(`DTSTAMP:${utcStamp(now)}`);
    if (useUtc) {
      lines.push(`DTSTART:${utcStamp(start)}`);
      lines.push(`DTEND:${utcStamp(end)}`);
    } else {
      lines.push(`DTSTART;TZID=${tz}:${localStamp(start)}`);
      lines.push(`DTEND;TZID=${tz}:${localStamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(title)}`);
    lines.push(`LOCATION:${escapeText(location)}`);
    lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push('END:VEVENT');

    cursor = end;
  }

  lines.push('END:VCALENDAR');

  // Fold + CRLF-join.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function parseDateAt9(startDate: string | null, fallbackNow: Date): Date {
  // Construct a UTC Date at 09:00 on the trip's start date. We build the
  // timestamp components in UTC deliberately — when a VTIMEZONE is in play
  // the TZID attribute on DTSTART/DTEND tells the calendar to interpret the
  // local stamp in that zone; when falling back to UTC, 09:00 UTC is the best
  // anchor we can offer without pulling in full tz data.
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const [y, m, d] = startDate.split('-').map((s) => parseInt(s, 10));
    return new Date(Date.UTC(y!, m! - 1, d!, DAY_START_HOUR, 0, 0));
  }
  // Missing start_date: anchor at today at 09:00 UTC.
  return new Date(
    Date.UTC(
      fallbackNow.getUTCFullYear(),
      fallbackNow.getUTCMonth(),
      fallbackNow.getUTCDate(),
      DAY_START_HOUR,
      0,
      0,
    ),
  );
}
