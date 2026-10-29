import { describe, expect, it } from 'vitest';
import { DEFAULT_SUIT, speedOnGrade, stepCost, usableEnergyJ, o2KgFromJoules } from './cost';
import { computeCostField, tracePath } from './pathfield';
import { computeSlopeDeg } from './terrain';
import { syntheticGrid } from './testing';

describe('cost model', () => {
  it('walks at the configured speed on level ground and slower uphill', () => {
    expect(speedOnGrade(DEFAULT_SUIT, 0)).toBeCloseTo(DEFAULT_SUIT.flatSpeedMps, 9);
    expect(speedOnGrade(DEFAULT_SUIT, 0.2)).toBeLessThan(speedOnGrade(DEFAULT_SUIT, 0));
    expect(speedOnGrade(DEFAULT_SUIT, 0.2)).toBeLessThan(speedOnGrade(DEFAULT_SUIT, -0.2));
  });
  it('charges for lifting the suited mass against Mars gravity', () => {
    const flat = stepCost(DEFAULT_SUIT, 100, 0)!;
    const up = stepCost(DEFAULT_SUIT, 100, 10)!;
    const lift = (DEFAULT_SUIT.suitedMassKg * 3.71 * 10) / DEFAULT_SUIT.climbEfficiency;
    expect(up.joules - DEFAULT_SUIT.walkMetabolicW * up.seconds).toBeCloseTo(lift, 6);
    expect(up.joules).toBeGreaterThan(flat.joules);
  });
  it('refuses steps beyond the slope limit in either direction', () => {
    const tooSteep = 100 * Math.tan(((DEFAULT_SUIT.maxSlopeDeg + 1) * Math.PI) / 180);
    expect(stepCost(DEFAULT_SUIT, 100, tooSteep)).toBeNull();
    expect(stepCost(DEFAULT_SUIT, 100, -tooSteep)).toBeNull();
    expect(stepCost(DEFAULT_SUIT, 100, Number.NaN)).toBeNull();
  });
  it('keeps the oxygen reserve out of the usable budget', () => {
    expect(o2KgFromJoules(usableEnergyJ(DEFAULT_SUIT))).toBeCloseTo(0.55 * 0.8, 9);
  });
});

describe('computeCostField', () => {
  const size = 41;
  const cell = 20;
  const centre = 20 * size + 20;

  it('matches straight-line walking on flat ground along the axes', () => {
    const grid = syntheticGrid(size, cell, () => 0);
    const field = computeCostField(grid, computeSlopeDeg(grid), DEFAULT_SUIT, centre, 'from');
    const east10 = centre + 10;
    expect(field.seconds[east10]).toBeCloseTo((10 * grid.cellSizeX) / DEFAULT_SUIT.flatSpeedMps, 3);
    expect(field.energy[east10]).toBeCloseTo(
      field.seconds[east10]! * DEFAULT_SUIT.walkMetabolicW,
      3,
    );
    expect(tracePath(field, east10)).toHaveLength(11);
    expect(tracePath(field, east10)[0]).toBe(centre);
  });

  it('makes climbing cost more than descending the same ground', () => {
    const grid = syntheticGrid(size, cell, (x) => x * 0.1); // rises to the east
    const slope = computeSlopeDeg(grid);
    const out = computeCostField(grid, slope, DEFAULT_SUIT, centre, 'from');
    const back = computeCostField(grid, slope, DEFAULT_SUIT, centre, 'to');
    const uphillCell = centre + 10;
    expect(out.energy[uphillCell]).toBeGreaterThan(back.energy[uphillCell]! * 1.5);
    // `to` paths run from the cell towards the source.
    const path = tracePath(back, uphillCell);
    expect(path[0]).toBe(uphillCell);
    expect(path.at(-1)).toBe(centre);
  });

  it('routes around a wall that is too steep and reports cut-off cells as unreachable', () => {
    // A 200 m cliff band across the middle with one gap at the western end.
    const grid = syntheticGrid(size, cell, (x, y) => (y > 400 && y < 460 && x > 100 ? 200 : 0));
    const slope = computeSlopeDeg(grid);
    const south = 35 * size + 30;
    const north = 5 * size + 30;
    const field = computeCostField(grid, slope, DEFAULT_SUIT, south, 'from');
    const direct = (30 * cell) / DEFAULT_SUIT.flatSpeedMps;
    expect(Number.isFinite(field.energy[north]!)).toBe(true);
    expect(field.seconds[north]).toBeGreaterThan(direct * 1.5);
    const path = tracePath(field, north);
    expect(path.every((c) => grid.elevation[c] === 0)).toBe(true);

    const sealed = syntheticGrid(size, cell, (_x, y) => (y > 400 && y < 460 ? 200 : 0));
    const blocked = computeCostField(sealed, computeSlopeDeg(sealed), DEFAULT_SUIT, south, 'from');
    expect(blocked.energy[north]).toBe(Infinity);
    expect(tracePath(blocked, north)).toEqual([]);
  });
});
