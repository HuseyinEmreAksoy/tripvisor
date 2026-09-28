import { describe, expect, it } from '@jest/globals';
import {
  extractAppConfirmationCode,
  extractConfirmationCode,
  formatStayDate,
  nightsBetween,
  nightsLabel,
  stayDirectionsUrl,
  stripConfirmationLine,
  withConfirmationCode,
} from '../stayUtils';

describe('nights + dates', () => {
  it('counts calendar nights, 0 for bad or reversed input', () => {
    expect(nightsBetween('2026-05-10', '2026-05-13')).toBe(3);
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2); // across a DST change
    expect(nightsBetween('2026-05-13', '2026-05-10')).toBe(0);
    expect(nightsBetween('nope', '2026-05-10')).toBe(0);
    expect(nightsLabel(1)).toBe('1 night');
    expect(nightsLabel(2)).toBe('2 nights');
  });
  it('formats a stay date deterministically', () => {
    expect(formatStayDate('2026-05-10')).toBe('Sun 10 May');
    expect(formatStayDate('bad')).toBe('bad');
  });
});

describe('confirmation codes', () => {
  it('finds common booking-email shapes', () => {
    expect(extractConfirmationCode('Confirmation: HX7Q29')).toBe('HX7Q29');
    expect(extractConfirmationCode('Late arrival\nBooking ref #X7Y2')).toBe('X7Y2');
    expect(extractConfirmationCode('Reservation number: 12345678')).toBe('12345678');
    expect(extractConfirmationCode('PNR: QXBRZL')).toBe('QXBRZL');
  });
  it('ignores prose that is not a code', () => {
    expect(extractConfirmationCode('Booking: done')).toBeNull();
    expect(extractConfirmationCode('Breakfast included')).toBeNull();
    expect(extractConfirmationCode(null)).toBeNull();
  });
  it('strips and re-composes the confirmation line', () => {
    expect(stripConfirmationLine('Confirmation: HX7Q29\nLate check-in OK')).toBe('Late check-in OK');
    expect(stripConfirmationLine('Confirmation: HX7Q29')).toBeNull();
    expect(withConfirmationCode('Late check-in OK', 'AB12')).toBe('Confirmation: AB12\nLate check-in OK');
    expect(withConfirmationCode('Confirmation: OLD1\nKeys at desk', 'NEW2')).toBe('Confirmation: NEW2\nKeys at desk');
    expect(withConfirmationCode('Confirmation: OLD1\nKeys at desk', '')).toBe('Keys at desk');
    expect(withConfirmationCode('', null)).toBeNull();
  });

  it('round-trips any token the edit sheet saves', () => {
    for (const code of ['ABCD', 'abcd', 'AB', 'a1', 'AB/12', 'x.y_z', 'Q-9', 'CONFIRMED', 'ö7ß']) {
      const saved = withConfirmationCode('Keys at desk', code);
      expect(saved).toBe(`Confirmation: ${code}\nKeys at desk`);
      expect(extractConfirmationCode(saved)).toBe(code);
      expect(extractAppConfirmationCode(saved)).toBe(code);
      expect(stripConfirmationLine(saved)).toBe('Keys at desk');
    }
  });

  it('replaces, never duplicates, the app line on re-save', () => {
    let notes = withConfirmationCode('Late check-in', 'abcd');
    notes = withConfirmationCode(stripConfirmationLine(notes), extractAppConfirmationCode(notes));
    notes = withConfirmationCode(notes, 'ab');
    expect(notes).toBe('Confirmation: ab\nLate check-in');
    // A stray duplicate app line (older data) collapses to one.
    expect(withConfirmationCode('Confirmation: X1\nConfirmation: X2\nHi', 'Y3')).toBe('Confirmation: Y3\nHi');
    expect(withConfirmationCode('Hi', ' A B ')).toBe('Confirmation: AB\nHi');
  });

  it('reads pasted shapes for display but never strips or rewrites them', () => {
    const pasted = 'Booking ref #X7Y2\nBreakfast 7-10';
    expect(extractConfirmationCode(pasted)).toBe('X7Y2');
    expect(extractAppConfirmationCode(pasted)).toBeNull();
    expect(stripConfirmationLine(pasted)).toBe(pasted);
    // No code typed in the sheet → notes saved verbatim.
    expect(withConfirmationCode(pasted, '')).toBe(pasted);
    // Heuristic false positive stays as the user wrote it, in place.
    const prose = 'Late arrival\nBooking: CONFIRMED';
    expect(extractConfirmationCode(prose)).toBe('CONFIRMED');
    expect(stripConfirmationLine(prose)).toBe(prose);
    expect(withConfirmationCode(prose, null)).toBe(prose);
    // The app line wins over a pasted one.
    expect(extractConfirmationCode('Confirmation: ab\nPNR: QXBRZL')).toBe('ab');
  });
});

describe('stayDirectionsUrl', () => {
  const base = { name: 'Hotel', google_place_id: null, address: null, lat: null, lng: null };
  it('uses coordinates when known', () => {
    const url = stayDirectionsUrl({ ...base, lat: 41.9, lng: 12.5, google_place_id: 'P1' }, 'android');
    expect(url).toContain('google.com/maps/dir');
    expect(url).toContain('destination_place_id=P1');
  });
  it('falls back to the address (Apple Maps on iOS)', () => {
    expect(stayDirectionsUrl({ ...base, address: '1 Via Roma' }, 'web')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20Via%20Roma',
    );
    expect(stayDirectionsUrl({ ...base, address: '1 Via Roma' }, 'ios')).toContain('maps.apple.com/?daddr=1%20Via%20Roma');
  });
  it('returns null with neither', () => {
    expect(stayDirectionsUrl(base, 'android')).toBeNull();
  });
});
