/**
 * Map layers. Every raster layer is a NASA Solar System Treks WMTS service
 * (https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars); tile format and
 * deepest zoom level were read from each service's WMTSCapabilities.xml.
 */
import type { Bounds } from '../core/geo';

export interface TileLayerDef {
  id: string;
  title: string;
  /** Spacecraft and instrument that took the data. */
  mission: string;
  resolution: string;
  /** Why an astronaut planning a Marswalk would look at this layer. */
  use: string;
  credit: string;
  kind: 'base' | 'overlay';
  trekId: string;
  ext: 'jpg' | 'png';
  maxNativeZoom: number;
  bounds?: Bounds;
  defaultOn?: boolean;
  defaultOpacity?: number;
}

export const trekTileUrl = (def: Pick<TileLayerDef, 'trekId' | 'ext'>): string =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${def.trekId}/1.0.0/default/default028mm/{z}/{y}/{x}.${def.ext}`;

export const trekCapabilitiesUrl = (trekId: string): string =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${trekId}/1.0.0/WMTSCapabilities.xml`;

export const TILE_LAYERS: TileLayerDef[] = [
  {
    id: 'viking',
    kind: 'base',
    title: 'Viking colour mosaic',
    mission: 'Viking Orbiters 1 and 2',
    resolution: '232 m/px',
    use: 'True-colour regional context.',
    credit: 'NASA/JPL/USGS',
    trekId: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
    ext: 'jpg',
    maxNativeZoom: 7,
  },
  {
    id: 'mola',
    kind: 'base',
    title: 'MOLA colour hillshade',
    mission: 'Mars Global Surveyor, MOLA laser altimeter',
    resolution: '463 m/px',
    use: 'Regional relief: crater rim, floor and Mount Sharp at a glance.',
    credit: 'NASA/JPL/GSFC',
    trekId: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
    ext: 'jpg',
    maxNativeZoom: 7,
  },
  {
    id: 'mola-hrsc',
    kind: 'base',
    title: 'MOLA + HRSC colour hillshade',
    mission: 'Mars Global Surveyor MOLA blended with Mars Express HRSC',
    resolution: '200 m/px',
    use: 'Sharper regional relief than MOLA alone.',
    credit: 'NASA/JPL/GSFC, ESA/DLR/FU Berlin, USGS',
    trekId: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw',
    ext: 'jpg',
    maxNativeZoom: 8,
  },
  {
    id: 'ctx',
    kind: 'overlay',
    title: 'CTX mosaic, Gale Crater',
    mission: 'Mars Reconnaissance Orbiter, Context Camera',
    resolution: '6 m/px',
    use: 'Landforms along the route: dunes, buttes, channels.',
    credit: 'NASA/JPL-Caltech/MSSS',
    trekId: 'curiosity_ctx_mosaic',
    ext: 'png',
    maxNativeZoom: 10,
    bounds: { west: 136.2768, south: -7.2137, east: 139.3864, north: -3.5805 },
    defaultOn: true,
    defaultOpacity: 1,
  },
  {
    id: 'hirise',
    kind: 'overlay',
    title: 'HiRISE mosaic, Curiosity site',
    mission: 'Mars Reconnaissance Orbiter, HiRISE camera',
    resolution: '25 cm/px',
    use: 'Boulders, bedrock ledges and sand ripples at walking scale.',
    credit: 'NASA/JPL-Caltech/University of Arizona',
    trekId: 'curiosity_hirise_mosaic',
    ext: 'png',
    maxNativeZoom: 16,
    bounds: { west: 137.1225, south: -4.9255, east: 137.7298, north: -4.249 },
    defaultOn: true,
    defaultOpacity: 1,
  },
  {
    id: 'themis-day',
    kind: 'overlay',
    title: 'THEMIS daytime infrared',
    mission: '2001 Mars Odyssey, THEMIS',
    resolution: '100 m/px',
    use: 'Daytime surface temperature: sun-facing slopes read bright.',
    credit: 'NASA/JPL-Caltech/Arizona State University',
    trekId: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
    ext: 'png',
    maxNativeZoom: 9,
    bounds: { west: -180, south: -65, east: 180, north: 65 },
    defaultOpacity: 0.6,
  },
  {
    id: 'themis-night',
    kind: 'overlay',
    title: 'THEMIS night-time infrared',
    mission: '2001 Mars Odyssey, THEMIS',
    resolution: '100 m/px',
    use: 'Ground that stays warm at night is rock; cold ground is loose dust or sand.',
    credit: 'NASA/JPL-Caltech/Arizona State University',
    trekId: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018',
    ext: 'png',
    maxNativeZoom: 9,
    bounds: { west: -180, south: -65, east: 180, north: 65 },
    defaultOpacity: 0.6,
  },
  {
    id: 'tes-dust',
    kind: 'overlay',
    title: 'TES dust cover',
    mission: 'Mars Global Surveyor, Thermal Emission Spectrometer',
    resolution: '~7 km/px',
    use: 'Regional dust mantle: expect dustier suits and optics where it is high.',
    credit: 'NASA/JPL-Caltech/Arizona State University',
    trekId: 'TES_Dust',
    ext: 'png',
    maxNativeZoom: 1,
    defaultOpacity: 0.5,
  },
];

/** Layers RELIC computes in the browser or draws from vector data. */
export interface DerivedLayerDef {
  id: 'hillshade' | 'slope' | 'envelope' | 'traverse' | 'sites' | 'roi';
  title: string;
  mission: string;
  use: string;
  defaultOn: boolean;
  defaultOpacity: number;
}

export const DERIVED_LAYERS: DerivedLayerDef[] = [
  {
    id: 'envelope',
    title: 'Safe-return envelope',
    mission: 'Computed from the HiRISE DEM and the suit model',
    use: 'Shaded ground is beyond a round trip on the usable oxygen.',
    defaultOn: true,
    defaultOpacity: 0.55,
  },
  {
    id: 'slope',
    title: 'Slope hazard',
    mission: 'Computed from the HiRISE DEM',
    use: 'Yellow to orange is tiring; red is steeper than the suit limit.',
    defaultOn: true,
    defaultOpacity: 0.6,
  },
  {
    id: 'hillshade',
    title: 'Terrain relief',
    mission: 'Computed from the HiRISE DEM',
    use: 'Shaded relief of the planning terrain.',
    defaultOn: false,
    defaultOpacity: 0.5,
  },
  {
    id: 'traverse',
    title: 'Curiosity traverse',
    mission: 'Mars Science Laboratory drive log',
    use: 'Ground a one-tonne rover has already crossed.',
    defaultOn: true,
    defaultOpacity: 0.9,
  },
  {
    id: 'sites',
    title: 'Science sites',
    mission: 'Named Curiosity sites, NASA Mars Trek',
    use: 'Candidate stops for the sortie.',
    defaultOn: true,
    defaultOpacity: 1,
  },
  {
    id: 'roi',
    title: 'Exploration Zone regions of interest',
    mission: 'NASA Human Landing Sites Study, 2015',
    use: 'Areas proposed for human science and resource use at Gale.',
    defaultOn: false,
    defaultOpacity: 0.8,
  },
];
