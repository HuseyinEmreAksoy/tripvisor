/**
 * Dark basemap for the native Google provider (X3.1).
 *
 * Google's documented "Night" styling, tinted toward the app's warm ink
 * palette so the map sits inside dark-mode chrome instead of glaring white.
 * Structurally matches react-native-maps' `MapStyleElement[]` (declared
 * locally so this module stays importable from shared code and tests).
 * Day-colored markers and legs are untouched — they're drawn over the style.
 *
 * iOS on the default (Apple Maps) provider ignores this and follows
 * `userInterfaceStyle` instead.
 */
export interface MapStyleRule {
  featureType?: string;
  elementType?: string;
  stylers: object[];
}

export const DARK_GOOGLE_MAP_STYLE: MapStyleRule[] = [
  { elementType: 'geometry', stylers: [{ color: '#1E1B15' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#14120E' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A89E8E' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#D8CFC0' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#A89E8E' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1F2A22' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6E9A7C' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38332A' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2A261E' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9A9082' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4A4337' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2A261E' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#D8CFC0' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2A261E' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#A89E8E' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0E2A2A' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5E8C88' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#14120E' }] },
];
