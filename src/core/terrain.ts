/**
 * Terrain grids: a regular lat/lon raster of elevation in metres.
 *
 * Row 0 is the northern edge and column 0 the western edge, which matches the
 * layout NASA Trek's image service returns. Missing data is NaN.
 */
import type { Bounds, LatLon } from './geo';
import { METERS_PER_DEG_LAT, metersPerDegLon } from './geo';

export interface TerrainGrid {
  width: number;
  height: number;
  bounds: Bounds;
  /** Elevation in metres relative to the Mars areoid, row-major, NaN where there is no data. */
  elevation: Float32Array;
  /** Cell size in metres, east-west and north-south. */
  cellSizeX: number;
  cellSizeY: number;
  /** Human-readable origin of the data, shown in the UI. */
  source: string;
}

export function makeGrid(
  width: number,
  height: number,
  bounds: Bounds,
  elevation: Float32Array,
  source: string,
): TerrainGrid {
  if (elevation.length !== width * height) {
    throw new Error(`Terrain size mismatch: ${elevation.length} values for ${width}x${height}`);
  }
  const midLat = (bounds.north + bounds.south) / 2;
  return {
    width,
    height,
    bounds,
    elevation,
    cellSizeX: ((bounds.east - bounds.west) / width) * metersPerDegLon(midLat),
    cellSizeY: ((bounds.north - bounds.south) / height) * METERS_PER_DEG_LAT,
    source,
  };
}

/**
 * Decode the `format=bip&pixelType=F32` response of an ArcGIS ImageServer
 * `exportImage` call: little-endian float32 values in row-major order,
 * optionally followed by a validity mask of one bit per pixel (MSB first).
 * NoData pixels also carry a huge negative sentinel value.
 */
export function decodeBipFloat32(buffer: ArrayBuffer, width: number, height: number): Float32Array {
  const count = width * height;
  const dataBytes = count * 4;
  if (buffer.byteLength < dataBytes) {
    throw new Error(
      `Elevation response too short: ${buffer.byteLength} bytes for ${width}x${height}`,
    );
  }
  const view = new DataView(buffer);
  const out = new Float32Array(count);
  const mask =
    buffer.byteLength >= dataBytes + Math.ceil(count / 8)
      ? new Uint8Array(buffer, dataBytes)
      : null;
  for (let i = 0; i < count; i++) {
    const value = view.getFloat32(i * 4, true);
    const valid = mask ? ((mask[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0 : true;
    out[i] = valid && value > -1e30 && Number.isFinite(value) ? value : Number.NaN;
  }
  return out;
}

export function cellIndex(grid: TerrainGrid, p: LatLon): number {
  const { bounds, width, height } = grid;
  const col = Math.floor(((p.lon - bounds.west) / (bounds.east - bounds.west)) * width);
  const row = Math.floor(((bounds.north - p.lat) / (bounds.north - bounds.south)) * height);
  if (col < 0 || col >= width || row < 0 || row >= height) return -1;
  return row * width + col;
}

export function cellCenter(grid: TerrainGrid, index: number): LatLon {
  const { bounds, width, height } = grid;
  const col = index % width;
  const row = Math.floor(index / width);
  return {
    lon: bounds.west + ((col + 0.5) / width) * (bounds.east - bounds.west),
    lat: bounds.north - ((row + 0.5) / height) * (bounds.north - bounds.south),
  };
}

/** Elevation at a point (nearest cell). NaN outside the grid or where there is no data. */
export function elevationAt(grid: TerrainGrid, p: LatLon): number {
  const index = cellIndex(grid, p);
  return index < 0 ? Number.NaN : (grid.elevation[index] ?? Number.NaN);
}

/**
 * Steepest slope of every cell in degrees, by Horn's 3x3 method (the same
 * estimator GDAL and ArcGIS use). Cells with a missing neighbour get NaN.
 */
export function computeSlopeDeg(grid: TerrainGrid): Float32Array {
  const { width: w, height: h, elevation: z, cellSizeX: dx, cellSizeY: dy } = grid;
  const slope = new Float32Array(w * h).fill(Number.NaN);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const a = z[i - w - 1]!,
        b = z[i - w]!,
        cc = z[i - w + 1]!;
      const d = z[i - 1]!,
        f = z[i + 1]!;
      const g = z[i + w - 1]!,
        hh = z[i + w]!,
        k = z[i + w + 1]!;
      const dzdx = (cc + 2 * f + k - (a + 2 * d + g)) / (8 * dx);
      const dzdy = (g + 2 * hh + k - (a + 2 * b + cc)) / (8 * dy);
      slope[i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI; // NaN propagates
    }
  }
  return slope;
}

/** Hillshade in 0..1 for a Sun at the given azimuth (deg clockwise from north) and elevation. */
export function computeHillshade(
  grid: TerrainGrid,
  azimuthDeg = 315,
  sunElevationDeg = 40,
): Float32Array {
  const { width: w, height: h, elevation: z, cellSizeX: dx, cellSizeY: dy } = grid;
  const shade = new Float32Array(w * h).fill(Number.NaN);
  const zenith = ((90 - sunElevationDeg) * Math.PI) / 180;
  const azimuth = (((360 - azimuthDeg + 90) % 360) * Math.PI) / 180;
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const dzdx = (z[i + 1]! - z[i - 1]!) / (2 * dx);
      const dzdy = (z[i + w]! - z[i - w]!) / (2 * dy); // positive when rising southward
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const value =
        Math.cos(zenith) * Math.cos(slope) +
        Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect);
      shade[i] = Math.max(0, Math.min(1, value));
    }
  }
  return shade;
}

export interface GridStats {
  min: number;
  max: number;
  validFraction: number;
}

export function gridStats(values: Float32Array): GridStats {
  let min = Infinity;
  let max = -Infinity;
  let valid = 0;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, validFraction: values.length ? valid / values.length : 0 };
}
