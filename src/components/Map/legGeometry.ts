/**
 * legGeometry — client-drawn geometry for legs without a route polyline
 * (M5 Y3.3). optimize-trip leaves `polyline` null for flight, ferry,
 * estimated and user-timed legs; the map then draws:
 *   - flight → a dashed ARC (a gentle quadratic curve, so it reads as "air"
 *     and doesn't hide a road line between the same stops);
 *   - everything else → a dashed straight line.
 * Pure (no map SDK), shared by every provider through `MapPolyline.points`.
 */
import { decodePolyline, type LatLng } from './polyline';
import type { MapPolyline } from './types';

/**
 * Points along a quadratic Bézier from `from` to `to`, bowed sideways by
 * `bend` × the segment length (to the left of travel). `segments + 1`
 * points; identical endpoints return the two points unchanged.
 */
export function arcPoints(from: LatLng, to: LatLng, segments = 32, bend = 0.2): LatLng[] {
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  if ((dLat === 0 && dLng === 0) || segments < 2) return [from, to];
  // Perpendicular offset of the midpoint (lng/lat treated as a plane: fine
  // for the short-to-regional hops a trip day holds).
  const ctrl = {
    lat: (from.lat + to.lat) / 2 + dLng * bend,
    lng: (from.lng + to.lng) / 2 - dLat * bend,
  };
  const out: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const a = (1 - s) * (1 - s);
    const b = 2 * (1 - s) * s;
    const c = s * s;
    out.push({
      lat: a * from.lat + b * ctrl.lat + c * to.lat,
      lng: a * from.lng + b * ctrl.lng + c * to.lng,
    });
  }
  return out;
}

/** Stroke of a leg on the map, by its (effective) mode. */
export type LegStroke = 'solid' | 'dotted' | 'dashed' | 'arc';

export function legStroke(mode: string, hasPolyline: boolean): LegStroke {
  if (mode === 'flight') return 'arc';
  if (mode === 'walking') return 'dotted';
  if (mode === 'transit' || mode === 'ferry') return 'dashed';
  return hasPolyline ? 'solid' : 'dashed';
}

/** The subset of a `trip_legs` row the map needs. */
export interface MapLegInput {
  id: string;
  day_index: number;
  from_place_id: string;
  to_place_id: string;
  transport_mode: string;
  polyline: string | null;
}

/**
 * One MapPolyline for a leg that has no multi-step transit geometry:
 * decoded polyline when present, else a straight line (flight: an arc).
 * Walking is dotted, transit/ferry dashed, ferry in `ferryColor`. Returns
 * null when an endpoint is unknown (a stale leg to a deleted place).
 */
export function legPolyline(
  leg: MapLegInput,
  endpoints: { from: LatLng | undefined; to: LatLng | undefined },
  ferryColor: string,
): MapPolyline | null {
  const stroke = legStroke(leg.transport_mode, Boolean(leg.polyline));
  const base = {
    id: leg.id,
    dayIndex: leg.day_index,
    ...(stroke === 'dotted' ? { dotted: true } : {}),
    ...(stroke === 'dashed' || stroke === 'arc' ? { isDashed: true } : {}),
    ...(leg.transport_mode === 'ferry' ? { strokeColor: ferryColor } : {}),
  };
  if (leg.polyline && stroke !== 'arc') {
    const points = decodePolyline(leg.polyline);
    if (points.length >= 2) return { ...base, points };
  }
  const { from, to } = endpoints;
  if (!from || !to) return null;
  if (stroke === 'arc') return { ...base, points: arcPoints(from, to) };
  return { ...base, points: [], from, to };
}
