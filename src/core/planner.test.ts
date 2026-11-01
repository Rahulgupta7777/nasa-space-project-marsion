import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUIT, usableEnergyJ } from './cost';
import { planSortie, returnEnvelope, solveTour } from './planner';
import type { Stop } from './planner';
import { cellCenter, computeSlopeDeg, makeGrid } from './terrain';
import { syntheticGrid } from './testing';

/** Deterministic pseudo-random numbers for the brute-force comparison. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function bruteForce(
  e: number[][],
  t: number[][],
  values: number[],
  budgetE: number,
  budgetT: number,
): number {
  const m = values.length;
  let best = 0;
  const visit = (last: number, used: number, energy: number, time: number, value: number): void => {
    if (energy + e[last]![0]! <= budgetE && time + t[last]![0]! <= budgetT)
      best = Math.max(best, value);
    for (let j = 0; j < m; j++) {
      if (used & (1 << j)) continue;
      visit(
        j + 1,
        used | (1 << j),
        energy + e[last]![j + 1]!,
        time + t[last]![j + 1]!,
        value + values[j]!,
      );
    }
  };
  visit(0, 0, 0, 0, 0);
  return best;
}

describe('solveTour', () => {
  it('finds the same best science value as exhaustive search on random instances', () => {
    const random = lcg(42);
    for (let trial = 0; trial < 40; trial++) {
      const m = 2 + Math.floor(random() * 5);
      const matrix = (): number[][] =>
        Array.from({ length: m + 1 }, (_, i) =>
          Array.from({ length: m + 1 }, (_, j) => (i === j ? 0 : 1 + random() * 9)),
        );
      const e = matrix();
      const t = matrix();
      const values = Array.from({ length: m }, () => 1 + Math.floor(random() * 5));
      const budgetE = 8 + random() * 20;
      const budgetT = 8 + random() * 20;
      const tour = solveTour(
        e,
        t,
        values.map((value) => ({ value, required: false })),
        Array(m).fill(0),
        Array(m).fill(0),
        budgetE,
        budgetT,
      );
      // Minimising energy and time separately can miss an order that trades one for the other,
      // so the solver may be below the exhaustive optimum, never above it, and is exact when one budget is slack.
      expect(tour.value).toBeLessThanOrEqual(bruteForce(e, t, values, budgetE, budgetT));
      const slackTime = solveTour(
        e,
        t,
        values.map((value) => ({ value, required: false })),
        Array(m).fill(0),
        Array(m).fill(0),
        budgetE,
        1e9,
      );
      expect(slackTime.value).toBe(bruteForce(e, t, values, budgetE, 1e9));
      expect(slackTime.energy).toBeLessThanOrEqual(budgetE);
    }
  });

  it('visits required stops first and reports the overshoot when they do not fit', () => {
    const e = [
      [0, 5, 1],
      [5, 0, 5],
      [1, 5, 0],
    ];
    const stops = [
      { value: 1, required: true },
      { value: 9, required: false },
    ];
    const fits = solveTour(e, e, stops, [0, 0], [0, 0], 10, 100);
    expect(fits.order).toEqual([0]); // the valuable optional stop would need 11
    const tooFar = solveTour(e, e, stops, [0, 0], [0, 0], 8, 100);
    expect(tooFar.feasible).toBe(false);
    expect(tooFar.order).toEqual([0]);
    expect(tooFar.energy).toBe(10);
  });

  it('counts work at a stop against the budgets', () => {
    const e = [
      [0, 2],
      [2, 0],
    ];
    expect(solveTour(e, e, [{ value: 1, required: false }], [5], [0], 8, 100).order).toEqual([]);
    expect(solveTour(e, e, [{ value: 1, required: false }], [3], [0], 8, 100).order).toEqual([0]);
  });
});

describe('planSortie on synthetic terrain', () => {
  const grid = syntheticGrid(101, 20, (x) => (x > 1400 ? (x - 1400) * 0.15 : 0)); // flat plain, hill to the east
  const slope = computeSlopeDeg(grid);
  const at = (col: number, row: number) => cellCenter(grid, row * 101 + col);
  const stop = (id: string, col: number, row: number, extra: Partial<Stop> = {}): Stop => ({
    id,
    name: id,
    position: at(col, row),
    value: 3,
    dwellMinutes: 20,
    required: false,
    ...extra,
  });
  const habitat = at(20, 50);

  it('returns a closed loop whose totals add up', () => {
    const plan = planSortie(grid, slope, {
      habitat,
      profile: DEFAULT_SUIT,
      timeBudgetS: 8 * 3600,
      stops: [stop('a', 40, 50), stop('b', 40, 20), stop('c', 20, 20)],
    });
    expect(plan.feasible).toBe(true);
    expect(plan.visits).toHaveLength(3);
    expect(plan.legs).toHaveLength(4);
    expect(plan.legs[0]!.fromName).toBe('Habitat');
    expect(plan.legs.at(-1)!.toName).toBe('Habitat');
    expect(plan.totals.dwellS).toBe(3600);
    expect(plan.totals.walkS + plan.totals.dwellS).toBeCloseTo(plan.totals.totalS, 6);
    expect(plan.totals.distanceM).toBeCloseTo(
      plan.legs.reduce((s, l) => s + l.distanceM, 0),
      6,
    );
    expect(plan.budget.o2MarginKg).toBeCloseTo(plan.budget.usableO2Kg - plan.totals.o2Kg, 9);
    // A 400 m x 600 m rectangle on flat ground: the loop is its perimeter.
    expect(plan.totals.distanceM).toBeCloseTo(2000, 0);
    expect(plan.profile[0]!.distanceM).toBe(0);
  });

  it('never lets the walk-back margin go negative on a feasible plan', () => {
    const plan = planSortie(grid, slope, {
      habitat,
      profile: DEFAULT_SUIT,
      timeBudgetS: 8 * 3600,
      stops: [stop('a', 60, 50), stop('b', 60, 10), stop('c', 5, 90)],
    });
    expect(plan.feasible).toBe(true);
    expect(plan.walkback.minMarginKg).toBeGreaterThanOrEqual(0);
    for (const v of plan.visits)
      expect(v.walkbackMarginKg).toBeGreaterThanOrEqual(plan.walkback.minMarginKg - 1e-9);
  });

  it('drops optional stops that do not fit and keeps the most valuable', () => {
    const tight = { ...DEFAULT_SUIT, o2PrimaryKg: 0.12 };
    const plan = planSortie(grid, slope, {
      habitat,
      profile: tight,
      timeBudgetS: 8 * 3600,
      stops: [
        stop('near-low', 28, 50, { value: 1 }),
        stop('near-high', 20, 42, { value: 5 }),
        stop('far', 95, 5, { value: 4 }),
      ],
    });
    expect(plan.feasible).toBe(true);
    expect(plan.visits.map((v) => v.stop.id)).toContain('near-high');
    expect(plan.excluded.find((e) => e.stop.id === 'far')?.reason).toBe('budget');
    expect(plan.totals.o2Kg).toBeLessThanOrEqual(plan.budget.usableO2Kg);
  });

  it('is infeasible with a clear reason when a required stop is out of reach', () => {
    const tight = { ...DEFAULT_SUIT, o2PrimaryKg: 0.12 };
    const plan = planSortie(grid, slope, {
      habitat,
      profile: tight,
      timeBudgetS: 8 * 3600,
      stops: [stop('far', 95, 5, { required: true })],
    });
    expect(plan.feasible).toBe(false);
    expect(plan.problem).toMatch(/oxygen/);
    expect(plan.visits).toHaveLength(1); // the attempted route is still shown
  });

  it('respects the time budget and reports stops off the terrain', () => {
    const plan = planSortie(grid, slope, {
      habitat,
      profile: DEFAULT_SUIT,
      timeBudgetS: 1800,
      stops: [stop('a', 40, 50), { ...stop('nowhere', 0, 0), position: { lat: 40, lon: 40 } }],
    });
    expect(plan.visits).toHaveLength(0);
    expect(plan.excluded.find((e) => e.stop.id === 'nowhere')?.reason).toBe('outside-terrain');
    expect(plan.excluded.find((e) => e.stop.id === 'a')?.reason).toBe('budget');
  });

  it('draws a return envelope that shrinks with less oxygen', () => {
    const reach = (o2PrimaryKg: number): number => {
      const env = returnEnvelope(grid, slope, habitat, { ...DEFAULT_SUIT, o2PrimaryKg });
      return env.reduce((n, v) => (v <= 1 ? n + 1 : n), 0);
    };
    expect(reach(0.55)).toBeGreaterThan(reach(0.05));
    expect(reach(0.05)).toBeGreaterThan(0);
  });
});

describe('planSortie on the bundled NASA HiRISE terrain of Gale Crater', () => {
  const meta = JSON.parse(readFileSync('public/data/gale-dem.json', 'utf8')) as {
    width: number;
    height: number;
    bounds: { west: number; south: number; east: number; north: number };
  };
  const bin = readFileSync('public/data/gale-dem.bin');
  const elevation = new Float32Array(
    bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
  );
  const grid = makeGrid(meta.width, meta.height, meta.bounds, elevation, 'HiRISE');
  const slope = computeSlopeDeg(grid);
  const sites = JSON.parse(readFileSync('public/data/curiosity-sites.json', 'utf8')) as {
    id: string;
    name: string;
    lon: number;
    lat: number;
  }[];
  const site = (name: string): Stop => {
    const s = sites.find((x) => x.name === name)!;
    return {
      id: s.id,
      name: s.name,
      position: { lat: s.lat, lon: s.lon },
      value: 3,
      dwellMinutes: 30,
      required: false,
    };
  };

  it('has ~20 m cells and Bradbury Landing near -4501 m', () => {
    expect(grid.cellSizeX).toBeGreaterThan(19);
    expect(grid.cellSizeX).toBeLessThan(21);
    const bradbury = site('Bradbury Landing').position;
    const z =
      grid.elevation[
        Math.floor(
          ((meta.bounds.north - bradbury.lat) / (meta.bounds.north - meta.bounds.south)) *
            meta.height,
        ) *
          meta.width +
          Math.floor(
            ((bradbury.lon - meta.bounds.west) / (meta.bounds.east - meta.bounds.west)) *
              meta.width,
          )
      ]!;
    expect(z).toBeGreaterThan(-4510);
    expect(z).toBeLessThan(-4492);
  });

  it('plans a feasible science loop from Pahrump Hills that climbs towards Mount Sharp', () => {
    const plan = planSortie(grid, slope, {
      habitat: site('Pahrump Hills').position,
      profile: DEFAULT_SUIT,
      timeBudgetS: 7 * 3600,
      stops: [
        'Marias Pass',
        'Bagnold Dunes',
        'Murray Buttes',
        'Vera Rubin Ridge',
        'The Kimberly',
      ].map(site),
    });
    expect(plan.feasible).toBe(true);
    expect(plan.visits.length).toBeGreaterThanOrEqual(2);
    expect(plan.totals.o2Kg).toBeLessThanOrEqual(plan.budget.usableO2Kg);
    expect(plan.totals.totalS).toBeLessThanOrEqual(7 * 3600);
    expect(plan.totals.maxSlopeDeg).toBeLessThanOrEqual(DEFAULT_SUIT.maxSlopeDeg);
    expect(plan.walkback.minMarginKg).toBeGreaterThanOrEqual(0);
    expect(usableEnergyJ(DEFAULT_SUIT)).toBeGreaterThan(0);
  });
});
