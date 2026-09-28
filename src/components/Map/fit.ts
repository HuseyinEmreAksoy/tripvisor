// Platform-neutral helpers for keeping a map fitted to its markers.
import type { MapMarker } from './types';

/**
 * Stable string identity of a marker set (ids + coords, order-insensitive).
 * Used to refit only when the markers actually change — not on every
 * parent re-render, which would fight the user's own panning.
 */
export function markerSignature(markers: ReadonlyArray<MapMarker>): string {
  return markers
    .map((m) => `${m.id}@${m.lat.toFixed(6)},${m.lng.toFixed(6)}`)
    .sort()
    .join('|');
}

/** Region delta used when there is a single marker to centre on. */
export const SINGLE_MARKER_DELTA = 0.05;

/** Padding (px) around markers when fitting to several of them. */
export const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
