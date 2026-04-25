/**
 * useDebouncedCallback
 *
 * Returns a stable debounced function that delays invoking `fn` until `delay`
 * ms have elapsed since the last call.
 *
 * The returned function also exposes two imperative methods:
 *   - `.flush()` — if a timer is pending, invoke `fn` immediately with the
 *     pending args and clear the timer. No-op if no timer is pending.
 *   - `.cancel()` — discard the pending timer without invoking `fn`.
 *
 * Lifecycle:
 *   - Unmount cleanup calls `cancel()`, NOT `flush()`. This is intentional:
 *     silently dropping un-flushed args on unmount is safer than firing a
 *     mutation against an unmounted component. See Phase 9 review, L4.
 *
 * WARNING: Do NOT call `.flush()` from a `useEffect` cleanup function. Effect
 * cleanup runs on both unmount AND every dependency change, which would fire
 * the pending mutation on every re-render cycle, not just on blur.
 *
 * Usage:
 *   const save = useDebouncedCallback((value: string) => {
 *     mutate({ notes: value });
 *   }, 500);
 *   <TextInput onChangeText={save} onBlur={() => save.flush()} />
 */
import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedCallback<TArgs extends unknown[]> {
  (...args: TArgs): void;
  flush(): void;
  cancel(): void;
}

export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number,
): DebouncedCallback<TArgs> {
  // Keep a ref to the latest fn so callers never need to memoize their
  // callback (stale-closure safe — the timer always invokes the current fn).
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // lastArgsRef stores the args that are waiting for the pending timer so
  // flush() can invoke fn synchronously with the correct arguments.
  const lastArgsRef = useRef<TArgs | null>(null);

  // cancel() is defined as a plain ref-backed function so it can be called
  // from the unmount cleanup without becoming a dep of useCallback.
  const cancelRef = useRef<() => void>(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastArgsRef.current = null;
  });

  // Cancel the pending timer on unmount (does NOT flush — intentional, see JSDoc).
  useEffect(() => {
    return () => {
      cancelRef.current();
    };
  }, []);

  return useCallback(
    (() => {
      // The main debounced invocation.
      function debounced(...args: TArgs) {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        lastArgsRef.current = args;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          lastArgsRef.current = null;
          fnRef.current(...args);
        }, delay);
      }

      // Synchronously invoke fn with the pending args, then clear the timer.
      // No-op if no timer is currently scheduled.
      debounced.flush = function flush() {
        if (timerRef.current === null || lastArgsRef.current === null) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const args = lastArgsRef.current;
        lastArgsRef.current = null;
        fnRef.current(...args);
      };

      // Discard the pending timer without invoking fn.
      debounced.cancel = function cancel() {
        cancelRef.current();
      };

      return debounced;
    })(),
    // Identity is stable per delay change; flush/cancel close over refs so
    // they don't need delay in their own dep arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [delay],
  ) as DebouncedCallback<TArgs>;
}
