import { optimize, type OptimizerInput, type OptimizerPlace } from '../kmeans-2opt';
import lisbon5 from '../__fixtures__/lisbon-5.json';

describe('optimize — unit (fixtures)', () => {
  it('handles empty input', () => {
    const res = optimize({ places: [], legs: [], dailyBudgetMinutes: 480 });
    expect(res.days).toEqual([]);
    expect(res.stateHash).toBeTruthy();
  });

  it('produces a single day for a single place', () => {
    const res = optimize({
      places: [{ id: 'a', lat: 0, lng: 0, visitMinutes: 30 }],
      legs: [],
      dailyBudgetMinutes: 480,
    });
    expect(res.days).toHaveLength(1);
    expect(res.days[0]!.orderedPlaceIds).toEqual(['a']);
  });

  it('assigns every lisbon place to exactly one day', () => {
    const res = optimize(lisbon5.input as OptimizerInput);
    const placed = res.days.flatMap((d) => d.orderedPlaceIds);
    const ids = (lisbon5.input.places as OptimizerPlace[]).map((p) => p.id);
    expect(placed.sort()).toEqual(ids.sort());
  });

  it('is deterministic for the same input + seed', () => {
    const a = optimize({ ...(lisbon5.input as OptimizerInput), seed: 42 });
    const b = optimize({ ...(lisbon5.input as OptimizerInput), seed: 42 });
    expect(a.days).toEqual(b.days);
    expect(a.stateHash).toBe(b.stateHash);
  });

  it('pins anchor place to first position of its day', () => {
    const input: OptimizerInput = {
      places: [
        { id: 'hotel', lat: 38.72, lng: -9.14, visitMinutes: 0 },
        { id: 'b', lat: 38.7, lng: -9.2, visitMinutes: 60 },
        { id: 'c', lat: 38.71, lng: -9.15, visitMinutes: 60 },
      ],
      legs: [],
      dailyBudgetMinutes: 600,
      anchorPlaceId: 'hotel',
    };
    const res = optimize(input);
    const dayWithHotel = res.days.find((d) => d.orderedPlaceIds.includes('hotel'));
    expect(dayWithHotel).toBeDefined();
    expect(dayWithHotel!.orderedPlaceIds[0]).toBe('hotel');
  });

  it('pins dayStartEnd endId to last position', () => {
    const input: OptimizerInput = {
      places: [
        { id: 'a', lat: 40.0, lng: -3.0, visitMinutes: 60 },
        { id: 'b', lat: 40.01, lng: -3.01, visitMinutes: 60 },
        { id: 'hotel', lat: 40.02, lng: -3.02, visitMinutes: 0 },
      ],
      legs: [],
      dailyBudgetMinutes: 600,
      dayStartEnd: { 0: { endId: 'hotel' } },
    };
    const res = optimize(input);
    const day0 = res.days[0]!;
    expect(day0.orderedPlaceIds[day0.orderedPlaceIds.length - 1]).toBe('hotel');
  });

  it('splits into multiple days when budget is tight', () => {
    const places: OptimizerPlace[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      lat: 38.7 + i * 0.01,
      lng: -9.1 + i * 0.01,
      visitMinutes: 120,
    }));
    const res = optimize({ places, legs: [], dailyBudgetMinutes: 300 });
    expect(res.days.length).toBeGreaterThanOrEqual(3);
    const placed = res.days.flatMap((d) => d.orderedPlaceIds);
    expect(placed.sort()).toEqual(places.map((p) => p.id).sort());
  });

  it('prefers leg data over haversine when provided', () => {
    // Two close places but leg data says they are very far apart.
    const input: OptimizerInput = {
      places: [
        { id: 'a', lat: 38.7, lng: -9.1, visitMinutes: 60 },
        { id: 'b', lat: 38.71, lng: -9.11, visitMinutes: 60 },
        { id: 'c', lat: 40.0, lng: -8.0, visitMinutes: 60 },
      ],
      legs: [
        { fromId: 'a', toId: 'b', durationSeconds: 60 }, // 1 min
        { fromId: 'b', toId: 'a', durationSeconds: 60 },
      ],
      dailyBudgetMinutes: 600,
    };
    const res = optimize(input);
    const day = res.days.find((d) => d.orderedPlaceIds.includes('a') && d.orderedPlaceIds.includes('b'));
    expect(day).toBeDefined();
  });
});
