/**
 * Curiosity REMS weather: parsing NASA's public feed and deriving a seasonal
 * climatology from it.
 *
 * Feed: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
 * (data provided to NASA by Centro de Astrobiologia, CSIC-INTA).
 */

export interface RemsSol {
  sol: number;
  /** Earth date, YYYY-MM-DD. */
  date: string;
  /** Solar longitude, degrees. */
  ls: number;
  minAirC: number | null;
  maxAirC: number | null;
  pressurePa: number | null;
  minGroundC: number | null;
  maxGroundC: number | null;
  opacity: string | null;
  uvIndex: string | null;
}

/** Compact tuple used for the bundled snapshot. Field order matches RemsSol. */
export type RemsRow = [
  number,
  string,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string | null,
  string | null,
];

const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '' || value.trim() === '--') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.trim() !== '--' ? value.trim() : null;

/** Parse the raw NASA feed. Records without a sol number or solar longitude are dropped. */
export function parseRemsFeed(feed: unknown): RemsSol[] {
  const soles = (feed as { soles?: unknown })?.soles;
  if (!Array.isArray(soles)) throw new Error('REMS feed has no "soles" array');
  const out: RemsSol[] = [];
  for (const raw of soles as Array<Record<string, unknown>>) {
    const sol = num(raw.sol);
    const ls = num(raw.ls);
    if (sol === null || ls === null) continue;
    out.push({
      sol,
      date: text(raw.terrestrial_date) ?? '',
      ls,
      minAirC: num(raw.min_temp),
      maxAirC: num(raw.max_temp),
      pressurePa: num(raw.pressure),
      minGroundC: num(raw.min_gts_temp),
      maxGroundC: num(raw.max_gts_temp),
      opacity: text(raw.atmo_opacity),
      uvIndex: text(raw.local_uv_irradiance_index),
    });
  }
  return out.sort((a, b) => a.sol - b.sol);
}

export const toRow = (s: RemsSol): RemsRow => [
  s.sol,
  s.date,
  s.ls,
  s.minAirC,
  s.maxAirC,
  s.pressurePa,
  s.minGroundC,
  s.maxGroundC,
  s.opacity,
  s.uvIndex,
];
export const fromRow = (r: RemsRow): RemsSol => ({
  sol: r[0],
  date: r[1],
  ls: r[2],
  minAirC: r[3],
  maxAirC: r[4],
  pressurePa: r[5],
  minGroundC: r[6],
  maxGroundC: r[7],
  opacity: r[8],
  uvIndex: r[9],
});

/** Most recent sol that reports an air temperature. */
export function latestReport(sols: RemsSol[]): RemsSol | null {
  for (let i = sols.length - 1; i >= 0; i--) {
    const s = sols[i]!;
    if (s.minAirC !== null && s.maxAirC !== null) return s;
  }
  return null;
}

export interface Range {
  mean: number;
  min: number;
  max: number;
}

export interface Climatology {
  /** Number of sols that fell inside the window. */
  sols: number;
  /** Number of distinct Mars years those sols come from. */
  marsYears: number;
  minAirC: Range | null;
  maxAirC: Range | null;
  pressurePa: Range | null;
  maxGroundC: Range | null;
}

const summarise = (values: number[]): Range | null =>
  values.length
    ? {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
      }
    : null;

const lsDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * What REMS has measured at this time of the Mars year: statistics over every
 * sol whose solar longitude is within `halfWindowDeg` of `ls`.
 */
export function climatology(sols: RemsSol[], ls: number, halfWindowDeg = 5): Climatology {
  const near = sols.filter((s) => lsDistance(s.ls, ls) <= halfWindowDeg);
  // One Mars year is 668.6 sols; group mission sols into years to count coverage.
  const years = new Set(near.map((s) => Math.floor(s.sol / 668.6)));
  const pick = (key: 'minAirC' | 'maxAirC' | 'pressurePa' | 'maxGroundC'): number[] =>
    near.map((s) => s[key]).filter((v): v is number => v !== null);
  return {
    sols: near.length,
    marsYears: years.size,
    minAirC: summarise(pick('minAirC')),
    maxAirC: summarise(pick('maxAirC')),
    pressurePa: summarise(pick('pressurePa')),
    maxGroundC: summarise(pick('maxGroundC')),
  };
}

/**
 * Average galactic-cosmic-ray dose equivalent on the surface at Gale Crater,
 * measured by Curiosity RAD: 0.64 +/- 0.12 mSv per day
 * (Hassler et al. 2014, Science 343, 1244797).
 */
export const SURFACE_DOSE_MSV_PER_DAY = 0.64;

export function evaDoseMsv(evaSeconds: number): number {
  return (SURFACE_DOSE_MSV_PER_DAY * evaSeconds) / 86_400;
}
