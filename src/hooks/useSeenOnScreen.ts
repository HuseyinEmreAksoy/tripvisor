/**
 * useSeenOnScreen — true once the host view has been inside (or within
 * `margin` px of) the window. One-way: a row that has been seen stays seen.
 * Used to fetch metered data (place photos) only for rows the user actually
 * scrolls to (M5 Y2.4).
 *
 * Cross-platform without IntersectionObserver: the host measures itself
 * with `measureInWindow` on layout and on every viewport tick. Scrolling
 * lists call `notifyViewportChange()` from their `onScroll` (the itinerary
 * does, via useDayNavigation); window resizes tick automatically. Unseen
 * hosts re-measure at most every TICK_MS.
 *
 *   const { ref, onLayout, seen } = useSeenOnScreen<View>();
 *   <View ref={ref} onLayout={onLayout} />
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent, type View } from 'react-native';

type Listener = () => void;
const listeners = new Set<Listener>();
const TICK_MS = 120;
let last = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

function flush() {
  pending = null;
  last = Date.now();
  listeners.forEach((l) => l());
}

/** Tell unseen hosts to re-measure (throttled; safe to call per scroll event). */
export function notifyViewportChange(): void {
  if (listeners.size === 0 || pending) return;
  const wait = Math.max(0, TICK_MS - (Date.now() - last));
  pending = setTimeout(flush, wait);
}

Dimensions.addEventListener?.('change', notifyViewportChange);

export function useSeenOnScreen<T extends View = View>(
  { margin = 240, enabled = true }: { margin?: number; enabled?: boolean } = {},
): { ref: React.RefObject<T | null>; onLayout: (e: LayoutChangeEvent) => void; seen: boolean } {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  const seenRef = useRef(false);

  const check = useCallback(() => {
    const node = ref.current;
    if (!node || seenRef.current || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((_x, y, _w, h) => {
      if (seenRef.current) return;
      const windowHeight = Dimensions.get('window').height;
      // A zero-size measure means "not laid out yet" (web before paint).
      if (h === 0 && y === 0) return;
      if (y < windowHeight + margin && y + h > -margin) {
        seenRef.current = true;
        setSeen(true);
      }
    });
  }, [margin]);

  useEffect(() => {
    if (!enabled || seen) return;
    listeners.add(check);
    return () => {
      listeners.delete(check);
    };
  }, [enabled, seen, check]);

  const onLayout = useCallback(() => {
    if (enabled) check();
  }, [enabled, check]);

  return { ref, onLayout, seen };
}
