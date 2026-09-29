// poi-recommend/geo.ts: geohash tiles + distance math. Pure, no I/O.
//
// Tiles are geohash-5 cells (ADR-0013 §3). At precision 5 a cell is exactly
// 360/2^13 = 0.0439453125° of longitude by 180/2^12 = 0.0439453125° of
// latitude: about 4.9 km north-south and 4.9 km × cos(lat) east-west (3.7 km
// in Istanbul). The grid is therefore uniform in degrees, so the tiles that
// cover a search circle are a plain row/column range over its bounding box.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const TILE_PRECISION = 5;

export interface Bbox {
  s: number;
  w: number;
  n: number;
  e: number;
}

/** Standard geohash encoding of a point. */
export function geohashEncode(lat: number, lon: number, precision = TILE_PRECISION): string {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let hash = '';
  let bits = 0;
  let ch = 0;
  let evenBit = true; // even bits encode longitude
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonLo = mid;
      } else {
        ch = ch << 1;
        lonHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch = ch << 1;
        latHi = mid;
      }
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Bounding box of a geohash cell. Throws on characters outside the alphabet. */
export function geohashBbox(hash: string): Bbox {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let evenBit = true;
  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) throw new Error(`invalid geohash character: ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bit = (idx >> b) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (bit) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bit) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { s: latLo, w: lonLo, n: latHi, e: lonHi };
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding box of a circle, clamped to valid coordinates (no antimeridian wrap). */
export function circleBbox(lat: number, lon: number, radiusM: number): Bbox {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  // Near the poles cos(lat) -> 0; cap the longitude span at the full range.
  const cosLat = Math.max(Math.cos(toRad(lat)), 1e-6);
  const dLon = Math.min(180, dLat / cosLat);
  return {
    s: Math.max(-90, lat - dLat),
    n: Math.min(90, lat + dLat),
    w: Math.max(-180, lon - dLon),
    e: Math.min(180, lon + dLon),
  };
}

/** Distance from a point to the nearest point of a bbox (0 when inside). */
export function distanceToBboxM(lat: number, lon: number, b: Bbox): number {
  const cLat = Math.min(Math.max(lat, b.s), b.n);
  const cLon = Math.min(Math.max(lon, b.w), b.e);
  return haversineM(lat, lon, cLat, cLon);
}

/**
 * Geohash tiles (at `precision`) that intersect the search circle, nearest
 * first. The antimeridian is not wrapped: a search within `radiusM` of ±180°
 * only sees its own side (accepted; nobody plans a day across the date line).
 */
export function tilesForCircle(
  lat: number,
  lon: number,
  radiusM: number,
  precision = TILE_PRECISION,
): string[] {
  const lonBits = Math.ceil((precision * 5) / 2);
  const latBits = Math.floor((precision * 5) / 2);
  const dLon = 360 / 2 ** lonBits;
  const dLat = 180 / 2 ** latBits;
  const box = circleBbox(lat, lon, radiusM);
  const i0 = Math.floor((box.s + 90) / dLat);
  const i1 = Math.min(Math.floor((box.n + 90) / dLat), 2 ** latBits - 1);
  const j0 = Math.floor((box.w + 180) / dLon);
  const j1 = Math.min(Math.floor((box.e + 180) / dLon), 2 ** lonBits - 1);
  const tiles: Array<{ hash: string; d: number }> = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const cLat = -90 + (i + 0.5) * dLat;
      const cLon = -180 + (j + 0.5) * dLon;
      const hash = geohashEncode(cLat, cLon, precision);
      const d = distanceToBboxM(lat, lon, geohashBbox(hash));
      // The bbox grid over-covers the circle's corners; drop tiles the circle misses.
      if (d <= radiusM) tiles.push({ hash, d });
    }
  }
  tiles.sort((a, b) => a.d - b.d || (a.hash < b.hash ? -1 : 1));
  return tiles.map((t) => t.hash);
}

/** Round to `digits` decimals (log/cache hygiene). */
export function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
