import { describe, expect, it } from '@jest/globals';
import { markerSignature } from '../fit';
import type { MapMarker } from '../types';

const m = (id: string, lat: number, lng: number): MapMarker => ({
  id,
  lat,
  lng,
  title: id,
  dayIndex: 0,
});

describe('markerSignature', () => {
  it('is order-insensitive', () => {
    expect(markerSignature([m('a', 1, 2), m('b', 3, 4)])).toBe(
      markerSignature([m('b', 3, 4), m('a', 1, 2)]),
    );
  });

  it('changes when a marker is added, removed or moved', () => {
    const base = markerSignature([m('a', 1, 2)]);
    expect(markerSignature([m('a', 1, 2), m('b', 3, 4)])).not.toBe(base);
    expect(markerSignature([])).not.toBe(base);
    expect(markerSignature([m('a', 1.001, 2)])).not.toBe(base);
  });

  it('ignores non-geometry fields such as title', () => {
    expect(markerSignature([{ ...m('a', 1, 2), title: 'x' }])).toBe(
      markerSignature([{ ...m('a', 1, 2), title: 'y' }]),
    );
  });
});
