/**
 * Fractional-index ranking (S2.6 — manual_rank, the C1 user-order key).
 * Pure string math; the ordering invariant is everything: a drag must always
 * find a key strictly between its neighbors under plain string comparison.
 */
import { RankError, rankBetween } from '../rank';

describe('rankBetween — the documented anchors', () => {
  it('first key in an empty list', () => {
    expect(rankBetween(null, null)).toBe('V');
  });

  it("append after 'z' suffixes instead of overflowing", () => {
    expect(rankBetween('z', null)).toBe('zV');
  });

  it("insert between adjacent keys 'a0' and 'a1'", () => {
    const mid = rankBetween('a0', 'a1');
    expect(mid > 'a0' && mid < 'a1').toBe(true);
  });
});

describe('rankBetween — the ordering invariant under stress', () => {
  it('100 sequential appends stay strictly increasing', () => {
    let prev: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 100; i++) {
      const next: string = rankBetween(prev, null);
      if (prev !== null) expect(next > prev).toBe(true);
      keys.push(next);
      prev = next;
    }
    expect([...keys].sort()).toEqual(keys);
  });

  it('100 sequential prepends stay strictly decreasing', () => {
    let next: string | null = null;
    for (let i = 0; i < 100; i++) {
      const prev: string = rankBetween(null, next);
      if (next !== null) expect(prev < next).toBe(true);
      next = prev;
    }
  });

  it('repeated midpoint insertion between a fixed pair never escapes the range', () => {
    let a = rankBetween(null, null);
    const b = rankBetween(a, null);
    for (let i = 0; i < 50; i++) {
      const mid = rankBetween(a, b);
      expect(mid > a && mid < b).toBe(true);
      a = mid; // keep squeezing the same gap — the worst case for exhaustion
    }
  });
});

describe('rankBetween — input validation', () => {
  it('rejects a >= b', () => {
    expect(() => rankBetween('b', 'a')).toThrow(RankError);
    expect(() => rankBetween('a', 'a')).toThrow(RankError);
  });

  it('rejects malformed keys', () => {
    expect(() => rankBetween('', null)).toThrow(RankError);
    expect(() => rankBetween('a!', null)).toThrow(RankError);
  });
});
