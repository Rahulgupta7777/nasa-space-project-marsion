import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Plan } from './planner';
import { DEFAULT_SUIT } from './cost';
import { assess } from './verdict';
import type { Conditions } from './verdict';
import type { RemsRow } from './weather';
import { climatology, evaDoseMsv, fromRow, latestReport, parseRemsFeed, toRow } from './weather';

const feed = {
  soles: [
    {
      sol: '11',
      terrestrial_date: '2012-08-17',
      ls: '156',
      min_temp: '-76',
      max_temp: '-11',
      pressure: '740',
      min_gts_temp: '-83',
      max_gts_temp: '9',
      atmo_opacity: 'Sunny',
      local_uv_irradiance_index: 'Very_High',
    },
    {
      sol: '10',
      terrestrial_date: '2012-08-16',
      ls: '155',
      min_temp: '-75',
      max_temp: '-16',
      pressure: '739',
      min_gts_temp: '--',
      max_gts_temp: '8',
      atmo_opacity: 'Sunny',
      local_uv_irradiance_index: '--',
    },
    {
      sol: '12',
      terrestrial_date: '2012-08-18',
      ls: '156',
      min_temp: '--',
      max_temp: '--',
      pressure: '--',
      min_gts_temp: '--',
      max_gts_temp: '--',
      atmo_opacity: '--',
      local_uv_irradiance_index: '--',
    },
    { sol: '--', ls: '10' },
  ],
};

describe('REMS feed', () => {
  const sols = parseRemsFeed(feed);
  it('parses, sorts by sol and turns "--" into null', () => {
    expect(sols.map((s) => s.sol)).toEqual([10, 11, 12]);
    expect(sols[0]!.minGroundC).toBeNull();
    expect(sols[1]!.uvIndex).toBe('Very_High');
  });
  it('round-trips through the compact snapshot row', () => {
    expect(fromRow(toRow(sols[1]!))).toEqual(sols[1]);
  });
  it('finds the newest sol that actually has temperatures', () => {
    expect(latestReport(sols)?.sol).toBe(11);
  });
  it('rejects a feed without sols', () => {
    expect(() => parseRemsFeed({})).toThrow(/soles/);
  });
  it('averages sols near a solar longitude, wrapping at 360', () => {
    const c = climatology(sols, 155.5, 1);
    expect(c.sols).toBe(3);
    expect(c.minAirC?.mean).toBeCloseTo(-75.5);
    expect(climatology([{ ...sols[0]!, ls: 359 }], 2, 5).sols).toBe(1);
    expect(climatology(sols, 20, 5).minAirC).toBeNull();
  });
});

describe('bundled REMS snapshot', () => {
  const sols = (JSON.parse(readFileSync('public/data/rems.json', 'utf8')) as RemsRow[]).map(
    fromRow,
  );
  it('covers several Mars years with plausible Gale Crater values', () => {
    expect(sols.length).toBeGreaterThan(4000);
    const c = climatology(sols, 341, 5);
    expect(c.marsYears).toBeGreaterThanOrEqual(5);
    expect(c.minAirC!.mean).toBeLessThan(-50);
    expect(c.maxAirC!.mean).toBeGreaterThan(-40);
    expect(c.pressurePa!.mean).toBeGreaterThan(600);
    expect(c.pressurePa!.mean).toBeLessThan(1000);
  });
});

describe('radiation', () => {
  it('scales the RAD surface dose rate with EVA duration', () => {
    expect(evaDoseMsv(6 * 3600)).toBeCloseTo(0.16, 2);
  });
});

describe('assess', () => {
  const plan = (over: Partial<Plan> = {}): Plan => ({
    feasible: true,
    problem: null,
    legs: [],
    excluded: [],
    profile: [],
    visits: [
      {
        stop: {
          id: 'a',
          name: 'a',
          position: { lat: 0, lon: 0 },
          value: 1,
          dwellMinutes: 10,
          required: false,
        },
        arrivalS: 0,
        departureS: 600,
        o2UsedKg: 0.1,
        walkbackKg: 0.05,
        walkbackMarginKg: 0.2,
      },
    ],
    totals: {
      distanceM: 4000,
      walkS: 6000,
      dwellS: 600,
      totalS: 6600,
      o2Kg: 0.2,
      ascentM: 40,
      scienceValue: 1,
      maxSlopeDeg: 6,
    },
    budget: { usableO2Kg: 0.44, timeBudgetS: 20000, o2MarginKg: 0.24, timeMarginS: 13400 },
    walkback: { minMarginKg: 0.2, at: null },
    ...over,
  });
  const calm: Conditions = {
    departureLmst: 9,
    returnLmst: 11,
    sunsetLmst: 18,
    sunsetMarginMin: 60,
    dustStormSeason: false,
    opacity: 'Sunny',
    uvIndex: 'Moderate',
    weatherAgeDays: 1,
  };

  it('is GO for a comfortable plan in calm conditions', () => {
    expect(assess(plan(), DEFAULT_SUIT, calm)).toEqual({ verdict: 'GO', findings: [] });
  });
  it('is CAUTION for thin oxygen margin or steep ground', () => {
    const thin = assess(
      plan({
        budget: { usableO2Kg: 0.44, timeBudgetS: 20000, o2MarginKg: 0.03, timeMarginS: 100 },
      }),
      DEFAULT_SUIT,
      calm,
    );
    expect(thin.verdict).toBe('CAUTION');
    expect(thin.findings[0]!.code).toBe('LOW_O2_MARGIN');
    const steep = assess(
      plan({ totals: { ...plan().totals, maxSlopeDeg: 17 } }),
      DEFAULT_SUIT,
      calm,
    );
    expect(steep.findings.map((f) => f.code)).toContain('STEEP');
  });
  it('is NO-GO when the plan is infeasible, returns after dark or cannot walk back', () => {
    expect(assess(plan({ feasible: false, problem: 'Too far.' }), DEFAULT_SUIT, calm).verdict).toBe(
      'NO-GO',
    );
    expect(assess(plan(), DEFAULT_SUIT, { ...calm, returnLmst: 17.5 }).findings[0]!.code).toBe(
      'DAYLIGHT',
    );
    expect(
      assess(plan({ walkback: { minMarginKg: -0.01, at: null } }), DEFAULT_SUIT, calm).verdict,
    ).toBe('NO-GO');
  });
  it('keeps seasonal notes informational', () => {
    const a = assess(plan(), DEFAULT_SUIT, { ...calm, dustStormSeason: true, weatherAgeDays: 80 });
    expect(a.verdict).toBe('GO');
    expect(a.findings.map((f) => f.severity)).toEqual(['info', 'info']);
  });
});
