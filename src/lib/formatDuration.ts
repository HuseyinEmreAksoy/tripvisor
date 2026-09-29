/**
 * formatDuration — converts minutes to a human-readable duration string in
 * the active app language. Delegates to `src/i18n/format.ts` (ADR-0011), so
 * existing callers don't change.
 *
 * Examples (en):
 *   formatDuration(0)   => "0m"
 *   formatDuration(45)  => "45m"
 *   formatDuration(60)  => "1h"
 *   formatDuration(90)  => "1h 30m"
 * Examples (tr): "45 dk", "1 sa", "1 sa 30 dk".
 *
 * Input is minutes; rounds to the nearest minute before formatting.
 */
import { formatDuration as formatDurationI18n } from '@/i18n/format';

export function formatDuration(minutes: number): string {
  return formatDurationI18n(minutes);
}

/**
 * formatDurationSeconds — same as formatDuration but accepts seconds.
 * Converts seconds → minutes (rounds down) then delegates.
 */
export function formatDurationSeconds(seconds: number): string {
  return formatDuration(Math.floor(seconds / 60));
}
