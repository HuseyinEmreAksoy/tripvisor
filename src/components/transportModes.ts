/**
 * Trip-level transport modes — icon + `trip` namespace label key, shared by
 * the trip card, the trip hero and the new-trip form (M5 Y2.4).
 */
import type { IconName } from './Icon';

export const TRIP_TRANSPORT_MODES = ['driving', 'walking', 'bicycling', 'transit'] as const;
export type TripTransportMode = (typeof TRIP_TRANSPORT_MODES)[number];

export const TRANSPORT_ICON: Record<TripTransportMode, IconName> = {
  driving: 'car',
  walking: 'footprints',
  bicycling: 'bike',
  transit: 'train-front',
};

const TRANSPORT_KEYS = {
  driving: 'transport.driving',
  walking: 'transport.walking',
  bicycling: 'transport.bicycling',
  transit: 'transport.transit',
} as const;

function isMode(mode: string): mode is TripTransportMode {
  return (TRIP_TRANSPORT_MODES as readonly string[]).includes(mode);
}

/** `trip` namespace key of a mode's short name ("Drive", "Yürüyüş"). */
export function transportKey(mode: string): (typeof TRANSPORT_KEYS)[TripTransportMode] {
  return TRANSPORT_KEYS[isMode(mode) ? mode : 'driving'];
}

export function transportIcon(mode: string): IconName {
  return TRANSPORT_ICON[isMode(mode) ? mode : 'driving'];
}
