/**
 * useNow — a Date that refreshes every `intervalMs` (default: each minute,
 * aligned to the minute boundary) so "time left" copy and the next-stop
 * selection move with the clock, and the Today tab rolls over at midnight.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    // First tick on the next minute boundary, then every interval.
    const align = intervalMs - (Date.now() % intervalMs);
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), intervalMs);
    }, align);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [intervalMs]);
  return now;
}
