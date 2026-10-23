/**
 * Refresh the bundled NASA data snapshot in public/data/.
 *
 *   npm run data:refresh
 *
 * The app works from this snapshot when it is offline or when a NASA service
 * is slow, and upgrades to live data when it can. Every file written here is
 * listed in public/data/manifest.json with the URL it came from and the time
 * it was fetched, so the snapshot is reproducible and auditable.
 *
 * Behind a corporate proxy run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBipFloat32, gridStats } from '../src/core/terrain';
import { parseRemsFeed, toRow } from '../src/core/weather';
import {
  DEFAULT_OPS_BOUNDS,
  ENDPOINTS,
  exportImageUrl,
  featureQueryUrl,
  gridSizeFor,
} from '../src/data/endpoints';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const fetchedAt = new Date().toISOString();

interface ManifestEntry {
  file: string;
  title: string;
  mission: string;
  provider: string;
  url: string;
  fetchedAt: string;
  records: number;
  note?: string;
}
const manifest: ManifestEntry[] = [];

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}
const save = (file: string, data: string | Uint8Array): Promise<void> =>
  writeFile(path.join(OUT, file), data);
const round = (v: number, digits = 6): number => Number(v.toFixed(digits));

interface ArcFeature<G> {
  attributes: Record<string, string | number | null>;
  geometry: G;
}

async function terrain(): Promise<void> {
  const bounds = DEFAULT_OPS_BOUNDS;
  const { width, height } = gridSizeFor(bounds, 20);
  const url = exportImageUrl(ENDPOINTS.galeDem, bounds, width, height);
  const elevation = decodeBipFloat32(await (await get(url)).arrayBuffer(), width, height);
  const stats = gridStats(elevation);
  if (stats.validFraction < 0.99)
    throw new Error(`Terrain snapshot has gaps: ${stats.validFraction}`);
  await save('gale-dem.bin', new Uint8Array(elevation.buffer));
  await save(
    'gale-dem.json',
    JSON.stringify(
      { width, height, bounds, minM: round(stats.min, 1), maxM: round(stats.max, 1) },
      null,
      2,
    ),
  );
  manifest.push({
    file: 'gale-dem.bin',
    title: 'Gale Crater elevation, HiRISE stereo DEM resampled to ~20 m',
    mission: 'Mars Reconnaissance Orbiter (HiRISE)',
    provider: 'NASA Solar System Treks (JPL)',
    url,
    fetchedAt,
    records: width * height,
    note: `float32 little-endian, ${width} x ${height}, row 0 = north; metres above the areoid`,
  });
}

async function namedSites(): Promise<void> {
  const url = featureQueryUrl(ENDPOINTS.curiositySites, null);
  const json = (await (await get(url)).json()) as {
    features: ArcFeature<{ x: number; y: number }>[];
  };
  const sites = json.features.map((f) => ({
    id: `msl-${f.attributes.FID}`,
    name: String(f.attributes.name),
    lon: round(f.geometry.x),
    lat: round(f.geometry.y),
    info: `https://trek.nasa.gov/mars/${String(f.attributes.template)}`,
  }));
  await save('curiosity-sites.json', JSON.stringify(sites, null, 1));
  manifest.push({
    file: 'curiosity-sites.json',
    title: 'Named Curiosity science sites',
    mission: 'Mars Science Laboratory (Curiosity)',
    provider: 'NASA Solar System Treks (JPL)',
    url,
    fetchedAt,
    records: sites.length,
  });
}

async function traverse(): Promise<void> {
  const json = (await (await get(ENDPOINTS.mslTraverse)).json()) as {
    features: { geometry: { type: string; coordinates: number[][][] | number[][] } }[];
  };
  const points: number[][] = [];
  for (const f of json.features) {
    const lines = (
      f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]
    ) as number[][][];
    for (const line of lines) for (const p of line) points.push(p);
  }
  // The full drive log has tens of thousands of vertices; keep every Nth for display.
  const step = Math.max(1, Math.ceil(points.length / 3000));
  const line = points
    .filter((_, i) => i % step === 0 || i === points.length - 1)
    .map((p) => [round(p[0]!), round(p[1]!)]);

  const waypoints = (await (await get(ENDPOINTS.mslWaypoints)).json()) as {
    features: { properties: Record<string, number | string> }[];
  };
  const last = waypoints.features.reduce((a, b) =>
    Number(b.properties.sol) >= Number(a.properties.sol) ? b : a,
  );
  const latest = {
    sol: Number(last.properties.sol),
    lon: round(Number(last.properties.lon)),
    lat: round(Number(last.properties.lat)),
    elevationM: round(Number(last.properties.elev_geoid), 1),
  };
  await save('curiosity-traverse.json', JSON.stringify({ line, latest }));
  manifest.push({
    file: 'curiosity-traverse.json',
    title: 'Curiosity traverse (decimated) and latest localised position',
    mission: 'Mars Science Laboratory (Curiosity)',
    provider: 'NASA Mars Exploration Program (JPL MMGIS)',
    url: ENDPOINTS.mslTraverse,
    fetchedAt,
    records: line.length,
    note: `Latest waypoint: sol ${latest.sol}. Waypoints from ${ENDPOINTS.mslWaypoints}`,
  });
}

async function weather(): Promise<void> {
  const sols = parseRemsFeed(await (await get(ENDPOINTS.remsWeather)).json());
  await save('rems.json', JSON.stringify(sols.map(toRow)));
  manifest.push({
    file: 'rems.json',
    title: 'Curiosity REMS daily weather reports',
    mission: 'Mars Science Laboratory (Curiosity REMS)',
    provider: 'NASA Mars Exploration Program; data from Centro de Astrobiologia (CSIC-INTA)',
    url: ENDPOINTS.remsWeather,
    fetchedAt,
    records: sols.length,
    note: `Sols ${sols[0]?.sol} to ${sols.at(-1)?.sol}`,
  });
}

async function explorationZones(): Promise<void> {
  const url = featureQueryUrl(ENDPOINTS.explorationZoneRois, DEFAULT_OPS_BOUNDS);
  const json = (await (await get(url)).json()) as {
    features: ArcFeature<{ rings: number[][][] }>[];
  };
  const count = (attrs: ArcFeature<unknown>['attributes'], prefix: string): number =>
    Object.entries(attrs).reduce(
      (sum, [k, v]) => (k.startsWith(prefix) && Number(v) > 0 ? sum + 1 : sum),
      0,
    );
  const rois = json.features
    .filter((f) => String(f.attributes.roi) === '1')
    .map((f) => ({
      id: String(f.attributes.name),
      proposal: String(f.attributes.ez_abstrac),
      abstract: `https://www.hou.usra.edu/meetings/explorationzone2015/pdf/${String(f.attributes.ez_abstrac)}.pdf`,
      scienceCriteria: count(f.attributes, 'sci'),
      resourceCriteria: count(f.attributes, 'isru'),
      ring: f.geometry.rings[0]!.map((p) => [round(p[0]!, 5), round(p[1]!, 5)]),
    }));
  await save('exploration-zone-rois.json', JSON.stringify(rois));
  manifest.push({
    file: 'exploration-zone-rois.json',
    title: 'Human Exploration Zone regions of interest proposed for Gale Crater (2015 workshop)',
    mission: 'NASA Human Landing Sites Study',
    provider: 'NASA Solar System Treks (JPL)',
    url,
    fetchedAt,
    records: rois.length,
  });
}

await mkdir(OUT, { recursive: true });
for (const [name, task] of Object.entries({
  terrain,
  namedSites,
  traverse,
  weather,
  explorationZones,
})) {
  process.stdout.write(`${name} ... `);
  await task();
  console.info('ok');
}
await save('manifest.json', JSON.stringify({ generatedAt: fetchedAt, entries: manifest }, null, 2));
console.info(`Wrote ${manifest.length} datasets to ${OUT}`);
