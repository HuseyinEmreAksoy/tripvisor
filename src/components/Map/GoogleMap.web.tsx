/**
 * GoogleMap.web.tsx — Google Maps JavaScript API rendering for web.
 *
 * v2 Phase N5.1: this was `Map.web.tsx` until the MapLibre switch. It is now
 * the LEGACY web provider, selected by the `Map.web.tsx` dispatcher when
 * `app_config.map_provider_web === 'google'` (or EXPO_PUBLIC_MAP_PROVIDER).
 * Content otherwise unchanged.
 *
 * Web-only graceful-degradation:
 *   When EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is empty or undefined (e.g. during local dev
 *   without a configured key), we render <MapUnavailable> instead of crashing.
 *   This fallback shows the place list grouped by day with day-color chips.
 *
 * Map.native.tsx is untouched — native SDK keys come from app.config.ts (build env) and are never
 * exposed to the web bundle.
 *
 * Phase 23 Step 23.9: transit legs (polyline === null from backend) are passed
 * in with `isDashed: true` + `from`/`to` coordinates. The Polylines component
 * draws a dashed straight line for those legs using the Google Maps `icons`
 * stroke-dash pattern on a semi-transparent Polyline.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  APIProvider,
  Map as GMapView,
  AdvancedMarker,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import Constants from 'expo-constants';
import { ON_DAY_COLOR, dayColor, polylineColor, type MapViewProps, type MapPolyline } from './types';
import { MapUnavailable } from '../MapUnavailable';

/**
 * Returns the Maps JavaScript API key, or null when absent.
 * The literal `process.env.EXPO_PUBLIC_X` member read is the ONLY form Expo
 * inlines at build time — production web has no runtime process.env, so the
 * optional-chained dynamic read exists purely for the dev server and the
 * jest suite (Map.web.test.tsx mutates process.env per test). Then falls
 * back to Constants.expoConfig.extra for OTA-update scenarios.
 */
function getWebKey(): string | null {
  const fromEnv =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY ??
    (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY : undefined);
  if (fromEnv) return fromEnv;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const k = extra.googleMapsWebKey;
  return typeof k === 'string' && k.length > 0 ? k : null;
}

export function GoogleMap(props: MapViewProps) {
  const key = getWebKey();
  // Coerce to safe arrays — defends against transient undefined during data
  // hydration / hot reload. The TS type already says these are required, but
  // a single `undefined.length` here crashes the whole React tree on web.
  const markers = props.markers ?? [];
  const polylines = props.polylines ?? [];

  // Always call hooks before conditional returns (Rules of Hooks).
  const defaultCenter = useMemo(() => {
    if (props.initialRegion) {
      return { lat: props.initialRegion.lat, lng: props.initialRegion.lng };
    }
    if (markers.length > 0) {
      const lats = markers.map((m) => m.lat);
      const lngs = markers.map((m) => m.lng);
      return {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      };
    }
    return { lat: 0, lng: 0 };
  }, [props.initialRegion, markers]);

  // ── Graceful degradation: no key → list view ──────────────────────────────
  if (!key) {
    return <MapUnavailable markers={markers} polylines={polylines} initialRegion={props.initialRegion} onMarkerPress={props.onMarkerPress} />;
  }

  return (
    <View style={styles.container}>
      <APIProvider apiKey={key}>
        <GMapView
          defaultCenter={defaultCenter}
          defaultZoom={markers.length > 0 ? 12 : 2}
          mapId="tripvisor"
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
        >
          <Polylines polylines={polylines} />
          {markers.map((m) => (
            <AdvancedMarker
              key={m.id}
              position={{ lat: m.lat, lng: m.lng }}
              onClick={() => props.onMarkerPress?.(m.id)}
              title={m.title}
            >
              <Pin background={dayColor(m.dayIndex)} borderColor={ON_DAY_COLOR} glyphColor={ON_DAY_COLOR} />
            </AdvancedMarker>
          ))}
        </GMapView>
      </APIProvider>
    </View>
  );
}

// ── GMaps type helpers ────────────────────────────────────────────────────────
// Typed minimally — just what we use from the global google.maps namespace
// so we don't depend on @types/google.maps (not in devDeps).
type LatLngLiteral = { lat: number; lng: number };
type PolylineOptions = {
  path?: LatLngLiteral[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  icons?: unknown[];
  geodesic?: boolean;
  map?: unknown;
};
type GMapsPolyline = {
  setMap: (m: unknown) => void;
};
type GMaps = {
  Polyline: new (opts: PolylineOptions) => GMapsPolyline;
};

function Polylines({ polylines }: { polylines: MapPolyline[] }) {
  const map = useMap();
  const safe = polylines ?? [];

  useEffect(() => {
    if (!map) return;
    const gmaps = (globalThis as unknown as { google?: { maps: GMaps } }).google?.maps;
    if (!gmaps) return;

    const instances = safe.map((line) => {
      const color = polylineColor(line);

      // v2 P1.2: uniform geometry resolution — decoded `points` win (≥2),
      // else straight from→to (legacy transit fallback / virtual legs).
      const isStraight = line.points.length < 2;
      const path: LatLngLiteral[] | null = !isStraight
        ? line.points.map((p) => ({ lat: p.lat, lng: p.lng }))
        : line.from && line.to
          ? [
              { lat: line.from.lat, lng: line.from.lng },
              { lat: line.to.lat, lng: line.to.lng },
            ]
          : null;
      if (!path) return null;

      // Dashed (Step 23.9 straight fallback OR P1.2 WALK connector steps):
      // the `icons` array with a dash symbol provides the stroke pattern.
      // M5 Y3.3: dotted (walking legs) = circles; dashed = short strokes.
      if (line.isDashed || line.dotted) {
        const dashSymbol = {
          path: line.dotted
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ((globalThis as any).google?.maps?.SymbolPath?.CIRCLE ?? 'M 0,-1 0,1')
            : 'M 0,-1 0,1',
          scale: line.dotted ? 2 : 3,
          strokeColor: color,
          strokeOpacity: 1,
          fillColor: color,
          fillOpacity: 1,
        };
        return new gmaps.Polyline({
          path,
          strokeColor: color,
          strokeOpacity: 0,
          strokeWeight: 3,
          geodesic: isStraight,
          icons: [
            {
              icon: dashSymbol,
              offset: '0',
              repeat: '12px',
            },
          ],
          map,
        });
      }

      // Normal solid polyline.
      return new gmaps.Polyline({
        path,
        strokeColor: color,
        strokeOpacity: 1,
        strokeWeight: 4,
        map,
      });
    });

    return () => {
      for (const poly of instances) poly?.setMap(null);
    };
  }, [map, safe]);

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
});
