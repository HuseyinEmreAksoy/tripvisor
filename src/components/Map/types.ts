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
   * Phase 23 Step 23.9: when true the leg has no real polyline (e.g. transit
   * mode) and must be rendered as a dashed straight line from `from` to `to`.
   * Both `from` and `to` MUST be set when `isDashed` is true.
   */
  isDashed?: boolean;
  /** Start coordinate for dashed straight-line fallback. */
  from?: { lat: number; lng: number };
  /** End coordinate for dashed straight-line fallback. */
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
