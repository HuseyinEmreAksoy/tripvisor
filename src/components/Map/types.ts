export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  dayIndex: number | null;
  orderInDay?: number | null;
}

export interface MapPolyline {
  id: string;
  /** Decoded line points, already in lat/lng. */
  points: Array<{ lat: number; lng: number }>;
  dayIndex: number;
  /**
   * Phase 23 Step 23.9 / v2 P1.2: dashed stroke. Geometry comes from
   * `points` when it has ≥2 entries (e.g. decoded WALK connectors of a
   * multi-leg transit route); otherwise both `from` and `to` MUST be set
   * and the line renders as a straight from→to segment (the legacy
   * "transit leg without step geometry" fallback).
   */
  isDashed?: boolean;
  /**
   * v2 P1.2: explicit stroke color override (e.g. muted gray for WALK
   * connectors inside a transit route). When absent, providers fall back
   * to `dayColor(dayIndex)` — see {@link polylineColor}.
   */
  strokeColor?: string;
  /** Start coordinate for straight-line fallback (no decoded points). */
  from?: { lat: number; lng: number };
  /** End coordinate for straight-line fallback (no decoded points). */
  to?: { lat: number; lng: number };
}

export interface MapRegion {
  lat: number;
  lng: number;
  latDelta: number;
  lngDelta: number;
}

export interface MapViewProps {
  markers: MapMarker[];
  polylines: MapPolyline[];
  initialRegion?: MapRegion;
  onMarkerPress?: (markerId: string) => void;
}

/** Day palette — up to 7 days gets distinct colors; later days wrap. */
export const DAY_COLORS = [
  '#2E6BE6',
  '#E0A010',
  '#1D9B5E',
  '#D93B3B',
  '#8A5CF0',
  '#0FB5BA',
  '#E3478B',
];

export function dayColor(dayIndex: number | null | undefined): string {
  if (dayIndex == null || dayIndex < 0) return '#8B8B93';
  return DAY_COLORS[dayIndex % DAY_COLORS.length]!;
}

/**
 * v2 P1.2: single source of truth for a polyline's stroke color across all
 * three providers — explicit `strokeColor` wins, else the day palette.
 */
export function polylineColor(line: MapPolyline): string {
  return line.strokeColor ?? dayColor(line.dayIndex);
}
