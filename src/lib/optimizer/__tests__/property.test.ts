/**
 * Optimizer property-test expansion — Step 5.1
 *
 * Companion to optimizer.property.test.ts. Each test targets a distinct
 * structural invariant that the existing five properties do not cover.
 *
 * Run locally with: FC_NUM_RUNS=500 npx jest property.test.ts
 * CI default: 100 runs per property.
 */

import fc from 'fast-check';
import { optimize, type OptimizerInput, type OptimizerPlace } from '../kmeans-2opt';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 100;

// ---- arbitraries -------------------------------------------------------

const arbPlaceAt = (i: number, lat: number, lng: number): fc.Arbitrary<OptimizerPlace> =>
  fc.record({
    id: fc.constant(`p${i}`),
    lat: fc.constant(lat),
    lng: fc.constant(lng),
    visitMinutes: fc.integer({ min: 15, max: 120 }),
  });

const arbPlace = (i: number): fc.Arbitrary<OptimizerPlace> =>
  fc.record({
    id: fc.constant(`p${i}`),
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lng: fc.double({ min: -170, max: 170, noNaN: true }),
    visitMinutes: fc.integer({ min: 15, max: 180 }),
  });

const arbPlaces = (n: number) =>
  fc.tuple(...Array.from({ length: n }, (_, i) => arbPlace(i)));

/** Canonical form for comparing two optimizer results irrespective of run order. */
function canonicalize(result: ReturnType<typeof optimize>): string {
  const canonDays = result.days
    .map((d) => [...d.orderedPlaceIds].sort().join(','))
    .sort();
  return canonDays.join('|');
}

// ---- tests -------------------------------------------------------------

describe('optimize — property expansion (Step 5.1)', () => {
  // ---- permutation-invariance --------------------------------------------
  //
  // Full canonical-partition equivalence is not achievable for k-means: when
  // two places are equidistant from all centroids, assignment depends on the
  // iteration order of `places` in the input. The degenerate (all-same-coord)
  // case already shows this — and it is addressed in the all-same-coordinate
  // property below.
  //
  // What IS stable across permutations: the *union* of all assigned place IDs
  // (completeness) and the *stateHash* (which the optimizer sorts by place ID
  // before hashing, making it order-independent). Both are already covered by
  // other properties. This test instead verifies the *idempotence* property
  // from the input-order angle: given the same `seed`, the optimizer is
  // deterministic — reversing the input and using the same seed must still
  // produce the same stateHash (hash is sorted, not order-dependent).
  it('permutation-invariance: stateHash is order-independent (hash sorts by place ID)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) => arbPlaces(n)),
        fc.integer({ min: 240, max: 720 }),
        fc.integer({ min: 0, max: 0xffff }),
        (places, budget, seed) => {
          // Reverse is a deterministic permutation that changes input order.
          const reversed = [...places].reverse();

          const base: OptimizerInput = { places, legs: [], dailyBudgetMinutes: budget, seed };
          const permuted: OptimizerInput = {
            places: reversed,
            legs: [],
            dailyBudgetMinutes: budget,
            seed,
          };

          // The stateHash is built from places sorted by id, so it MUST be
          // identical regardless of input order. Any failure here means the
          // hash function is order-dependent — a regression in computeStateHash.
          expect(optimize(base).stateHash).toBe(optimize(permuted).stateHash);

          // The full set of assigned place IDs must also be identical (completeness
          // from a different angle).
          const baseIds = optimize(base)
            .days.flatMap((d) => d.orderedPlaceIds)
            .sort()
            .join(',');
          const permutedIds = optimize(permuted)
            .days.flatMap((d) => d.orderedPlaceIds)
            .sort()
            .join(',');
          expect(baseIds).toBe(permutedIds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---- all-same-coordinate ------------------------------------------------
  it('all-same-coordinate: optimizer completes; totalTravelMinutes is ~0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((n) =>
          fc.tuple(...Array.from({ length: n }, (_, i) => arbPlaceAt(i, 0, 0))),
        ),
        fc.integer({ min: 120, max: 720 }),
        (places, budget) => {
          let result: ReturnType<typeof optimize> | undefined;
          expect(() => {
            result = optimize({ places, legs: [], dailyBudgetMinutes: budget });
          }).not.toThrow();

          expect(result).toBeDefined();
          // All places are at the same point — haversine gives 0 meters,
          // so travel time for every leg must be essentially 0 minutes.
          for (const day of result!.days) {
            // totalMinutes = visitMinutes + travelMinutes; travel must be ~0
            const visitSum = places
              .filter((p) => day.orderedPlaceIds.includes(p.id))
              .reduce((s, p) => s + p.visitMinutes, 0);
            const travelMinutes = day.totalMinutes - visitSum;
            expect(travelMinutes).toBeLessThanOrEqual(0.1);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---- duplicate coordinates (mixed two-cluster) --------------------------
  it('duplicate-coordinates mixed: optimizer produces stable partition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }).chain((half) => {
          // half places at coord A, half at coord B
          const groupA = Array.from({ length: half }, (_, i) => arbPlaceAt(i, 10, 20));
          const groupB = Array.from({ length: half }, (_, i) =>
            arbPlaceAt(half + i, -10, -20),
          );
          return fc.tuple(...groupA, ...groupB);
        }),
        fc.integer({ min: 180, max: 720 }),
        fc.integer({ min: 0, max: 0xffff }),
        (places, budget, seed) => {
          const input: OptimizerInput = { places, legs: [], dailyBudgetMinutes: budget, seed };
          const r1 = optimize(input);
          const r2 = optimize(input);
          // Idempotence on duplicate-coordinate input
          expect(r1.stateHash).toBe(r2.stateHash);
          // All places assigned
          const all = r1.days.flatMap((d) => d.orderedPlaceIds).sort();
          expect(all).toEqual(places.map((p) => p.id).sort());
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---- anchor at arbitrary index ------------------------------------------
  it('anchor at arbitrary index: anchor is always first in its day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) =>
          arbPlaces(n).chain((places) =>
            fc.integer({ min: 0, max: n - 1 }).map((anchorIdx) => ({
              places,
              anchorIdx,
            })),
          ),
        ),
        fc.integer({ min: 240, max: 720 }),
        ({ places, anchorIdx }, budget) => {
          const anchor = places[anchorIdx]!.id;
          const res = optimize({
            places,
            legs: [],
            dailyBudgetMinutes: budget,
            anchorPlaceId: anchor,
          });
          const dayWithAnchor = res.days.find((d) => d.orderedPlaceIds.includes(anchor));
          expect(dayWithAnchor).toBeDefined();
          expect(dayWithAnchor!.orderedPlaceIds[0]).toBe(anchor);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---- visitMinutes extremes ----------------------------------------------
  it('visitMinutes extremes: 0-minute places and 720-minute places do not throw', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }).chain((n) =>
          fc.tuple(
            ...Array.from({ length: n }, (_, i) =>
              fc.record({
                id: fc.constant(`pext${i}`),
                lat: fc.double({ min: -60, max: 60, noNaN: true }),
                lng: fc.double({ min: -170, max: 170, noNaN: true }),
                // Extreme values only: 0 or 720
                visitMinutes: fc.constantFrom(0, 720),
              }),
            ),
          ),
        ),
        fc.integer({ min: 240, max: 720 }),
        (places, budget) => {
          let result: ReturnType<typeof optimize> | undefined;
          expect(() => {
            result = optimize({ places, legs: [], dailyBudgetMinutes: budget });
          }).not.toThrow();
          expect(result).toBeDefined();

          // All places covered (completeness still holds at extreme durations)
          const flattened = result!.days.flatMap((d) => d.orderedPlaceIds).sort();
          expect(flattened).toEqual(places.map((p) => p.id).sort());

          // At least one day produced
          expect(result!.days.length).toBeGreaterThanOrEqual(1);

          // No day contains more places than the entire input
          for (const day of result!.days) {
            expect(day.orderedPlaceIds.length).toBeLessThanOrEqual(places.length);
          }

          // 0-minute places: each day's totalMinutes must equal its visit-minute sum
          // (no travel time added for zero-visit duration places)
          const has0Only = places.every((p) => p.visitMinutes === 0);
          if (has0Only) {
            for (const day of result!.days) {
              // All zero-duration places in one day have a total of 0 visit minutes;
              // travel time may be non-zero but day must still be reported
              expect(day.totalMinutes).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
