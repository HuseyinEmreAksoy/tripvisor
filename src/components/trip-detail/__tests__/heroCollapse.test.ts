/**
 * Phone trip hero collapse rule (M5 Y2.4): collapse past the threshold only
 * when the list can keep scrolling after the header shrinks (else the offset
 * clamps back to 0 and the hero would flicker); re-expand near the top.
 */
import { describe, expect, it } from '@jest/globals';
import { HERO_COLLAPSE_DELTA, nextCollapsed } from '../heroCollapse';

const long = { contentHeight: 3000, viewportHeight: 600 };
const short = { contentHeight: 600 + HERO_COLLAPSE_DELTA, viewportHeight: 600 };

describe('nextCollapsed', () => {
  it('collapses once a long list scrolls past the threshold', () => {
    expect(nextCollapsed(false, { y: 10, ...long })).toBe(false);
    expect(nextCollapsed(false, { y: 80, ...long })).toBe(true);
  });

  it('never collapses a list that would stop scrolling once the hero shrinks', () => {
    expect(nextCollapsed(false, { y: 80, ...short })).toBe(false);
  });

  it('stays collapsed until back near the top (hysteresis)', () => {
    expect(nextCollapsed(true, { y: 30, ...long })).toBe(true);
    expect(nextCollapsed(true, { y: 2, ...long })).toBe(false);
  });
});
