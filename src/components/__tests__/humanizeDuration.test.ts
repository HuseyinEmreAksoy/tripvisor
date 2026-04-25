/**
 * Unit tests for humanizeDuration() exported from TripCostRollup.tsx.
 *
 * humanizeDuration converts seconds to a "Xh Ym" string for display.
 * It is exported so DaySummaryCard can share the same formatting logic.
 *
 * Coverage:
 *   - 0 / negative seconds → "—"
 *   - Minutes only (< 1 hour)
 *   - Hours only (even hours)
 *   - Hours + minutes
 *   - Rounding: fractional minutes round to nearest
 */

import { humanizeDuration } from '../TripCostRollup';

describe('humanizeDuration', () => {
  it('returns "—" for 0 seconds', () => {
    expect(humanizeDuration(0)).toBe('—');
  });

  it('returns "—" for negative seconds', () => {
    expect(humanizeDuration(-60)).toBe('—');
  });

  it('formats minutes only (< 1 hour)', () => {
    expect(humanizeDuration(30 * 60)).toBe('30m');
    expect(humanizeDuration(1 * 60)).toBe('1m');
    expect(humanizeDuration(59 * 60)).toBe('59m');
  });

  it('formats hours only (exactly N hours, no minutes)', () => {
    expect(humanizeDuration(1 * 3600)).toBe('1h');
    expect(humanizeDuration(2 * 3600)).toBe('2h');
    expect(humanizeDuration(8 * 3600)).toBe('8h');
  });

  it('formats hours and minutes together', () => {
    expect(humanizeDuration(1 * 3600 + 30 * 60)).toBe('1h 30m');
    expect(humanizeDuration(2 * 3600 + 15 * 60)).toBe('2h 15m');
    expect(humanizeDuration(10 * 3600 + 5 * 60)).toBe('10h 5m');
  });

  it('rounds fractional minutes to nearest integer', () => {
    // 3661 seconds = 1h + 61 seconds → 61 seconds / 60 = 1.017 → Math.round → 1m
    expect(humanizeDuration(3661)).toBe('1h 1m');
  });

  it('handles large values without error', () => {
    // 25 hours
    expect(humanizeDuration(25 * 3600)).toBe('25h');
  });
});
