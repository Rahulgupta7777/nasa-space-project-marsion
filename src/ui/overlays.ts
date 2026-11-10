/**
 * Raster overlays computed in the browser from the terrain grid and drawn to a
 * canvas. The grid is equirectangular, the same projection as the map, so the
 * image lines up with NASA's tiles without reprojection.
 */
import type { SuitProfile } from '../core/cost';
import type { TerrainGrid } from '../core/terrain';

type Rgba = readonly [number, number, number, number];

function paint(grid: TerrainGrid, colour: (index: number) => Rgba): string {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.width * grid.height; i++) {
    const [r, g, b, a] = colour(i);
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = a;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

const CLEAR: Rgba = [0, 0, 0, 0];

/** Slope classes relative to the suit's caution and hard limits. */
export function renderSlope(
  grid: TerrainGrid,
  slopeDeg: Float32Array,
  profile: SuitProfile,
): string {
  const easy = profile.cautionSlopeDeg / 2;
  return paint(grid, (i) => {
    const s = slopeDeg[i]!;
    if (!(s >= easy)) return CLEAR;
    if (s > profile.maxSlopeDeg) return [226, 48, 48, 235];
    if (s >= profile.cautionSlopeDeg) return [255, 138, 30, 215];
    return [255, 214, 74, 150];
  });
}

export function renderHillshade(grid: TerrainGrid, shade: Float32Array): string {
  return paint(grid, (i) => {
    const v = shade[i]!;
    if (Number.isNaN(v)) return CLEAR;
    const c = Math.round(v * 255);
    return [c, c, c, 255];
  });
}

/**
 * Veil over ground that cannot be reached and returned from on the usable
 * oxygen, with an amber band over the last 20% of the range.
 */
export function renderEnvelope(grid: TerrainGrid, fraction: Float32Array): string {
  return paint(grid, (i) => {
    const f = fraction[i]!;
    if (!(f <= 1)) return [12, 8, 6, 205]; // out of range or unreachable (NaN)
    if (f > 0.8) return [255, 170, 60, 95];
    return CLEAR;
  });
}
