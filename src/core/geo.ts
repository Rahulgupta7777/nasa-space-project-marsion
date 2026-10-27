/**
 * Mars geodesy helpers.
 *
 * Coordinates follow the convention used by NASA Solar System Treks for Mars
 * (IAU2000:104905): planetocentric latitude, east-positive longitude, on a
 * sphere of radius 3 396 190 m.
 */

/** Sphere radius used by Mars Trek's equirectangular products, metres. */
export const MARS_RADIUS_M = 3_396_190;
/** Mean surface gravity, m/s^2. */
export const MARS_GRAVITY = 3.71;
/** Length of one degree of latitude on the Mars sphere, metres. */
export const METERS_PER_DEG_LAT = (Math.PI * MARS_RADIUS_M) / 180;

export interface LatLon {
  /** Planetocentric latitude, degrees north. */
  lat: number;
  /** Longitude, degrees east. */
  lon: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Length of one degree of longitude at a given latitude, metres. */
export function metersPerDegLon(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos(toRad(latDeg));
}

/** Great-circle distance on the Mars sphere, metres (haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function contains(bounds: Bounds, p: LatLon): boolean {
  return (
    p.lon >= bounds.west && p.lon <= bounds.east && p.lat >= bounds.south && p.lat <= bounds.north
  );
}

/** Width and height of a bounding box in metres, measured at its mid-latitude. */
export function boundsSizeM(bounds: Bounds): { widthM: number; heightM: number } {
  const midLat = (bounds.north + bounds.south) / 2;
  return {
    widthM: (bounds.east - bounds.west) * metersPerDegLon(midLat),
    heightM: (bounds.north - bounds.south) * METERS_PER_DEG_LAT,
  };
}

/** A square-ish box of the given half-size (metres) centred on a point. */
export function boundsAround(center: LatLon, halfSizeM: number): Bounds {
  const dLat = halfSizeM / METERS_PER_DEG_LAT;
  const dLon = halfSizeM / metersPerDegLon(center.lat);
  return {
    west: center.lon - dLon,
    east: center.lon + dLon,
    south: center.lat - dLat,
    north: center.lat + dLat,
  };
}

/** Intersection of two boxes, or null when they do not overlap. */
export function intersect(a: Bounds, b: Bounds): Bounds | null {
  const out: Bounds = {
    west: Math.max(a.west, b.west),
    east: Math.min(a.east, b.east),
    south: Math.max(a.south, b.south),
    north: Math.min(a.north, b.north),
  };
  return out.west < out.east && out.south < out.north ? out : null;
}
