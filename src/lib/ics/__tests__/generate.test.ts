/**
 * Unit tests for tripToIcs — RFC 5545 calendar generator.
 *
 * All tests are deterministic: we pass nowUtc + prodId via IcsOptions so
 * DTSTAMP never changes between runs. The golden-file fixture lives alongside
 * at __fixtures__/sample.ics; it is checked in with CRLF line endings.
 */
import * as fs from 'fs';
import * as path from 'path';
import { tripToIcs, escapeText, foldLine, type IcsTrip, type IcsPlace } from '../generate';

// ---- Helpers ----------------------------------------------------------------

const FIXED_NOW = new Date('2026-04-24T12:00:00Z');
const FIXED_PRODID = '-//Tripvisor//Test//EN';

function makeTrip(overrides: Partial<IcsTrip> = {}): IcsTrip {
  return {
    id: 'trip-aaa',
    title: 'Lisbon 3 Days',
    start_date: '2026-06-01',
    timezone: 'America/New_York',
    ...overrides,
  };
}

function makePlaces(count: number, dayMap: Array<{ day: number; order: number }>): IcsPlace[] {
  return dayMap.slice(0, count).map((dm, i) => ({
    id: `place-${i + 1}`,
    user_title: `Place ${i + 1}`,
    lat: 38.7 + i * 0.01,
    lng: -9.2 + i * 0.01,
    visit_duration_minutes: 60,
    day_index: dm.day,
    order_in_day: dm.order,
  }));
}

// opts always passed for determinism
const opts = { nowUtc: FIXED_NOW, prodId: FIXED_PRODID };

// ---- escapeText -------------------------------------------------------------

describe('escapeText', () => {
  it('escapes backslash', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('escapes comma', () => {
    expect(escapeText('a,b')).toBe('a\\,b');
  });

  it('escapes semicolon', () => {
    expect(escapeText('a;b')).toBe('a\\;b');
  });

  it('escapes embedded newlines as \\n', () => {
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeText('line1\r\nline2')).toBe('line1\\nline2');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeText('Hello World')).toBe('Hello World');
  });
});

// ---- foldLine ---------------------------------------------------------------

describe('foldLine', () => {
  it('does not fold lines ≤75 octets', () => {
    const short = 'SUMMARY:Short title';
    expect(foldLine(short)).toBe(short);
  });

  it('folds lines > 75 octets with CRLF + space continuation', () => {
    const longLine = 'DESCRIPTION:' + 'A'.repeat(80);
    const folded = foldLine(longLine);
    const foldedLines = folded.split('\r\n');
    // Each segment must be ≤75 octets (first) or ≤75 counting the leading space
    expect(foldedLines[0]!.length).toBeLessThanOrEqual(75);
    for (let i = 1; i < foldedLines.length; i++) {
      // Continuation lines start with space; total length including space ≤75
      expect(foldedLines[i]!.startsWith(' ')).toBe(true);
      expect(foldedLines[i]!.length).toBeLessThanOrEqual(75);
    }
  });

  it('reassembles to original content when unfolded', () => {
    const longLine = 'SUMMARY:' + 'B'.repeat(200);
    const folded = foldLine(longLine);
    const unfolded = folded.split('\r\n').map((l, i) => (i === 0 ? l : l.slice(1))).join('');
    expect(unfolded).toBe(longLine);
  });
});

// ---- tripToIcs core ---------------------------------------------------------

describe('tripToIcs — structure', () => {
  const trip = makeTrip();
  const places = makePlaces(3, [
    { day: 0, order: 0 },
    { day: 0, order: 1 },
    { day: 1, order: 0 },
  ]);

  let ics: string;
  beforeAll(() => {
    ics = tripToIcs(trip, places, [], opts);
  });

  it('starts with BEGIN:VCALENDAR', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });

  it('ends with END:VCALENDAR and trailing CRLF', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('contains exactly 3 VEVENT blocks', () => {
    const beginCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const endCount = (ics.match(/END:VEVENT/g) ?? []).length;
    expect(beginCount).toBe(3);
    expect(endCount).toBe(3);
  });

  it('includes the test PRODID', () => {
    expect(ics).toContain(`PRODID:${FIXED_PRODID}`);
  });

  it('uses only CRLF line endings (no bare LF)', () => {
    // After removing all \r\n, no \n should remain
    const stripped = ics.replace(/\r\n/g, '');
    expect(stripped.includes('\n')).toBe(false);
  });

  it('includes VERSION:2.0', () => {
    expect(ics).toContain('VERSION:2.0\r\n');
  });

  it('includes CALSCALE:GREGORIAN', () => {
    expect(ics).toContain('CALSCALE:GREGORIAN\r\n');
  });

  it('includes METHOD:PUBLISH', () => {
    expect(ics).toContain('METHOD:PUBLISH\r\n');
  });

  it('no line exceeds 75 octets', () => {
    const encoder = new TextEncoder();
    const lines = ics.split('\r\n');
    // Last entry after final CRLF is empty — skip it
    const contentLines = lines.filter((l) => l.length > 0);
    for (const line of contentLines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

// ---- timezone handling -------------------------------------------------------

describe('tripToIcs — timezone', () => {
  it('emits VTIMEZONE block and DTSTART;TZID= for known zone', () => {
    const trip = makeTrip({ timezone: 'America/New_York' });
    const places = makePlaces(1, [{ day: 0, order: 0 }]);
    const ics = tripToIcs(trip, places, [], opts);

    expect(ics).toContain('BEGIN:VTIMEZONE\r\n');
    expect(ics).toContain('TZID:America/New_York\r\n');
    expect(ics).toContain('END:VTIMEZONE\r\n');
    expect(ics).toContain('DTSTART;TZID=America/New_York:');
  });

  it('emits absolute UTC DTSTART when timezone is null', () => {
    const trip = makeTrip({ timezone: null });
    const places = makePlaces(1, [{ day: 0, order: 0 }]);
    const ics = tripToIcs(trip, places, [], opts);

    expect(ics).not.toContain('VTIMEZONE');
    // UTC form: DTSTARTfollowed by colon then 15 digit stamp ending in Z
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it('emits absolute UTC when timezone is unknown (not in VTZ_BODIES)', () => {
    const trip = makeTrip({ timezone: 'Pacific/Fakeland' });
    const places = makePlaces(1, [{ day: 0, order: 0 }]);
    const ics = tripToIcs(trip, places, [], opts);

    expect(ics).not.toContain('VTIMEZONE');
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it('DTSTART uses trip start_date at 09:00 UTC for day 0', () => {
    const trip = makeTrip({ timezone: null, start_date: '2026-06-01' });
    const places = makePlaces(1, [{ day: 0, order: 0 }]);
    const ics = tripToIcs(trip, places, [], opts);
    // 09:00 UTC on 2026-06-01 → 20260601T090000Z
    expect(ics).toContain('DTSTART:20260601T090000Z\r\n');
  });

  it('day 1 anchor is one day after day 0 anchor', () => {
    const trip = makeTrip({ timezone: null, start_date: '2026-06-01' });
    const places = makePlaces(2, [
      { day: 0, order: 0 },
      { day: 1, order: 0 },
    ]);
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('DTSTART:20260601T090000Z\r\n'); // day 0
    expect(ics).toContain('DTSTART:20260602T090000Z\r\n'); // day 1
  });
});

// ---- escaping in event fields ------------------------------------------------

describe('tripToIcs — text escaping', () => {
  it('escapes comma in SUMMARY', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      {
        id: 'p1',
        user_title: 'Café, Bakery',
        lat: 38.7,
        lng: -9.2,
        visit_duration_minutes: 60,
        day_index: 0,
        order_in_day: 0,
      },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('SUMMARY:Café\\,');
  });

  it('escapes semicolon in SUMMARY', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      {
        id: 'p1',
        user_title: 'Shop; Market',
        lat: 38.7,
        lng: -9.2,
        visit_duration_minutes: 60,
        day_index: 0,
        order_in_day: 0,
      },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('SUMMARY:Shop\\;');
  });

  it('escapes backslash in SUMMARY', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      {
        id: 'p1',
        user_title: 'A\\B',
        lat: 38.7,
        lng: -9.2,
        visit_duration_minutes: 60,
        day_index: 0,
        order_in_day: 0,
      },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('SUMMARY:A\\\\B');
  });
});

// ---- ungrouped places are skipped -------------------------------------------

describe('tripToIcs — ungrouped places', () => {
  it('skips places with null day_index', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      {
        id: 'p-null',
        user_title: 'Scratch place',
        lat: 0,
        lng: 0,
        visit_duration_minutes: 60,
        day_index: null,
        order_in_day: null,
      },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(vevents).toBe(0);
    expect(ics).not.toContain('Scratch place');
  });

  it('emits only scheduled places when mixed', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      { id: 'p1', user_title: 'Scheduled', lat: 0, lng: 0, visit_duration_minutes: 60, day_index: 0, order_in_day: 0 },
      { id: 'p2', user_title: 'Unscheduled', lat: 0, lng: 0, visit_duration_minutes: 60, day_index: null, order_in_day: null },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(vevents).toBe(1);
    expect(ics).toContain('Scheduled');
    expect(ics).not.toContain('Unscheduled');
  });
});

// ---- Visit falls back to "Visit" when user_title is blank -------------------

describe('tripToIcs — title fallback', () => {
  it('uses "Visit" when user_title is null', () => {
    const trip = makeTrip({ timezone: null });
    const places: IcsPlace[] = [
      { id: 'p1', user_title: null, lat: 0, lng: 0, visit_duration_minutes: 60, day_index: 0, order_in_day: 0 },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('SUMMARY:Visit\r\n');
  });
});

// ---- DTSTAMP uses the passed nowUtc -----------------------------------------

describe('tripToIcs — DTSTAMP', () => {
  it('DTSTAMP reflects the passed nowUtc option', () => {
    const trip = makeTrip({ timezone: null });
    const places = makePlaces(1, [{ day: 0, order: 0 }]);
    const ics = tripToIcs(trip, places, [], opts);
    // FIXED_NOW = 2026-04-24T12:00:00Z → 20260424T120000Z
    expect(ics).toContain('DTSTAMP:20260424T120000Z\r\n');
  });
});

// ---- UID format --------------------------------------------------------------

describe('tripToIcs — UID', () => {
  it('UID is <tripId>-<placeId>@tripvisor', () => {
    const trip = makeTrip({ id: 'trip-xyz', timezone: null });
    const places: IcsPlace[] = [
      { id: 'place-abc', user_title: 'A', lat: 0, lng: 0, visit_duration_minutes: 60, day_index: 0, order_in_day: 0 },
    ];
    const ics = tripToIcs(trip, places, [], opts);
    expect(ics).toContain('UID:trip-xyz-place-abc@tripvisor\r\n');
  });
});

// ---- Golden file comparison --------------------------------------------------

describe('tripToIcs — golden file', () => {
  /**
   * This test generates a canonical output and compares it byte-for-byte with
   * the committed fixture. If the fixture is missing it is auto-created on first
   * run. Re-generate by deleting the fixture and running the test once.
   */
  it('matches the committed sample.ics fixture', () => {
    const trip: IcsTrip = {
      id: 'trip-golden',
      title: 'Golden Trip',
      start_date: '2026-06-01',
      timezone: null,
    };
    const places: IcsPlace[] = [
      { id: 'place-1', user_title: 'First Stop', lat: 38.700000, lng: -9.200000, visit_duration_minutes: 90, day_index: 0, order_in_day: 0 },
      { id: 'place-2', user_title: 'Second Stop', lat: 38.710000, lng: -9.190000, visit_duration_minutes: 60, day_index: 0, order_in_day: 1 },
      { id: 'place-3', user_title: 'Day Two Stop', lat: 38.720000, lng: -9.180000, visit_duration_minutes: 120, day_index: 1, order_in_day: 0 },
    ];

    const goldenOpts = {
      nowUtc: new Date('2026-04-24T10:00:00Z'),
      prodId: '-//Tripvisor//EN',
    };
    const output = tripToIcs(trip, places, [], goldenOpts);

    const fixturePath = path.join(__dirname, '__fixtures__', 'sample.ics');
    if (!fs.existsSync(fixturePath)) {
      // First run: write the fixture. This is intentional bootstrapping.
      fs.writeFileSync(fixturePath, output, { encoding: 'utf8' });
      // Test passes on creation.
      return;
    }
    const existing = fs.readFileSync(fixturePath, { encoding: 'utf8' });
    expect(output).toBe(existing);
  });
});
