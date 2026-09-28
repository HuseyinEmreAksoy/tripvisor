import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { MapUnavailable } from '../MapUnavailable';
import { nativeMapsMode } from './nativeMapsConfig';
import { dayColor, polylineColor, type MapViewProps } from './types';
import { FIT_EDGE_PADDING, SINGLE_MARKER_DELTA, markerSignature } from './fit';

function toRegion(props: MapViewProps): Region {
  if (props.initialRegion) {
    return {
      latitude: props.initialRegion.lat,
      longitude: props.initialRegion.lng,
      latitudeDelta: props.initialRegion.latDelta,
      longitudeDelta: props.initialRegion.lngDelta,
    };
  }
  if (props.markers.length === 0) {
    return { latitude: 0, longitude: 0, latitudeDelta: 60, longitudeDelta: 60 };
  }
  const lats = props.markers.map((m) => m.lat);
  const lngs = props.markers.map((m) => m.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(maxLat - minLat, 0.05) * 1.5,
    longitudeDelta: Math.max(maxLng - minLng, 0.05) * 1.5,
  };
}

// Resolved once: the key flag is baked into the binary's expoConfig.
const MODE = nativeMapsMode(Platform.OS);

export function Map(props: MapViewProps) {
  // Android build without GOOGLE_MAPS_ANDROID_KEY: the Google provider would
  // render blank or crash, so show the place list instead (X1.2).
  if (MODE === 'unavailable') {
    return <MapUnavailable {...props} keyName="GOOGLE_MAPS_ANDROID_KEY" />;
  }
  return <NativeMap {...props} />;
}

function NativeMap(props: MapViewProps) {
  const region = useMemo(() => toRegion(props), [props]);
  const mapRef = useRef<MapView | null>(null);

  // initialRegion only applies on mount; refit whenever the marker set
  // (ids + coords) changes afterwards — e.g. places added, day filter
  // switched, optimizer moved things. The mount-time set is skipped because
  // initialRegion already frames it.
  const signature = markerSignature(props.markers);
  const fittedSignature = useRef(signature);
  const markersRef = useRef(props.markers);
  markersRef.current = props.markers;
  useEffect(() => {
    if (fittedSignature.current === signature) return;
    fittedSignature.current = signature;
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || markers.length === 0) return;
    if (markers.length === 1) {
      const only = markers[0]!;
      map.animateToRegion({
        latitude: only.lat,
        longitude: only.lng,
        latitudeDelta: SINGLE_MARKER_DELTA,
        longitudeDelta: SINGLE_MARKER_DELTA,
      });
      return;
    }
    map.fitToCoordinates(
      markers.map((m) => ({ latitude: m.lat, longitude: m.lng })),
      { edgePadding: FIT_EDGE_PADDING, animated: true },
    );
  }, [signature]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        // iOS without GOOGLE_MAPS_IOS_KEY: default provider (Apple Maps).
        provider={MODE === 'google' ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFillObject}
        initialRegion={region}
        accessibilityLabel="Trip map"
      >
        {props.polylines.map((line) => {
          // v2 P1.2: geometry resolution is uniform across providers —
          // decoded `points` win (≥2); otherwise straight from→to (the
          // legacy transit fallback AND the "from my location" virtual leg,
          // which previously rendered invisibly here as an empty solid
          // path); lines with neither are skipped.
          const isStraight = line.points.length < 2;
          const coordinates = !isStraight
            ? line.points.map((p) => ({ latitude: p.lat, longitude: p.lng }))
            : line.from && line.to
              ? [
                  { latitude: line.from.lat, longitude: line.from.lng },
                  { latitude: line.to.lat, longitude: line.to.lng },
                ]
              : null;
          if (!coordinates) return null;

          // Dashed: transit straight-line fallback (Step 23.9) or WALK
          // connector steps of a multi-leg transit route (P1.2).
          return (
            <Polyline
              key={line.id}
              coordinates={coordinates}
              strokeColor={polylineColor(line)}
              strokeWidth={line.isDashed ? 3 : 4}
              lineDashPattern={line.isDashed ? [6, 6] : undefined}
              geodesic={isStraight}
            />
          );
        })}
        {props.markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            title={m.title}
            pinColor={dayColor(m.dayIndex)}
            onPress={() => props.onMarkerPress?.(m.id)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
