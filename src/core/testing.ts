/** Test fixtures shared by the core unit tests. Not imported by the app. */
import { METERS_PER_DEG_LAT } from './geo';
import type { TerrainGrid } from './terrain';
import { makeGrid } from './terrain';

/** A grid at the equator with square cells of `cell` metres and elevation from a function. */
export function syntheticGrid(
  size: number,
  cell: number,
  height: (x: number, y: number) => number,
): TerrainGrid {
  const span = (size * cell) / METERS_PER_DEG_LAT;
  const elevation = new Float32Array(size * size);
  // x grows east, y grows north; row 0 is the northern edge.
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      elevation[r * size + c] = height(c * cell, (size - 1 - r) * cell);
  return makeGrid(
    size,
    size,
    { west: 0, south: -span / 2, east: span, north: span / 2 },
    elevation,
    'synthetic',
  );
}
