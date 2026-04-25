/**
 * Map.web.tsx — Google Maps JavaScript API rendering for web.
 *
 * Web-only graceful-degradation:
 *   When EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is empty or undefined (e.g. during local dev
 *   without a configured key), we render <MapUnavailable> instead of crashing.
 *   This fallback shows the place list grouped by day with day-color chips.
 *
 * Map.native.tsx is untouched — native API keys live in app.json and are never
 * exposed to the web bundle.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import Constants from 'expo-constants';
import { dayColor, type MapViewProps } from './types';
import { MapUnavailable } from '../MapUnavailable';

/**
 * Returns the Maps JavaScript API key, or null when absent.
 * Checks process.env first (Metro inlines EXPO_PUBLIC_* at bundle time),
 * then falls back to Constants.expoConfig.extra for OTA-update scenarios.
 */
function getWebKey(): string | null {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY : undefined;
  if (fromEnv) return fromEnv;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const k = extra.googleMapsWebKey;
  return typeof k === 'string' && k.length > 0 ? k : null;
}

export function Map(props: MapViewProps) {
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
        <GoogleMap
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
              <Pin background={dayColor(m.dayIndex)} borderColor="#111115" glyphColor="#FFFFFF" />
            </AdvancedMarker>
          ))}
        </GoogleMap>
      </APIProvider>
    </View>
  );
}

function Polylines({ polylines }: { polylines: MapViewProps['polylines'] }) {
  const map = useMap();
  const safe = polylines ?? [];

  useEffect(() => {
    if (!map) return;
    type GMaps = {
      Polyline: new (opts: Record<string, unknown>) => { setMap: (m: unknown) => void };
    };
    const gmaps = (globalThis as unknown as { google?: { maps: GMaps } }).google?.maps;
    if (!gmaps) return;

    const instances = safe.map(
      (line) =>
        new gmaps.Polyline({
          path: line.points.map((p) => ({ lat: p.lat, lng: p.lng })),
          strokeColor: dayColor(line.dayIndex),
          strokeOpacity: 1,
          strokeWeight: 4,
          map,
        }),
    );
    return () => {
      for (const poly of instances) poly.setMap(null);
    };
  }, [map, safe]);

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
});
