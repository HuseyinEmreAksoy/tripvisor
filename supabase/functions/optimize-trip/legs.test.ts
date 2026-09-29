// optimize-trip/legs.ts: pure per-leg mode rules (M5 Y2.3).
//
// Run with:
//   deno test --allow-env supabase/functions/optimize-trip/legs.test.ts

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { test } from 'node:test';
import {
  countLegSources,
  dayDefaultMode,
  dayTotalMinutes,
  effectiveLegMode,
  estimatedDistanceMeters,
  estimateLeg,
  freeDayIndexes,
  greatCircleMeters,
  keptOrderDayIndexes,
  LEG_ESTIMATE_MODEL,
  type LegPlace,
  orderChainByRank,
  planDayLegs,
  routedLegsFromDirections,
  segmentDayLegs,
  userLegMinutes,
  userLegResult,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './legs.ts';

function place(id: string, lat: number, lng: number, extra: Partial<LegPlace> = {}): LegPlace {
  return { id, lat, lng, ...extra };
}

// ---- effective mode ----------------------------------------------------------

test('effective mode: arrival_mode ?? day mode ?? trip mode', () => {
  assertEquals(effectiveLegMode('transit', 'walking', 'driving'), 'transit');
  assertEquals(effectiveLegMode(null, 'walking', 'driving'), 'walking');
  assertEquals(effectiveLegMode(undefined, null, 'driving'), 'driving');
  assertEquals(effectiveLegMode('flight', null, 'driving'), 'flight');
  assertEquals(effectiveLegMode('ferry', 'transit', 'walking'), 'ferry');
});

test('effective mode: values outside the CHECK lists inherit (fail-safe)', () => {
  assertEquals(effectiveLegMode('rocket', 'walking', 'driving'), 'walking');
  // flight/ferry are per-leg only: never a day default.
  assertEquals(effectiveLegMode(null, 'flight', 'bicycling'), 'bicycling');
  assertEquals(dayDefaultMode('ferry', 'driving'), 'driving');
  assertEquals(dayDefaultMode('transit', 'driving'), 'transit');
});

test('user minutes count only with arrival_mode set and in 1..1440', () => {
  assertEquals(userLegMinutes('flight', 120), 120);
  assertEquals(userLegMinutes('driving', 1), 1);
  assertEquals(userLegMinutes('ferry', 1440), 1440);
  assertEquals(userLegMinutes(null, 120), null, 'minutes without a mode are ignored (0035)');
  assertEquals(userLegMinutes('flight', 0), null);
  assertEquals(userLegMinutes('flight', 1441), null);
  assertEquals(userLegMinutes('flight', 12.5), null);
  assertEquals(userLegMinutes('flight', null), null);
});

// ---- estimates -----------------------------------------------------------------

const IST = { lat: 41.0082, lng: 28.9784 };
const LON = { lat: 51.5074, lng: -0.1278 };

test('great circle: Istanbul-London is about 2,500 km', () => {
  const km = greatCircleMeters(IST, LON) / 1000;
  assert(km > 2450 && km < 2550, `got ${km}`);
});

test('flight estimate: great circle at 800 km/h + 2 h airport overhead', () => {
  const gc = greatCircleMeters(IST, LON);
  const est = estimateLeg('flight', IST, LON);
  assertEquals(est.distanceMeters, Math.round(gc));
  assertEquals(est.durationSeconds, Math.round(Math.round(gc) / (800 / 3.6) + 2 * 3600));
  // ~3.1 h in the air + 2 h
  assert(est.durationSeconds > 5 * 3600 && est.durationSeconds < 5.3 * 3600);
});

test('ferry estimate: great circle at 25 km/h, no overhead', () => {
  const a = { lat: 41.0, lng: 29.0 };
  const b = { lat: 41.1, lng: 29.0 }; // ~11.1 km
  const est = estimateLeg('ferry', a, b);
  const gc = Math.round(greatCircleMeters(a, b));
  assertEquals(est.distanceMeters, gc);
  assertEquals(est.durationSeconds, Math.round(gc / (25 / 3.6)));
});

test('transit estimate: x1.3 detour at 25 km/h + 5 min transfers', () => {
  const a = { lat: 38.7, lng: -9.2 };
  const b = { lat: 38.75, lng: -9.1 };
  const est = estimateLeg('transit', a, b);
  const dist = Math.round(greatCircleMeters(a, b) * 1.3);
  assertEquals(est.distanceMeters, dist);
  assertEquals(est.durationSeconds, Math.round(dist / (25 / 3.6) + 300));
  assertEquals(LEG_ESTIMATE_MODEL.transit.overheadMinutes, 5);
});

test('ground estimates use their typical speeds; the same spot is 0/0', () => {
  const a = { lat: 38.7, lng: -9.2 };
  const b = { lat: 38.71, lng: -9.2 };
  const walk = estimateLeg('walking', a, b);
  const drive = estimateLeg('driving', a, b);
  const bike = estimateLeg('bicycling', a, b);
  assert(walk.durationSeconds > bike.durationSeconds && bike.durationSeconds > drive.durationSeconds);
  assertEquals(estimateLeg('flight', a, a), { durationSeconds: 0, distanceMeters: 0 });
  assertEquals(estimatedDistanceMeters('transit', a, a), 0);
});

// ---- planning + segmentation ---------------------------------------------------

test('mixed day: drive -> transit -> walk -> walk -> flight -> ferry(90 min) -> drive -> drive', () => {
  const chain = [
    place('p0', 38.70, -9.20),
    place('p1', 38.71, -9.19), // inherits the day default (driving)
    place('p2', 38.72, -9.18, { arrival_mode: 'transit' }),
    place('p3', 38.721, -9.179, { arrival_mode: 'walking' }),
    place('p4', 38.722, -9.178, { arrival_mode: 'walking' }),
    place('p5', 41.90, 12.49, { arrival_mode: 'flight' }),
    place('p6', 40.85, 14.26, { arrival_mode: 'ferry', arrival_minutes: 90 }),
    place('p7', 40.86, 14.27, { arrival_mode: 'driving' }),
    place('p8', 40.87, 14.28), // day default: driving -> same run as p7
  ];
  const planned = planDayLegs(chain, 'driving', 'walking');
  assertEquals(
    planned.map((l: { mode: string }) => l.mode),
    ['driving', 'transit', 'walking', 'walking', 'flight', 'ferry', 'driving', 'driving'],
  );
  const segments = segmentDayLegs(planned);
  assertEquals(
    segments.map((s: { kind: string; legs?: unknown[] }) => `${s.kind}:${s.kind === 'run' ? s.legs!.length : 1}`),
    ['run:1', 'transit:1', 'run:2', 'estimate:1', 'user:1', 'run:2'],
  );
  const firstRun = segments[0] as { kind: 'run'; mode: string };
  const walkRun = segments[2] as { kind: 'run'; mode: string; legs: Array<{ from: LegPlace; to: LegPlace }> };
  assertEquals(firstRun.mode, 'driving');
  assertEquals(walkRun.mode, 'walking');
  assertEquals(walkRun.legs.map((l) => `${l.from.id}>${l.to.id}`), ['p2>p3', 'p3>p4']);
});

test('the first place of a day has no inbound leg (its arrival_mode is inert)', () => {
  const chain = [place('a', 0, 0, { arrival_mode: 'flight' }), place('b', 0, 0.01)];
  const planned = planDayLegs(chain, null, 'walking');
  assertEquals(planned.length, 1);
  assertEquals(planned[0]!.mode, 'walking');
});

test('user minutes on a routable mode skip routing (source user)', () => {
  const chain = [place('a', 38.7, -9.2), place('b', 38.8, -9.1, { arrival_mode: 'transit', arrival_minutes: 35 })];
  const segments = segmentDayLegs(planDayLegs(chain, null, 'driving'));
  assertEquals(segments.map((s: { kind: string }) => s.kind), ['user']);
  const seg = segments[0];
  if (!seg || seg.kind !== 'user') throw new Error('expected a user segment');
  const result = userLegResult(seg.leg);
  assertEquals(result.source, 'user');
  assertEquals(result.mode, 'transit');
  assertEquals(result.durationSeconds, 35 * 60);
  assertEquals(result.polyline, null);
});

// ---- kept-order days -------------------------------------------------------------

test('kept-order days: any place arriving by flight or ferry keeps its day', () => {
  const days = keptOrderDayIndexes([
    { day_index: 0, arrival_mode: null },
    { day_index: 2, arrival_mode: 'ferry' },
    { day_index: 1, arrival_mode: 'transit' },
    { day_index: 3, arrival_mode: 'flight' },
    { day_index: 3, arrival_mode: 'flight' },
    { day_index: null, arrival_mode: 'flight' }, // unscheduled: no day to keep
  ]);
  assertEquals(days, [2, 3]);
});

test('free day indexes skip kept days (identity when none are kept)', () => {
  assertEquals(freeDayIndexes(3, new Set()), [0, 1, 2]);
  assertEquals(freeDayIndexes(3, new Set([1, 2])), [0, 3, 4]);
  assertEquals(freeDayIndexes(0, new Set([0])), []);
});

// ---- rank order (moved from the manual branch) -----------------------------------

test('rank order: all-NULL day keeps legacy order_in_day (NULLs last)', () => {
  const list = [
    { id: 'c', order_in_day: null, manual_rank: null },
    { id: 'b', order_in_day: 1, manual_rank: null },
    { id: 'a', order_in_day: 0, manual_rank: null },
  ];
  orderChainByRank(list);
  assertEquals(list.map((p) => p.id), ['a', 'b', 'c']);
});

test('rank order: ranked rows first by string compare, then unranked in legacy order', () => {
  const list = [
    { id: 'x', order_in_day: 0, manual_rank: null },
    { id: 'r2', order_in_day: 1, manual_rank: 'b' },
    { id: 'y', order_in_day: 2, manual_rank: null },
    { id: 'r1', order_in_day: 3, manual_rank: 'a0' },
  ];
  orderChainByRank(list);
  assertEquals(list.map((p) => p.id), ['r1', 'r2', 'x', 'y']);
});

// ---- directions bodies -> leg results ----------------------------------------------

const A = place('a', 38.70, -9.20);
const B = place('b', 38.71, -9.19);
const C = place('c', 38.72, -9.18);

/** Narrow a routedLegsFromDirections result to its results (throws otherwise). */
function okResults(out: ReturnType<typeof routedLegsFromDirections>) {
  if (out.kind !== 'ok') throw new Error('expected ok, got ' + out.kind);
  return out.results;
}

test('single driving leg: top-level numbers + provider source', () => {
  const out = routedLegsFromDirections(
    { polyline: 'xyz', durationSeconds: 600.4, distanceMeters: 5000, provider: 'ors' },
    [{ from: A, to: B, mode: 'driving', userMinutes: null }],
  );
  const r = okResults(out)[0]!;
  assertEquals(r.source, 'ors');
  assertEquals(r.durationSeconds, 600);
  assertEquals(r.polyline, 'xyz');
});

test('a body without provider (pre-Y2.3 function) is labelled google', () => {
  const out = routedLegsFromDirections(
    { polyline: 'xyz', durationSeconds: 60, distanceMeters: 50 },
    [{ from: A, to: B, mode: 'walking', userMinutes: null }],
  );
  assertEquals(okResults(out)[0]!.source, 'google');
});

test('transit: zeros / noRoute are not a route; steps are kept', () => {
  const leg = [{ from: A, to: B, mode: 'transit' as const, userMinutes: null }];
  assertEquals(routedLegsFromDirections({ polyline: null, durationSeconds: 0, distanceMeters: 0 }, leg).kind, 'invalid');
  assertEquals(
    routedLegsFromDirections({ polyline: null, durationSeconds: 0, distanceMeters: 0, noRoute: true }, leg).kind,
    'invalid',
  );
  const steps = [{ polyline: 'p', travelMode: 'TRANSIT', lineName: 'M2', vehicleType: 'SUBWAY' }];
  const ok = okResults(
    routedLegsFromDirections(
      { polyline: null, durationSeconds: 1200, distanceMeters: 7000, transitSteps: steps, provider: 'google' },
      leg,
    ),
  );
  assertEquals(ok[0]!.transitSteps, steps);
  assertEquals(ok[0]!.polyline, null);
  assertEquals(ok[0]!.source, 'google');
});

test('multi-leg run: per-leg split, or no_breakdown when absent / inconsistent', () => {
  const legs = [
    { from: A, to: B, mode: 'walking' as const, userMinutes: null },
    { from: B, to: C, mode: 'walking' as const, userMinutes: null },
  ];
  const split = okResults(routedLegsFromDirections(
    {
      polyline: 'whole',
      durationSeconds: 900,
      distanceMeters: 1200,
      provider: 'ors',
      legs: [
        { polyline: 'l1', durationSeconds: 400, distanceMeters: 500 },
        { polyline: 'l2', durationSeconds: 500, distanceMeters: 700 },
      ],
    },
    legs,
  ));
  assertEquals(split.map((r) => `${r.fromId}>${r.toId}:${r.polyline}:${r.durationSeconds}`), [
    'a>b:l1:400',
    'b>c:l2:500',
  ]);
  assertEquals(
    routedLegsFromDirections({ polyline: 'whole', durationSeconds: 900, distanceMeters: 1200 }, legs).kind,
    'no_breakdown',
  );
  assertEquals(
    routedLegsFromDirections(
      { polyline: 'w', durationSeconds: 1, distanceMeters: 1, legs: [{ polyline: 'l1', durationSeconds: 1, distanceMeters: 1 }] },
      legs,
    ).kind,
    'no_breakdown',
  );
});

test('a ground leg without a polyline is unusable', () => {
  assertEquals(
    routedLegsFromDirections({ polyline: null, durationSeconds: 60, distanceMeters: 50 }, [
      { from: A, to: B, mode: 'driving', userMinutes: null },
    ]).kind,
    'invalid',
  );
});

test('source counts and day totals', () => {
  assertEquals(
    countLegSources([{ source: 'ors' }, { source: 'estimate' }, { source: 'estimate' }, { source: 'user' }]),
    { ors: 1, google: 0, estimate: 2, user: 1 },
  );
  assertEquals(
    dayTotalMinutes(
      [{ visit_duration_minutes: 60 }, { visit_duration_minutes: 30 }],
      [{ durationSeconds: 1800 }],
    ),
    120,
  );
});
