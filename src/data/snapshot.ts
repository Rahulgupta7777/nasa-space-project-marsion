/**
 * Loaders for the bundled snapshot in public/data and for the live NASA
 * services that supersede it. The snapshot keeps the app usable offline;
 * `npm run data:refresh` regenerates it.
 */
import type { Bounds, LatLon } from '../core/geo';
import { contains, intersect } from '../core/geo';
import type { TerrainGrid } from '../core/terrain';
import { decodeBipFloat32, gridStats, makeGrid } from '../core/terrain';
import type { RemsRow, RemsSol } from '../core/weather';
import { fromRow, parseRemsFeed } from '../core/weather';
import { ENDPOINTS, GALE_DEM_BOUNDS, exportImageUrl, gridSizeFor } from './endpoints';

const dataUrl = (file: string): string => `${import.meta.env.BASE_URL}data/${file}`;

async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface ScienceSite extends LatLon {
  id: string;
  name: string;
  /** NASA page describing the site. */
  info?: string;
}
export interface Traverse {
  line: [number, number][];
  latest: { sol: number; lon: number; lat: number; elevationM: number };
}
export interface ExplorationRoi {
  id: string;
  proposal: string;
  abstract: string;
  scienceCriteria: number;
  resourceCriteria: number;
  ring: [number, number][];
}
export interface ManifestEntry {
  file: string;
  title: string;
  mission: string;
  provider: string;
  url: string;
  fetchedAt: string;
  records: number;
  note?: string;
}
export interface Manifest {
  generatedAt: string;
  entries: ManifestEntry[];
}

export async function loadSnapshotTerrain(): Promise<TerrainGrid> {
  const meta = await getJson<{ width: number; height: number; bounds: Bounds }>(
    dataUrl('gale-dem.json'),
  );
  const res = await fetch(dataUrl('gale-dem.bin'));
  if (!res.ok) throw new Error(`Terrain snapshot: ${res.status}`);
  const elevation = new Float32Array(await res.arrayBuffer());
  return makeGrid(
    meta.width,
    meta.height,
    meta.bounds,
    elevation,
    'MRO HiRISE DEM, resampled to ~20 m (bundled snapshot)',
  );
}

export const loadSites = (): Promise<ScienceSite[]> =>
  getJson<Array<{ id: string; name: string; lon: number; lat: number; info?: string }>>(
    dataUrl('curiosity-sites.json'),
  );
export const loadTraverse = (): Promise<Traverse> =>
  getJson<Traverse>(dataUrl('curiosity-traverse.json'));
export const loadRois = (): Promise<ExplorationRoi[]> =>
  getJson<ExplorationRoi[]>(dataUrl('exploration-zone-rois.json'));
export const loadManifest = (): Promise<Manifest> => getJson<Manifest>(dataUrl('manifest.json'));
export const loadSnapshotWeather = async (): Promise<RemsSol[]> =>
  (await getJson<RemsRow[]>(dataUrl('rems.json'))).map(fromRow);

/** Curiosity REMS reports straight from NASA (about 1.7 MB). */
export const fetchLiveWeather = async (): Promise<RemsSol[]> =>
  parseRemsFeed(await getJson<unknown>(ENDPOINTS.remsWeather, 45_000));

/**
 * Elevation for an arbitrary box, live from NASA Trek. Inside the HiRISE
 * footprint the 1 m Gale DEM is used; anywhere else on Mars the request falls
 * back to the global MOLA DEM, which is too coarse for walking-scale slopes
 * and is labelled as such.
 */
export async function fetchLiveTerrain(requested: Bounds, targetCellM = 10): Promise<TerrainGrid> {
  const centre = {
    lat: (requested.north + requested.south) / 2,
    lon: (requested.east + requested.west) / 2,
  };
  const insideHirise = contains(GALE_DEM_BOUNDS, centre);
  const bounds = insideHirise ? (intersect(requested, GALE_DEM_BOUNDS) ?? requested) : requested;
  const { width, height } = gridSizeFor(bounds, insideHirise ? targetCellM : 463);
  const url = exportImageUrl(
    insideHirise ? ENDPOINTS.galeDem : ENDPOINTS.molaDem,
    bounds,
    width,
    height,
  );
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`NASA Trek elevation service answered ${res.status}`);
  const elevation = decodeBipFloat32(await res.arrayBuffer(), width, height);
  if (gridStats(elevation).validFraction < 0.5)
    throw new Error('NASA Trek has no elevation data for most of this area');
  const grid = makeGrid(width, height, bounds, elevation, '');
  grid.source = insideHirise
    ? `MRO HiRISE DEM, resampled to ~${Math.round(grid.cellSizeX)} m (live from NASA Trek)`
    : `MGS MOLA DEM, ~${Math.round(grid.cellSizeX)} m (live from NASA Trek; too coarse for walking-scale slopes)`;
  return grid;
}
