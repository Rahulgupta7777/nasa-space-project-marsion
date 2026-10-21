/**
 * Mars time and Sun position.
 *
 * Implements the NASA GISS "Mars24" algorithm (Allison & McEwen 2000,
 * Planetary and Space Science 48, 215-235; worked example published at
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html). The unit test
 * reproduces that page's worked example for 2000-01-06 00:00 UTC.
 */
import type { LatLon } from './geo';

/** Earth seconds in one Mars solar day. */
export const SOL_SECONDS = 88_775.244;
/** Earth hours in one Mars hour (1/24 sol). */
export const EARTH_HOURS_PER_MARS_HOUR = SOL_SECONDS / 86_400;

const DEG = Math.PI / 180;
const sinD = (d: number): number => Math.sin(d * DEG);
const cosD = (d: number): number => Math.cos(d * DEG);
const mod = (x: number, m: number): number => ((x % m) + m) % m;

/** TAI-UTC (leap seconds) since 1999. No leap second has been added after 2017-01-01. */
const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = [
  [Date.UTC(2017, 0, 1), 37],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(1999, 0, 1), 32],
];

/** Terrestrial Time minus UTC, seconds. */
export function ttMinusUtcSeconds(utcMs: number): number {
  for (const [from, leap] of LEAP_SECONDS) if (utcMs >= from) return leap + 32.184;
  return 32 + 32.184;
}

/** Perturbations by other planets: amplitude (deg), period (Earth years), phase (deg). */
const PERTURBERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

export interface MarsClock {
  /** Areocentric solar longitude, degrees. 0 = northern spring equinox. */
  ls: number;
  /** Equation of time, degrees. */
  equationOfTimeDeg: number;
  /** Coordinated Mars Time at the prime meridian, hours. */
  mtcHours: number;
  /** Mars Sol Date (sols since the Mars24 epoch). */
  marsSolDate: number;
  /** Local Mean Solar Time at the site, hours. */
  lmstHours: number;
  /** Local True Solar Time at the site, hours. */
  ltstHours: number;
  /** Solar declination, degrees. */
  declinationDeg: number;
  /** Sub-solar longitude, degrees west. */
  subsolarLonWestDeg: number;
  /** Elevation of the Sun above the local horizon, degrees. */
  sunElevationDeg: number;
  /** Mars-Sun distance, astronomical units. */
  sunDistanceAU: number;
  /** Sunrise and sunset in Local Mean Solar Time, hours. NaN in polar day or night. */
  sunriseLmst: number;
  sunsetLmst: number;
}

/** Mars time and Sun geometry for an instant on Earth and a site on Mars. */
export function marsClock(date: Date, site: LatLon): MarsClock {
  const utcMs = date.getTime();
  const jdUt = 2_440_587.5 + utcMs / 86_400_000;
  const jdTt = jdUt + ttMinusUtcSeconds(utcMs) / 86_400;
  const dt = jdTt - 2_451_545.0;

  const meanAnomaly = 19.3871 + 0.52402073 * dt;
  const fictitiousMeanSun = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [amp, tau, phi] of PERTURBERS) pbs += amp * cosD((0.985626 * dt) / tau + phi);
  const equationOfCenter =
    (10.691 + 3.0e-7 * dt) * sinD(meanAnomaly) +
    0.623 * sinD(2 * meanAnomaly) +
    0.05 * sinD(3 * meanAnomaly) +
    0.005 * sinD(4 * meanAnomaly) +
    0.0005 * sinD(5 * meanAnomaly) +
    pbs;
  const ls = mod(fictitiousMeanSun + equationOfCenter, 360);

  const equationOfTimeDeg =
    2.861 * sinD(2 * ls) - 0.071 * sinD(4 * ls) + 0.002 * sinD(6 * ls) - equationOfCenter;

  const marsSolDate = (dt - 4.5) / 1.0274912517 + 44_796.0 - 0.0009626;
  const mtcHours = mod(24 * marsSolDate, 24);

  const lonWest = mod(-site.lon, 360);
  const lmstHours = mod(mtcHours - lonWest / 15, 24);
  const ltstHours = mod(lmstHours + equationOfTimeDeg / 15, 24);

  const declinationDeg = Math.asin(0.42565 * sinD(ls)) / DEG + 0.25 * sinD(ls);
  const subsolarLonWestDeg = mod(mtcHours * 15 + equationOfTimeDeg + 180, 360);

  const cosZenith =
    sinD(declinationDeg) * sinD(site.lat) +
    cosD(declinationDeg) * cosD(site.lat) * cosD(lonWest - subsolarLonWestDeg);
  const sunElevationDeg = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / DEG;

  const sunDistanceAU =
    1.52367934 *
    (1.00436 -
      0.09309 * cosD(meanAnomaly) -
      0.004336 * cosD(2 * meanAnomaly) -
      0.00031 * cosD(3 * meanAnomaly) -
      0.00003 * cosD(4 * meanAnomaly));

  // Geometric sunrise and sunset (no refraction, point Sun).
  const cosHourAngle = -Math.tan(site.lat * DEG) * Math.tan(declinationDeg * DEG);
  let sunriseLmst = Number.NaN;
  let sunsetLmst = Number.NaN;
  if (Math.abs(cosHourAngle) <= 1) {
    const halfDayHours = Math.acos(cosHourAngle) / DEG / 15;
    sunriseLmst = mod(12 - halfDayHours - equationOfTimeDeg / 15, 24);
    sunsetLmst = mod(12 + halfDayHours - equationOfTimeDeg / 15, 24);
  }

  return {
    ls,
    equationOfTimeDeg,
    mtcHours,
    marsSolDate,
    lmstHours,
    ltstHours,
    declinationDeg,
    subsolarLonWestDeg,
    sunElevationDeg,
    sunDistanceAU,
    sunriseLmst,
    sunsetLmst,
  };
}

/** Season name at a site from solar longitude. */
export function seasonName(ls: number, latDeg: number): string {
  const northern = ['spring', 'summer', 'autumn', 'winter'] as const;
  const southern = ['autumn', 'winter', 'spring', 'summer'] as const;
  const quarter = Math.floor(mod(ls, 360) / 90);
  return (latDeg >= 0 ? northern : southern)[quarter] ?? 'spring';
}

/**
 * Regional and global dust storms cluster in southern spring and summer
 * (Ls 180-360), when Mars is near perihelion.
 */
export function isDustStormSeason(ls: number): boolean {
  return mod(ls, 360) >= 180;
}

/** Format a clock value in hours as HH:MM. */
export function formatClock(hours: number): string {
  if (!Number.isFinite(hours)) return '--:--';
  const totalMinutes = Math.round(mod(hours, 24) * 60) % 1440;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
