/**
 * Every NASA endpoint the app talks to, in one place.
 *
 * All of these were verified to answer with permissive CORS headers
 * (see docs/DATA_SOURCES.md), so the app needs no backend or proxy.
 */
import type { Bounds } from '../core/geo';
import { boundsSizeM } from '../core/geo';

const TREK_ARCGIS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';

export const ENDPOINTS = {
  /** MRO HiRISE stereo DEM of Gale Crater, 1 m native, float32 metres. */
  galeDem: `${TREK_ARCGIS}/Gale_DEM_SMG_1m/ImageServer`,
  /** MGS MOLA global DEM, ~463 m, int16 metres. Used outside the HiRISE footprint. */
  molaDem: `${TREK_ARCGIS}/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer`,
  curiositySites: `${TREK_ARCGIS}/curiosity_waypoints/MapServer/0`,
  explorationZoneRois: `${TREK_ARCGIS}/EZMars/MapServer/3`,
  mslTraverse: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
  mslWaypoints: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json',
  remsWeather: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
} as const;

/** Footprint of the HiRISE DEM service. Outside it only MOLA terrain is available. */
export const GALE_DEM_BOUNDS: Bounds = {
  west: 137.1225,
  south: -4.9254,
  east: 137.7298,
  north: -4.249,
};

/**
 * Default operations area: Curiosity's ground from Bradbury Landing to
 * Vera Rubin Ridge, about 9.5 km x 11.3 km. The bundled terrain covers it.
 */
export const DEFAULT_OPS_BOUNDS: Bounds = {
  west: 137.32,
  south: -4.75,
  east: 137.48,
  north: -4.56,
};

/** Trek's Mars spatial reference (IAU2000 equirectangular lat/lon degrees). */
const MARS_SR = 104905;

/** Grid dimensions that give roughly square cells of `cellM` metres over `bounds`. */
export function gridSizeFor(
  bounds: Bounds,
  cellM: number,
  maxCells = 420_000,
): { width: number; height: number } {
  const { widthM, heightM } = boundsSizeM(bounds);
  let cell = cellM;
  const area = widthM * heightM;
  if (area / (cell * cell) > maxCells) cell = Math.sqrt(area / maxCells);
  return {
    width: Math.max(8, Math.round(widthM / cell)),
    height: Math.max(8, Math.round(heightM / cell)),
  };
}

/** ArcGIS ImageServer request for raw float32 elevation over a box. */
export function exportImageUrl(
  service: string,
  bounds: Bounds,
  width: number,
  height: number,
): string {
  const params = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: String(MARS_SR),
    imageSR: String(MARS_SR),
    size: `${width},${height}`,
    format: 'bip',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  return `${service}/exportImage?${params.toString()}`;
}

/** ArcGIS feature query returning every attribute, optionally limited to a box. */
export function featureQueryUrl(layer: string, bounds: Bounds | null): string {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: String(MARS_SR),
    f: 'json',
  });
  if (bounds) {
    params.set('geometry', `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', String(MARS_SR));
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${layer}/query?${params.toString()}`;
}
