/**
 * useDayNavigation — day-jump strip + collapse + scroll-to-day wiring for
 * ItineraryTab (v2 M4 X2.3).
 *
 * The itinerary is a ScrollView of per-day sections (each hosting its own
 * DraggableItinerary), so "scroll to index" is done on measured offsets:
 * every section reports its y via `onSectionLayout`, a chip tap scrolls
 * there. While the trip is live the list opens on today's section once per
 * mount, and `onScroll` keeps the strip's active chip in sync.
 *
 * M5 Y2.4: `onScroll` also feeds the phone trip hero's collapse (via
 * HeroScrollContext, a no-op without a provider) and ticks the row
 * thumbnails' lazy on-screen check (useSeenOnScreen).
 */
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';
import type { Trip } from '@/api';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { notifyViewportChange } from '@/hooks/useSeenOnScreen';
import { sampleFromScrollEvent, useHeroScrollReporter } from '../heroCollapse';
import { haptics } from '@/lib/haptics';
import { buildDayChips, liveDayIndex, sectionAtOffset, type DayChip } from './dayChips';
import { useCollapsedDays, type CollapsedDays } from './useCollapsedDays';

/**
 * The scroll-tracked active day lives in a tiny external store instead of
 * React state: onScroll updates it on every day-boundary crossing, and as
 * state it re-rendered the WHOLE itinerary (every row + per-day draggable
 * list) mid-scroll. Only the day strip subscribes (useActiveDay).
 */
export interface ActiveDayStore {
  get: () => number | null;
  set: (dayIndex: number | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createActiveDayStore(initial: number | null = null): ActiveDayStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe a (small) component to the active day. */
export function useActiveDay(store: ActiveDayStore): number | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export interface DayNavigation {
  todayIndex: number | null;
  dayChips: DayChip[];
  chipByDay: ReadonlyMap<number, DayChip>;
  collapsedDays: CollapsedDays;
  /** Read via useActiveDay() in the component that renders the strip. */
  activeDayStore: ActiveDayStore;
  scrollRef: React.RefObject<ScrollView | null>;
  onJump: (dayIndex: number) => void;
  onSectionLayout: (dayIndex: number) => (e: LayoutChangeEvent) => void;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

export function useDayNavigation(
  tripId: string,
  trip: Pick<Trip, 'id' | 'start_date' | 'end_date' | 'archived_at'>,
  sectionDayIndexes: readonly number[],
  /** Breathing room left above a section when scrolled to. */
  topGap: number,
): DayNavigation {
  const reducedMotion = useReducedMotion();
  const { start_date, end_date, archived_at } = trip;
  // Recomputed on date edits / remount; a trip crossing midnight while the
  // screen stays open picks up the new day on the next remount (acceptable).
  const todayIndex = useMemo(
    () => liveDayIndex({ id: tripId, start_date, end_date, archived_at }),
    [tripId, start_date, end_date, archived_at],
  );
  const dayKey = sectionDayIndexes.join(',');
  const dayChips = useMemo(
    () => buildDayChips({ id: tripId, start_date, end_date, archived_at }, sectionDayIndexes),
    // dayKey stands in for the array identity (same contents → same chips).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tripId, start_date, end_date, archived_at, dayKey],
  );
  const chipByDay = useMemo(() => new Map(dayChips.map((c) => [c.dayIndex, c])), [dayChips]);
  const collapsedDays = useCollapsedDays(tripId, todayIndex);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef(new Map<number, number>());
  const didAutoScroll = useRef(false);
  const [activeDayStore] = useState(() => createActiveDayStore());
  const setActiveDay = activeDayStore.set;

  const { expand } = collapsedDays;
  const onJump = useCallback(
    (dayIndex: number) => {
      haptics.tap();
      expand(dayIndex);
      setActiveDay(dayIndex);
      const y = sectionY.current.get(dayIndex);
      if (y === undefined) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - topGap), animated: !reducedMotion });
    },
    [expand, reducedMotion, topGap, setActiveDay],
  );

  const onSectionLayout = useCallback(
    (dayIndex: number) => (e: LayoutChangeEvent) => {
      const y = e.nativeEvent.layout.y;
      sectionY.current.set(dayIndex, y);
      // Live trip: open on today's section once per mount (past days above
      // are collapsed by default, so this is usually a short hop).
      if (!didAutoScroll.current && todayIndex !== null && dayIndex === todayIndex) {
        didAutoScroll.current = true;
        setActiveDay(dayIndex);
        if (y > 0) scrollRef.current?.scrollTo({ y: Math.max(0, y - topGap), animated: false });
      }
    },
    [todayIndex, topGap, setActiveDay],
  );

  const reportHero = useHeroScrollReporter();
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsets = [...sectionY.current.entries()].map(([dayIndex, y]) => ({ dayIndex, y }));
      const current = sectionAtOffset(offsets, e.nativeEvent.contentOffset.y);
      if (current !== null) setActiveDay(current); // no-op when unchanged
      reportHero?.(sampleFromScrollEvent(e));
      notifyViewportChange();
    },
    [reportHero, setActiveDay],
  );

  return {
    todayIndex,
    dayChips,
    chipByDay,
    collapsedDays,
    activeDayStore,
    scrollRef,
    onJump,
    onSectionLayout,
    onScroll,
  };
}
