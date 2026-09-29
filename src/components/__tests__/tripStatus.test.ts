/**
 * tripPhase (M5 Y2.4) — the hero / card status: "Day 3 of 7", "In 12 days",
 * "Relive". Local calendar days, same rule as src/lib/tripToday.ts.
 */
import { describe, expect, it } from '@jest/globals';
import { tripPhase } from '../tripStatus';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('tripPhase', () => {
  it('is live with a 1-based day and the span length', () => {
    expect(tripPhase('2026-09-27', '2026-10-03', at(2026, 9, 29))).toEqual({ kind: 'live', day: 3, total: 7 });
    expect(tripPhase('2026-09-29', '2026-09-29', at(2026, 9, 29, 23))).toEqual({ kind: 'live', day: 1, total: 1 });
  });

  it('counts calendar days before the start (tomorrow = 1)', () => {
    expect(tripPhase('2026-09-30', '2026-10-02', at(2026, 9, 29, 23))).toEqual({ kind: 'upcoming', daysUntil: 1 });
    expect(tripPhase('2026-10-11', null, at(2026, 9, 29))).toEqual({ kind: 'upcoming', daysUntil: 12 });
  });

  it('is past the day after the end', () => {
    expect(tripPhase('2026-09-20', '2026-09-28', at(2026, 9, 29, 0))).toEqual({ kind: 'past' });
  });

  it('treats a missing / earlier end as a one-day trip, and no start as undated', () => {
    expect(tripPhase('2026-09-29', null, at(2026, 9, 29))).toEqual({ kind: 'live', day: 1, total: 1 });
    expect(tripPhase('2026-09-29', '2026-09-01', at(2026, 9, 30))).toEqual({ kind: 'past' });
    expect(tripPhase(null, '2026-09-29', at(2026, 9, 29))).toEqual({ kind: 'undated' });
    expect(tripPhase('garbage', null)).toEqual({ kind: 'undated' });
  });
});
