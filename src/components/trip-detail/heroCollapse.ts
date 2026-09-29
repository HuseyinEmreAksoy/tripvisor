/**
 * Trip hero collapse-on-scroll (M5 Y2.4, phones).
 *
 * The route shell owns `useHeroCollapse()` and provides its `report` through
 * `HeroScrollContext`; the Plan list (via useDayNavigation) and the Trip hub
 * report their scroll position. The hero collapses to the one-line bar once
 * the list has scrolled past a threshold AND there is enough content left to
 * keep scrolling after the header shrinks — otherwise the shrink would clamp
 * the offset back to 0, re-expand the hero and flicker. It re-expands only
 * near the top (hysteresis). Desktop renders no provider, so reports no-op.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Hero height minus the collapsed bar — the room a collapse gives back. */
export const HERO_COLLAPSE_DELTA = 148;
const COLLAPSE_AT = 48;
const EXPAND_AT = 6;

export interface HeroScrollSample {
  y: number;
  contentHeight: number;
  viewportHeight: number;
}

export type HeroScrollReporter = (sample: HeroScrollSample) => void;

export const HeroScrollContext = createContext<HeroScrollReporter | null>(null);

export function useHeroScrollReporter(): HeroScrollReporter | null {
  return useContext(HeroScrollContext);
}

/** Adapts a reporter to a ScrollView `onScroll` handler. */
export function sampleFromScrollEvent(e: NativeSyntheticEvent<NativeScrollEvent>): HeroScrollSample {
  const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
  return {
    y: contentOffset.y,
    contentHeight: contentSize.height,
    viewportHeight: layoutMeasurement.height,
  };
}

/** Pure decision (exported for tests): next collapsed state for a sample. */
export function nextCollapsed(collapsed: boolean, s: HeroScrollSample): boolean {
  if (collapsed) return s.y > EXPAND_AT;
  const room = s.contentHeight - s.viewportHeight;
  return s.y > COLLAPSE_AT && room > HERO_COLLAPSE_DELTA + COLLAPSE_AT;
}

export function useHeroCollapse(): {
  collapsed: boolean;
  report: HeroScrollReporter;
  reset: () => void;
} {
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef(false);
  const report = useCallback<HeroScrollReporter>((sample) => {
    const next = nextCollapsed(ref.current, sample);
    if (next !== ref.current) {
      ref.current = next;
      setCollapsed(next);
    }
  }, []);
  const reset = useCallback(() => {
    ref.current = false;
    setCollapsed(false);
  }, []);
  return { collapsed, report, reset };
}
