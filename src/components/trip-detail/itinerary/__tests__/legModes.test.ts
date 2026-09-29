import { describe, expect, it } from '@jest/globals';
import type { TripLeg } from '@/api/types';
import {
  acceptsMinutes,
  buildLegChipModel,
  keptOrderDays,
  legChipFromLeg,
  legModeOptions,
  parseLegMinutes,
} from '../legModes';
import { legendModesFor } from '../MapLegend';
import { arcPoints, legPolyline, legStroke } from '@/components/Map/legGeometry';

function leg(over: Partial<TripLeg> = {}): TripLeg {
  return {
    id: 'l1',
    trip_id: 't1',
    from_place_id: 'a',
    to_place_id: 'b',
    day_index: 0,
    transport_mode: 'driving',
    duration_seconds: 1200,
    distance_meters: 8000,
    source: 'ors',
    polyline: null,
    transit_steps: null,
    computed_at: '2026-09-29T00:00:00Z',
    ...over,
  };
}

describe('legModeOptions', () => {
  it('offers flight/ferry only between scheduled stops', () => {
    expect(legModeOptions(true)).toEqual(['driving', 'walking', 'bicycling', 'transit', 'flight', 'ferry']);
    expect(legModeOptions(false)).not.toContain('flight');
    expect(legModeOptions(false)).not.toContain('ferry');
  });
  it('takes minutes for flight, ferry and transit only', () => {
    expect(acceptsMinutes('flight')).toBe(true);
    expect(acceptsMinutes('ferry')).toBe(true);
    expect(acceptsMinutes('transit')).toBe(true);
    expect(acceptsMinutes('driving')).toBe(false);
  });
});

describe('parseLegMinutes', () => {
  it('accepts 1–1440 whole minutes only', () => {
    expect(parseLegMinutes('120')).toBe(120);
    expect(parseLegMinutes(' 1440 ')).toBe(1440);
    expect(parseLegMinutes('0')).toBeNull();
    expect(parseLegMinutes('1441')).toBeNull();
    expect(parseLegMinutes('12,5')).toBeNull();
    expect(parseLegMinutes('')).toBeNull();
  });
});

describe('buildLegChipModel', () => {
  it('uses arrival_mode ?? day ?? trip, and marks estimated legs with ≈', () => {
    const m = buildLegChipModel({
      leg: leg({ transport_mode: 'transit', source: 'estimate' }),
      toPlace: { arrival_mode: null, arrival_minutes: null },
      dayMode: 'transit',
      tripMode: 'driving',
    });
    expect(m).toMatchObject({ mode: 'transit', overridden: false, minutes: 20, estimated: true, stale: false });
  });

  it('shows the user minutes right away when a flight override is newer than the leg', () => {
    const m = buildLegChipModel({
      leg: leg({ transport_mode: 'driving' }),
      toPlace: { arrival_mode: 'flight', arrival_minutes: 120 },
      dayMode: null,
      tripMode: 'driving',
    });
    expect(m).toMatchObject({ mode: 'flight', overridden: true, minutes: 120, userTimed: true, stale: true });
  });

  it('marks a stale leg without user minutes as approximate', () => {
    const m = buildLegChipModel({
      leg: leg({ transport_mode: 'driving' }),
      toPlace: { arrival_mode: 'walking' },
      dayMode: null,
      tripMode: 'driving',
    });
    expect(m).toMatchObject({ mode: 'walking', estimated: true, stale: true });
  });

  it('has no duration before any leg is computed', () => {
    const m = buildLegChipModel({ leg: undefined, toPlace: {}, dayMode: 'bicycling', tripMode: 'driving' });
    expect(m).toMatchObject({ mode: 'bicycling', minutes: null, estimated: false });
  });

  it('legChipFromLeg keeps the stored leg mode (read-only callers)', () => {
    expect(legChipFromLeg(leg({ transport_mode: 'ferry', source: 'user' }), 'driving')).toMatchObject({
      mode: 'ferry',
      userTimed: true,
      stale: false,
    });
  });
});

describe('keptOrderDays', () => {
  const places = [
    { day_index: 0, arrival_mode: 'ferry' as const },
    { day_index: 0, arrival_mode: 'flight' as const },
    { day_index: 1, arrival_mode: 'walking' as const },
    { day_index: null, arrival_mode: 'flight' as const },
  ];
  it('lists days holding a flight/ferry arrival in optimized mode (flight wins the label)', () => {
    expect([...keptOrderDays(places, 'optimized')]).toEqual([[0, 'flight']]);
  });
  it('is empty in manual mode', () => {
    expect(keptOrderDays(places, 'manual').size).toBe(0);
  });
});

describe('map leg geometry', () => {
  it('styles legs by mode', () => {
    expect(legStroke('walking', true)).toBe('dotted');
    expect(legStroke('transit', false)).toBe('dashed');
    expect(legStroke('flight', false)).toBe('arc');
    expect(legStroke('ferry', false)).toBe('dashed');
    expect(legStroke('driving', true)).toBe('solid');
    expect(legStroke('driving', false)).toBe('dashed'); // estimate: no polyline
  });

  it('draws a flight as a curved arc between the stops', () => {
    const pts = arcPoints({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 10);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual({ lat: 0, lng: 0 });
    expect(pts[10]).toEqual({ lat: 0, lng: 10 });
    expect(Math.abs(pts[5]!.lat)).toBeGreaterThan(0.5); // bowed, not straight
  });

  it('builds dashed blue ferries and skips legs to unknown places', () => {
    const a = { lat: 41, lng: 29 };
    const b = { lat: 41.1, lng: 29.1 };
    const ferry = legPolyline(leg({ transport_mode: 'ferry' }), { from: a, to: b }, '#2767C4');
    expect(ferry).toMatchObject({ isDashed: true, strokeColor: '#2767C4', from: a, to: b });
    const flight = legPolyline(leg({ transport_mode: 'flight' }), { from: a, to: b }, '#000');
    expect(flight?.isDashed).toBe(true);
    expect(flight?.points.length).toBeGreaterThan(2);
    expect(legPolyline(leg(), { from: a, to: undefined }, '#000')).toBeNull();
  });

  it('only shows a legend when the map mixes line styles', () => {
    expect(legendModesFor([{ transport_mode: 'driving', polyline: 'x' }])).toEqual([]);
    expect(
      legendModesFor([
        { transport_mode: 'flight', polyline: null },
        { transport_mode: 'driving', polyline: 'x' },
      ]),
    ).toEqual(['driving', 'flight']);
  });
});
