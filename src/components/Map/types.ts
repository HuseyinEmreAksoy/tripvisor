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
   * M5 Y3.3: dotted stroke (walking legs). Wins over `isDashed`. Per-mode
   * styles: walk dotted, transit dashed, flight dashed arc (MapTab builds
   * the arc into `points`), ferry dashed in the info blue.
   */
  dotted?: boolean;
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

// M5 Y2.4: the day palette moved to the theme (src/theme/dayColors.ts), the
// one source shared by map pins/legs, the itinerary rail, chips, Today and
// memories. Re-exported here (direct leaf-module import, no ThemeProvider)
// so map providers stay theme-free.
import { dayColor } from '@/theme/dayColors';

export { DAY_COLORS, DAY_NEUTRAL, ON_DAY_COLOR, dayColor, dayTint } from '@/theme/dayColors';

/**
 * v2 P1.2: single source of truth for a polyline's stroke color across all
 * three providers — explicit `strokeColor` wins, else the day palette.
 */
export function polylineColor(line: MapPolyline): string {
  return line.strokeColor ?? dayColor(line.dayIndex);
}
