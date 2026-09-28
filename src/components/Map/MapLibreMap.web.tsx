/**
 * MapLibreMap.web.tsx — MapLibre GL + OpenFreeMap rendering for web (v2 N5.1).
 *
 * Default web map provider: open vector tiles, no API key, no quota. The
 * `Map.web.tsx` dispatcher selects this unless `app_config.map_provider_web`
 * (or EXPO_PUBLIC_MAP_PROVIDER) pins 'google'.
 *
 * Style URL: EXPO_PUBLIC_MAPLIBRE_STYLE_URL → default OpenFreeMap "liberty"
 * (light theme) / "dark" (dark theme, X3.1 — keyless, same tiles + the same
 * © OpenStreetMap attribution). An env override pins one style for both.
 *
 * ATTRIBUTION (do not remove): MapLibre's built-in AttributionControl is left
 * at its default — VISIBLE. OpenStreetMap data is ODbL-licensed and the
 * OpenFreeMap style carries the required "© OpenStreetMap" attribution; hiding
 * it would violate the license (mirror of the Powered-by-Google rule). Never
 * pass `attributionControl={false}` here.
 *
 * Import note: we import the implementation package `@vis.gl/react-maplibre`
 * instead of the `react-map-gl/maplibre` alias. The alias subpath exists only
 * via package.json `exports`, which Metro in Expo SDK 52 does not resolve for
 * client bundles (`unstable_enablePackageExports` is off by default). The
 * alias is literally `export * from '@vis.gl/react-maplibre'` — identical API,
 * and the implementation package ships classic main/module/types fields that
 * resolve under Metro, tsc (node resolution), and Jest alike.
 *
 * Parity with GoogleMap.web.tsx / Map.native.tsx:
 *   - markers: day-colored pins with press handlers (+ order-in-day badge,
 *     matching the MapUnavailable list's badge language)
 *   - polylines: solid day-colored lines (4px); dashed straight from→to line
 *     for transit legs (`isDashed`) via line-dasharray (3px, ≈ native [6,6])
 *   - region: `initialRegion` wins; otherwise fitBounds over every marker +
 *     polyline coordinate with ~48px padding
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Map as MapLibreView,
  Marker,
  Source,
  Layer,
  type LayerProps,
  type MapRef,
} from '@vis.gl/react-maplibre';
import { useThemeNameOptional } from '@/theme';
import {
  dayColor,
  polylineColor,
  type MapMarker,
  type MapPolyline,
  type MapRegion,
  type MapViewProps,
} from './types';

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** Style URL override for self-hosted/alternate tile styles; defaults to
 * OpenFreeMap (liberty / dark by theme). Static read inlines at build; dynamic
 * read is the dev/jest fallback (production web has no runtime process.env). */
function getStyleUrl(dark: boolean): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL ??
    (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_MAPLIBRE_STYLE_URL : undefined);
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return dark ? DEFAULT_DARK_STYLE_URL : DEFAULT_STYLE_URL;
}

/** [[west, south], [east, north]] — maplibre LngLatBoundsLike. */
type Bounds = [[number, number], [number, number]];

/**
 * Resolves the line geometry for a leg, mirroring the provider semantics
 * (v2 P1.2 — uniform across all three providers):
 *   - decoded `points` win when there are ≥2 (real route geometry,
 *     including dashed WALK connector steps of a multi-leg transit route)
 *   - otherwise straight from→to segment (legacy transit fallback and the
 *     "from my location" virtual leg built in MapTab)
 */
function lineCoordinates(line: MapPolyline): Array<[number, number]> {
  if (line.points.length >= 2) {
    return line.points.map((p) => [p.lng, p.lat] as [number, number]);
  }
  if (line.from && line.to) {
    return [
      [line.from.lng, line.from.lat],
      [line.to.lng, line.to.lat],
    ];
  }
  return [];
}

/**
 * Camera bounds: explicit `initialRegion` wins (center+delta → box); otherwise
 * the envelope of every marker and polyline coordinate. Null when no data.
 */
function computeBounds(
  initialRegion: MapRegion | undefined,
  markers: MapMarker[],
  polylines: MapPolyline[],
): Bounds | null {
  if (initialRegion) {
    const { lat, lng, latDelta, lngDelta } = initialRegion;
    return [
      [lng - lngDelta / 2, lat - latDelta / 2],
      [lng + lngDelta / 2, lat + latDelta / 2],
    ];
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const extend = (x: number, y: number) => {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  };
  for (const m of markers) extend(m.lng, m.lat);
  for (const line of polylines) {
    for (const [x, y] of lineCoordinates(line)) extend(x, y);
  }
  if (west === Infinity) return null;
  return [
    [west, south],
    [east, north],
  ];
}

// Module-level layer specs — stable identities, no per-render churn.
// Solid legs: 4px to match Google strokeWeight 4 / native strokeWidth 4.
const SOLID_LAYER: LayerProps = {
  id: 'trip-legs-solid',
  type: 'line',
  filter: ['==', ['get', 'dashed'], false],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
};

// Dashed transit fallback: 3px wide; dasharray units are multiples of
// line-width, so [2, 2] ≈ 6px dash / 6px gap — same rhythm as the native
// lineDashPattern [6, 6].
const DASHED_LAYER: LayerProps = {
  id: 'trip-legs-dashed',
  type: 'line',
  filter: ['==', ['get', 'dashed'], true],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 2] },
};

const FIT_OPTIONS = { padding: 48, maxZoom: 15 } as const;

export function MapLibreMap(props: MapViewProps) {
  // Coerce to safe arrays — same hydration/hot-reload defense as GoogleMap.web.
  const markers = props.markers ?? [];
  const polylines = props.polylines ?? [];

  const mapRef = useRef<MapRef>(null);
  const isDark = useThemeNameOptional() === 'dark';

  const bounds = useMemo(
    () => computeBounds(props.initialRegion, markers, polylines),
    [props.initialRegion, markers, polylines],
  );

  // Bounds known at first render are applied declaratively via initialViewState.
  const initialBounds = useRef(bounds).current;
  const didFitRef = useRef(initialBounds !== null);

  // Late-data fit: GoogleMap.web locks its uncontrolled defaultCenter at mount,
  // stranding the camera at (0,0) if markers stream in after mount. Here we
  // fit ONCE when coordinates first become available, then leave the camera
  // to the user (day-filter changes intentionally do not re-fit — parity).
  useEffect(() => {
    if (didFitRef.current || !bounds) return;
    const map = mapRef.current;
    if (!map) return;
    didFitRef.current = true;
    map.fitBounds(bounds, { ...FIT_OPTIONS, duration: 0 });
  }, [bounds]);

  // One GeoJSON FeatureCollection for all legs; per-feature color + dashed flag
  // drive the two data-styled line layers above. Day-filter changes diff into
  // a single source setData (cheaper than Google's per-line teardown/rebuild).
  const legsCollection = useMemo(() => {
    const features = polylines
      .map((line) => {
        const coordinates = lineCoordinates(line);
        if (coordinates.length < 2) return null;
        return {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates },
          properties: { color: polylineColor(line), dashed: line.isDashed === true },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    return { type: 'FeatureCollection' as const, features };
  }, [polylines]);

  return (
    <View style={styles.container} accessibilityLabel="Trip map">
      <MapLibreView
        ref={mapRef}
        mapStyle={getStyleUrl(isDark)}
        initialViewState={
          initialBounds
            ? { bounds: initialBounds, fitBoundsOptions: FIT_OPTIONS }
            : // Empty trip: world view, parity with GoogleMap's defaultZoom 2
              // (maplibre 512px tiles ≈ one zoom level below Google's 256px).
              { longitude: 0, latitude: 0, zoom: 1 }
        }
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="trip-legs" type="geojson" data={legsCollection}>
          <Layer {...SOLID_LAYER} />
          <Layer {...DASHED_LAYER} />
        </Source>

        {markers.map((m) => {
          const fill = dayColor(m.dayIndex);
          return (
            <Marker key={m.id} longitude={m.lng} latitude={m.lat} anchor="bottom">
              {/* Same visual language as the Google AdvancedMarker Pin:
                  day-color fill, #111115 border, white glyph — plus the
                  order-in-day badge ('•' when unscheduled / no order). */}
              <Pressable
                onPress={() => props.onMarkerPress?.(m.id)}
                accessibilityRole="button"
                accessibilityLabel={m.title}
                style={styles.pinWrap}
              >
                <View style={[styles.pinHead, { backgroundColor: fill }]}>
                  <Text
                    style={styles.pinBadge}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {m.orderInDay != null ? String(m.orderInDay + 1) : '•'}
                  </Text>
                </View>
                <View style={[styles.pinTail, { borderTopColor: fill }]} />
              </Pressable>
            </Marker>
          );
        })}
      </MapLibreView>
    </View>
  );
}

const PIN_SIZE = 26;

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 320 },
  pinWrap: { alignItems: 'center' },
  pinHead: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    borderWidth: 2,
    borderColor: '#111115', // matches the Google Pin borderColor
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBadge: {
    color: '#FFFFFF', // matches the Google Pin glyphColor
    fontSize: 12,
    fontWeight: '700',
  },
  // CSS-triangle tail pointing at the anchored coordinate (anchor="bottom").
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    // borderTopColor set per-marker to the day color
  },
});
