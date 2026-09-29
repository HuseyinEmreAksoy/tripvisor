/**
 * M5 Y2.3: pure helpers for per-leg transport modes (src/api/routes.types.ts).
 * The server-side twin of `effectiveLegMode` is
 * supabase/functions/optimize-trip/legs.ts (Deno tests there); these cases
 * pin the client copy to the same rule.
 */
import { describe, expect, it } from '@jest/globals';
import {
  dayLegsFor,
  effectiveLegMode,
  isDayLeg,
  isEstimatedLeg,
  isKeptOrderLegMode,
  isUserTimedLeg,
  keptOrderDaySet,
  OPTIMIZE_CONTRACT_VERSION,
  orderLegsForHopLookup,
} from '../routes.types';

describe('effectiveLegMode', () => {
  it('prefers the arrival override, then the day default, then the trip mode', () => {
    expect(effectiveLegMode('transit', 'walking', 'driving')).toBe('transit');
    expect(effectiveLegMode(null, 'walking', 'driving')).toBe('walking');
    expect(effectiveLegMode(undefined, null, 'bicycling')).toBe('bicycling');
    expect(effectiveLegMode('flight', 'walking', 'driving')).toBe('flight');
  });

  it('treats unknown values as absent, and never uses flight/ferry as a day default', () => {
    expect(effectiveLegMode('rocket', 'walking', 'driving')).toBe('walking');
    expect(effectiveLegMode(null, 'ferry', 'driving')).toBe('driving');
  });
});

describe('leg source helpers', () => {
  it('flags estimates (≈) and user-timed legs; absent source is a routed leg', () => {
    expect(isEstimatedLeg({ source: 'estimate' })).toBe(true);
    expect(isEstimatedLeg({ source: 'ors' })).toBe(false);
    expect(isEstimatedLeg({})).toBe(false);
    expect(isUserTimedLeg({ source: 'user' })).toBe(true);
    expect(isUserTimedLeg({ source: 'google' })).toBe(false);
  });

  it('knows which modes keep a day in order', () => {
    expect(isKeptOrderLegMode('flight')).toBe(true);
    expect(isKeptOrderLegMode('ferry')).toBe(true);
    expect(isKeptOrderLegMode('transit')).toBe(false);
    expect(isKeptOrderLegMode(null)).toBe(false);
  });
});

describe('leg ordering for from→to lookups', () => {
  const legs = [
    { id: 'day0-a', day_index: 0 },
    { id: 'cache-a', day_index: -1 },
    { id: 'day1-a', day_index: 1 },
    { id: 'cache-b', day_index: -1 },
    { id: 'day0-b', day_index: 0 },
  ];

  it('puts matrix-cache rows first so a day leg wins a last-wins Map.set', () => {
    expect(orderLegsForHopLookup(legs).map((l) => l.id)).toEqual([
      'cache-a',
      'cache-b',
      'day0-a',
      'day1-a',
      'day0-b',
    ]);
    // Last-wins lookup keyed by pair: the day leg survives.
    const byPair = new Map<string, string>();
    for (const l of orderLegsForHopLookup([
      { id: 'day', day_index: 2, pair: 'x>y' },
      { id: 'cache', day_index: -1, pair: 'x>y' },
    ])) {
      byPair.set(l.pair, l.id);
    }
    expect(byPair.get('x>y')).toBe('day');
  });

  it('does not mutate its input', () => {
    const copy = [...legs];
    orderLegsForHopLookup(legs);
    expect(legs).toEqual(copy);
  });

  it('selects one day and tells day legs from cache rows', () => {
    expect(dayLegsFor(legs, 0).map((l) => l.id)).toEqual(['day0-a', 'day0-b']);
    expect(dayLegsFor(legs, -1)).toEqual([]);
    expect(isDayLeg({ day_index: 0 })).toBe(true);
    expect(isDayLeg({ day_index: -1 })).toBe(false);
  });
});

describe('optimize-trip contract v2 fields', () => {
  it('reads keptOrderDays tolerantly (older servers omit it)', () => {
    expect([...keptOrderDaySet({ keptOrderDays: [2, 0] })].sort()).toEqual([0, 2]);
    expect(keptOrderDaySet({}).size).toBe(0);
    expect(keptOrderDaySet(undefined).size).toBe(0);
    expect(OPTIMIZE_CONTRACT_VERSION).toBe(2);
  });
});
