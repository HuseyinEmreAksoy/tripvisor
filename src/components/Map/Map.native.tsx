import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { dayColor, polylineColor, type MapViewProps } from './types';

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

export function Map(props: MapViewProps) {
  const region = useMemo(() => toRegion(props), [props]);

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
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
