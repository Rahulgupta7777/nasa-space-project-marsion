/** UI-level types and defaults shared by the React components. */
import type { LatLon } from './core/geo';
import { distanceM } from './core/geo';
import { MAX_STOPS } from './core/planner';
import { DERIVED_LAYERS, TILE_LAYERS } from './data/layers';
import type { ScienceSite } from './data/snapshot';

export type StopMode = 'skip' | 'optional' | 'required';

export interface StopConfig {
  id: string;
  name: string;
  position: LatLon;
  /** Science priority, 1 (low) to 5 (high). */
  value: number;
  dwellMinutes: number;
  mode: StopMode;
  info?: string;
  custom?: boolean;
}

export interface LayerState {
  on: boolean;
  opacity: number;
}

/**
 * Default habitat: the flattest pad near the centre of Curiosity's ground
 * (no slope above 3.3 degrees within 70 m, measured on the HiRISE DEM).
 * A demonstration placement, not a NASA-selected site; move it on the map.
 */
export const DEFAULT_HABITAT: LatLon = { lat: -4.64319, lon: 137.38816 };

export const DEFAULT_BASE = 'mola-hrsc';

export function defaultLayers(): Record<string, LayerState> {
  const out: Record<string, LayerState> = {};
  for (const def of TILE_LAYERS) {
    if (def.kind === 'overlay')
      out[def.id] = { on: Boolean(def.defaultOn), opacity: def.defaultOpacity ?? 1 };
  }
  for (const def of DERIVED_LAYERS)
    out[def.id] = { on: def.defaultOn, opacity: def.defaultOpacity };
  return out;
}

/** Candidate stops from NASA's named Curiosity sites; the nearest ones start as optional. */
export function stopsFromSites(sites: ScienceSite[], habitat: LatLon): StopConfig[] {
  const byDistance = [...sites].sort((a, b) => distanceM(habitat, a) - distanceM(habitat, b));
  const near = new Set(byDistance.slice(0, MAX_STOPS - 2).map((s) => s.id));
  return sites.map((s) => ({
    id: s.id,
    name: s.name,
    position: { lat: s.lat, lon: s.lon },
    value: 3,
    dwellMinutes: 30,
    mode: near.has(s.id) ? 'optional' : 'skip',
    info: s.info,
  }));
}
