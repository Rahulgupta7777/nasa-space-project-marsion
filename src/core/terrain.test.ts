import { describe, expect, it } from 'vitest';
import { syntheticGrid } from './testing';
import {
  cellCenter,
  cellIndex,
  computeHillshade,
  computeSlopeDeg,
  decodeBipFloat32,
  elevationAt,
} from './terrain';

describe('decodeBipFloat32', () => {
  it('reads little-endian floats and applies the trailing validity mask', () => {
    const buffer = new ArrayBuffer(8 * 4 + 1);
    const view = new DataView(buffer);
    for (let i = 0; i < 8; i++) view.setFloat32(i * 4, i < 4 ? -3.4028235e38 : -4500 - i, true);
    view.setUint8(32, 0x0f); // first four pixels invalid, as NASA Trek returns for partial coverage
    const out = decodeBipFloat32(buffer, 4, 2);
    expect([...out.slice(0, 4)].every(Number.isNaN)).toBe(true);
    expect(out[4]).toBeCloseTo(-4504);
    expect(out[7]).toBeCloseTo(-4507);
  });
  it('treats the NoData sentinel as missing even without a mask', () => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat32(0, -3.4028235e38, true);
    new DataView(buffer).setFloat32(4, 12.5, true);
    const out = decodeBipFloat32(buffer, 2, 1);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(12.5);
  });
  it('rejects a truncated response', () => {
    expect(() => decodeBipFloat32(new ArrayBuffer(10), 2, 2)).toThrow(/too short/);
  });
});

describe('grid geometry', () => {
  const grid = syntheticGrid(50, 20, (x) => x * 0.1);
  it('round-trips between cells and coordinates', () => {
    const index = 17 * 50 + 31;
    expect(cellIndex(grid, cellCenter(grid, index))).toBe(index);
    expect(cellIndex(grid, { lat: 5, lon: 0.001 })).toBe(-1);
  });
  it('has the requested cell size', () => {
    expect(grid.cellSizeX).toBeCloseTo(20, 1);
    expect(grid.cellSizeY).toBeCloseTo(20, 6);
  });
  it('samples elevation', () => {
    expect(elevationAt(grid, cellCenter(grid, 10))).toBeCloseTo(20, 3); // column 10 -> x = 200 m
  });
});

describe('computeSlopeDeg', () => {
  it('recovers the slope of an inclined plane', () => {
    const tan10 = Math.tan((10 * Math.PI) / 180);
    const slope = computeSlopeDeg(syntheticGrid(20, 15, (x, y) => (x + y) * (tan10 / Math.SQRT2)));
    expect(slope[10 * 20 + 10]).toBeCloseTo(10, 1);
    expect(Number.isNaN(slope[0])).toBe(true); // no neighbours at the edge
  });
  it('is zero on flat ground', () => {
    expect(computeSlopeDeg(syntheticGrid(10, 20, () => -4500))[55]).toBeCloseTo(0, 6);
  });
});

describe('computeHillshade', () => {
  it('lights slopes that face the Sun and darkens those that face away', () => {
    const facingNorthWest = syntheticGrid(10, 20, (x, y) => (x - y) * 0.3); // rises to the south-east
    const facingSouthEast = syntheticGrid(10, 20, (x, y) => (y - x) * 0.3);
    const lit = computeHillshade(facingNorthWest, 315, 40)[55]!;
    const dark = computeHillshade(facingSouthEast, 315, 40)[55]!;
    expect(lit).toBeGreaterThan(0.85);
    expect(dark).toBeLessThan(lit - 0.3);
  });
});
