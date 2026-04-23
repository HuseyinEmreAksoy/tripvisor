import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import Constants from 'expo-constants';
import { dayColor, type MapViewProps } from './types';

function getWebKey(): string | null {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY : undefined;
  if (fromEnv) return fromEnv;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const k = extra.googleMapsWebKey;
  return typeof k === 'string' ? k : null;
}

export function Map(props: MapViewProps) {
  const key = getWebKey();

  if (!key) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          Map unavailable — set EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY.
        </Text>
      </View>
    );
  }

  const defaultCenter = useMemo(() => {
    if (props.initialRegion) {
      return { lat: props.initialRegion.lat, lng: props.initialRegion.lng };
    }
    if (props.markers.length > 0) {
      const lats = props.markers.map((m) => m.lat);
      const lngs = props.markers.map((m) => m.lng);
      return {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      };
    }
    return { lat: 0, lng: 0 };
  }, [props.initialRegion, props.markers]);

  return (
    <View style={styles.container}>
      <APIProvider apiKey={key}>
        <GoogleMap
          defaultCenter={defaultCenter}
          defaultZoom={props.markers.length > 0 ? 12 : 2}
          mapId="tripvisor"
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: '100%', height: '100%' }}
        >
          <Polylines polylines={props.polylines} />
          {props.markers.map((m) => (
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

  useEffect(() => {
    if (!map) return;
    type GMaps = {
      Polyline: new (opts: Record<string, unknown>) => { setMap: (m: unknown) => void };
    };
    const gmaps = (globalThis as unknown as { google?: { maps: GMaps } }).google?.maps;
    if (!gmaps) return;

    const instances = polylines.map(
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
  }, [map, polylines]);

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  fallbackText: { color: '#5A5A62' },
});
