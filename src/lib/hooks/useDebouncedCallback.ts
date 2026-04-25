/**
 * useDebouncedCallback
 *
 * Returns a stable callback that delays invoking `fn` until `delay` ms have
 * elapsed since the last call. Any pending invocation is cancelled on unmount
 * so a stale mutation never fires against a component that has already been
 * removed from the tree (mirrors the M1 fix applied to cost_per_km in Phase 8).
 *
 * Usage:
 *   const save = useDebouncedCallback((value: string) => {
 *     mutate({ notes: value });
 *   }, 500);
 *   <TextInput onChangeText={save} />
 */
import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): (...args: Args) => void {
  // Keep a ref to the latest fn so callers never need to memoize their
  // callback (stale-closure safe — the timer always invokes the current fn).
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel the pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...args);
      }, delay);
    },
    [delay],
  );
}
