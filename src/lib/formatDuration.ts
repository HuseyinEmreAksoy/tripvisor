/**
 * formatDuration — converts minutes to a human-readable duration string.
 *
 * Examples:
 *   formatDuration(0)   => "0m"
 *   formatDuration(45)  => "45m"
 *   formatDuration(60)  => "1h"
 *   formatDuration(90)  => "1h 30m"
 *   formatDuration(120) => "2h"
 *
 * Intended for itinerary visit-time and travel-time labels. Input is minutes;
 * the function rounds to the nearest minute before formatting.
 */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(Math.max(0, minutes));
  if (rounded === 0) return '0m';
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * formatDurationSeconds — same as formatDuration but accepts seconds.
 * Converts seconds → minutes (rounds down) then delegates.
 */
export function formatDurationSeconds(seconds: number): string {
  return formatDuration(Math.floor(seconds / 60));
}
