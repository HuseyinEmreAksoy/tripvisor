import fc from 'fast-check';
import { optimize, type OptimizerInput, type OptimizerPlace } from '../kmeans-2opt';

const arbPlace = (i: number): fc.Arbitrary<OptimizerPlace> =>
  fc.record({
    id: fc.constant(`p${i}`),
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lng: fc.double({ min: -170, max: 170, noNaN: true }),
    visitMinutes: fc.integer({ min: 15, max: 180 }),
  });

const arbPlaces = (n: number) => fc.tuple(...Array.from({ length: n }, (_, i) => arbPlace(i)));

describe('optimize — property-based', () => {
  it('completeness: every input place appears in exactly one day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbPlaces(n)),
        fc.integer({ min: 120, max: 720 }),
        fc.integer({ min: 0, max: 0xffff }),
        (places, budget, seed) => {
          const res = optimize({
            places,
            legs: [],
            dailyBudgetMinutes: budget,
            seed,
          });
          const flattened = res.days.flatMap((d) => d.orderedPlaceIds);
          expect(flattened.sort()).toEqual(places.map((p) => p.id).sort());
          // No duplicates.
          expect(new Set(flattened).size).toBe(flattened.length);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('idempotence: same input + seed produces same output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) => arbPlaces(n)),
        fc.integer({ min: 120, max: 720 }),
        fc.integer({ min: 0, max: 0xffff }),
        (places, budget, seed) => {
          const input: OptimizerInput = {
            places,
            legs: [],
            dailyBudgetMinutes: budget,
            seed,
          };
          const a = optimize(input);
          const b = optimize(input);
          expect(a.stateHash).toBe(b.stateHash);
          expect(a.days).toEqual(b.days);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('anchor pinning: if anchor set, it is first in its day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }).chain((n) => arbPlaces(n)),
        fc.integer({ min: 240, max: 720 }),
        (places, budget) => {
          const anchor = places[0]!.id;
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
      { numRuns: 100 },
    );
  });

  it('stateHash is sensitive to place mutations', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }).chain((n) => arbPlaces(n)), (places) => {
        const h1 = optimize({ places, legs: [], dailyBudgetMinutes: 480 }).stateHash;
        const tweaked: OptimizerPlace[] = [
          ...places.slice(0, -1),
          { ...places[places.length - 1]!, visitMinutes: places[places.length - 1]!.visitMinutes + 15 },
        ];
        const h2 = optimize({ places: tweaked, legs: [], dailyBudgetMinutes: 480 }).stateHash;
        expect(h1).not.toBe(h2);
      }),
      { numRuns: 20 },
    );
  });

  it('no day holds more places than input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => arbPlaces(n)),
        fc.integer({ min: 120, max: 720 }),
        (places, budget) => {
          const res = optimize({ places, legs: [], dailyBudgetMinutes: budget });
          for (const day of res.days) {
            expect(day.orderedPlaceIds.length).toBeLessThanOrEqual(places.length);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
