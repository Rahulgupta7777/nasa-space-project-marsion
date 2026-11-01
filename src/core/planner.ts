/**
 * Sortie planner.
 *
 * Given a habitat, a set of candidate science stops and a suit, find the
 * closed loop that collects the most science value while staying inside the
 * oxygen and time budgets. Stops marked `required` must be visited; the rest
 * are added only if the budget allows.
 *
 * This is an orienteering problem. With at most MAX_STOPS candidates it is
 * solved exactly by dynamic programming over subsets (Held-Karp), using leg
 * costs measured on real terrain by `computeCostField`.
 */
import type { SuitProfile } from './cost';
import { o2KgFromJoules, usableEnergyJ } from './cost';
import type { LatLon } from './geo';
import type { CostField } from './pathfield';
import { computeCostField, tracePath } from './pathfield';
import type { TerrainGrid } from './terrain';
import { cellCenter, cellIndex } from './terrain';

/** Subset DP is exponential; 12 stops is 4096 subsets and solves in milliseconds. */
export const MAX_STOPS = 12;

export interface Stop {
  id: string;
  name: string;
  position: LatLon;
  /** Science value, any positive scale. The planner maximises the sum. */
  value: number;
  /** Time spent working at the stop, minutes. */
  dwellMinutes: number;
  /** Must be part of the route. */
  required: boolean;
}

export interface PlanRequest {
  habitat: LatLon;
  stops: Stop[];
  profile: SuitProfile;
  /** Time available for the whole EVA (walking plus work), seconds. */
  timeBudgetS: number;
}

export interface ProfilePoint {
  /** Distance walked since leaving the habitat, metres. */
  distanceM: number;
  elevationM: number;
}

export interface Leg {
  fromName: string;
  toName: string;
  path: LatLon[];
  distanceM: number;
  seconds: number;
  joules: number;
  ascentM: number;
  descentM: number;
  /** Steepest step along the leg, degrees. */
  maxSlopeDeg: number;
}

export interface Visit {
  stop: Stop;
  arrivalS: number;
  departureS: number;
  /** Oxygen used from the habitat up to leaving this stop, kg. */
  o2UsedKg: number;
  /** Oxygen needed to walk straight home from here, kg. */
  walkbackKg: number;
  /** Usable oxygen left after an immediate walk home from here, kg. */
  walkbackMarginKg: number;
}

export type ExclusionReason = 'outside-terrain' | 'unreachable' | 'budget' | 'over-limit';

export interface Excluded {
  stop: Stop;
  reason: ExclusionReason;
}

export interface Plan {
  /** True when the route satisfies every budget and includes every required stop. */
  feasible: boolean;
  /** Plain-language explanation when `feasible` is false. */
  problem: string | null;
  visits: Visit[];
  legs: Leg[];
  excluded: Excluded[];
  profile: ProfilePoint[];
  totals: {
    distanceM: number;
    walkS: number;
    dwellS: number;
    totalS: number;
    o2Kg: number;
    ascentM: number;
    scienceValue: number;
    maxSlopeDeg: number;
  };
  budget: {
    usableO2Kg: number;
    timeBudgetS: number;
    o2MarginKg: number;
    timeMarginS: number;
  };
  /** The point on the route where an immediate walk home would leave the least oxygen. */
  walkback: { minMarginKg: number; at: LatLon | null };
}

export interface Tour {
  /** Stop indices (0-based into the stop list) in visiting order. */
  order: number[];
  energy: number;
  seconds: number;
  value: number;
  feasible: boolean;
}

interface DpResult {
  cost: Float64Array;
  other: Float64Array;
  prev: Int8Array;
}

/**
 * Held-Karp over subsets, minimising `primary` and carrying `secondary` along
 * the same path. Matrices are indexed with node 0 = habitat, node i+1 = stop i.
 */
function runDp(
  m: number,
  primary: number[][],
  secondary: number[][],
  dwellPrimary: number[],
  dwellSecondary: number[],
): DpResult {
  const states = (1 << m) * m;
  const cost = new Float64Array(states).fill(Infinity);
  const other = new Float64Array(states).fill(Infinity);
  const prev = new Int8Array(states).fill(-1);
  for (let j = 0; j < m; j++) {
    const s = (1 << j) * m + j;
    cost[s] = primary[0]![j + 1]! + dwellPrimary[j]!;
    other[s] = secondary[0]![j + 1]! + dwellSecondary[j]!;
  }
  for (let mask = 1; mask < 1 << m; mask++) {
    for (let last = 0; last < m; last++) {
      const s = mask * m + last;
      const base = cost[s]!;
      if (!(mask & (1 << last)) || base === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const candidate = base + primary[last + 1]![next + 1]! + dwellPrimary[next]!;
        const t = (mask | (1 << next)) * m + next;
        if (candidate < cost[t]!) {
          cost[t] = candidate;
          other[t] = other[s]! + secondary[last + 1]![next + 1]! + dwellSecondary[next]!;
          prev[t] = last;
        }
      }
    }
  }
  return { cost, other, prev };
}

function unwind(m: number, dp: DpResult, mask: number, last: number): number[] {
  const order: number[] = [];
  let currentMask = mask;
  let current = last;
  while (current !== -1) {
    order.push(current);
    const previous = dp.prev[currentMask * m + current]!;
    currentMask &= ~(1 << current);
    current = previous;
  }
  return order.reverse();
}

/**
 * Choose which stops to visit and in what order.
 *
 * @param energy leg energy matrix (J), node 0 = habitat
 * @param seconds leg time matrix (s), same indexing
 * @returns the best feasible tour; or, when the required stops cannot all be
 *   reached within budget, the cheapest tour through them with `feasible: false`
 */
export function solveTour(
  energy: number[][],
  seconds: number[][],
  stops: ReadonlyArray<Pick<Stop, 'value' | 'required'>>,
  dwellEnergy: number[],
  dwellSeconds: number[],
  energyBudget: number,
  timeBudget: number,
): Tour {
  const m = stops.length;
  const empty: Tour = { order: [], energy: 0, seconds: 0, value: 0, feasible: true };
  if (m === 0) return empty;
  if (m > MAX_STOPS) throw new Error(`solveTour supports at most ${MAX_STOPS} stops, got ${m}`);

  const byEnergy = runDp(m, energy, seconds, dwellEnergy, dwellSeconds);
  const byTime = runDp(m, seconds, energy, dwellSeconds, dwellEnergy);
  let requiredMask = 0;
  stops.forEach((s, i) => {
    if (s.required) requiredMask |= 1 << i;
  });

  const closed = (mask: number): Tour | null => {
    let best: Tour | null = null;
    let value = 0;
    for (let i = 0; i < m; i++) if (mask & (1 << i)) value += stops[i]!.value;
    for (let last = 0; last < m; last++) {
      if (!(mask & (1 << last))) continue;
      const s = mask * m + last;
      const options: Array<[number, number, DpResult]> = [
        [
          byEnergy.cost[s]! + energy[last + 1]![0]!,
          byEnergy.other[s]! + seconds[last + 1]![0]!,
          byEnergy,
        ],
        [
          byTime.other[s]! + energy[last + 1]![0]!,
          byTime.cost[s]! + seconds[last + 1]![0]!,
          byTime,
        ],
      ];
      for (const [e, t, dp] of options) {
        if (!Number.isFinite(e) || !Number.isFinite(t)) continue;
        const feasible = e <= energyBudget && t <= timeBudget;
        const better =
          !best || (feasible && !best.feasible) || (feasible === best.feasible && e < best.energy);
        if (better)
          best = { order: unwind(m, dp, mask, last), energy: e, seconds: t, value, feasible };
      }
    }
    return best;
  };

  let best: Tour | null = null;
  for (let mask = 0; mask < 1 << m; mask++) {
    if ((mask & requiredMask) !== requiredMask) continue;
    if (mask === 0) {
      best = empty;
      continue;
    }
    const tour = closed(mask);
    if (!tour?.feasible) continue;
    if (
      !best ||
      tour.value > best.value ||
      (tour.value === best.value && tour.energy < best.energy)
    ) {
      best = tour;
    }
  }
  if (best) return best;
  // The required stops do not fit. Return the cheapest attempt so the caller can show the overshoot.
  return closed(requiredMask) ?? { ...empty, feasible: false };
}

/** Reuses cost fields between re-plans while the terrain and suit are unchanged. */
export type FieldCache = Map<string, CostField>;

const describeProblem = (tour: Tour, energyBudget: number, timeBudget: number): string => {
  if (!Number.isFinite(tour.energy))
    return 'A required stop cannot be reached within the slope limit.';
  const parts: string[] = [];
  if (tour.energy > energyBudget) {
    const over = o2KgFromJoules(tour.energy - energyBudget);
    parts.push(`needs ${over.toFixed(2)} kg more oxygen than the usable supply`);
  }
  if (tour.seconds > timeBudget) {
    parts.push(`runs ${Math.ceil((tour.seconds - timeBudget) / 60)} min past the time limit`);
  }
  return parts.length
    ? `The required stops cannot all be visited: the shortest loop ${parts.join(' and ')}.`
    : 'No selected stop fits inside the oxygen and time budgets.';
};

export function planSortie(
  grid: TerrainGrid,
  slopeDeg: Float32Array,
  request: PlanRequest,
  cache: FieldCache = new Map(),
): Plan {
  const { profile, habitat, timeBudgetS } = request;
  const usableJ = usableEnergyJ(profile);
  const excluded: Excluded[] = [];
  const emptyPlan = (problem: string | null, feasible: boolean): Plan => ({
    feasible,
    problem,
    visits: [],
    legs: [],
    excluded,
    profile: [],
    totals: {
      distanceM: 0,
      walkS: 0,
      dwellS: 0,
      totalS: 0,
      o2Kg: 0,
      ascentM: 0,
      scienceValue: 0,
      maxSlopeDeg: 0,
    },
    budget: {
      usableO2Kg: o2KgFromJoules(usableJ),
      timeBudgetS,
      o2MarginKg: o2KgFromJoules(usableJ),
      timeMarginS: timeBudgetS,
    },
    walkback: { minMarginKg: o2KgFromJoules(usableJ), at: null },
  });

  const habitatCell = cellIndex(grid, habitat);
  if (habitatCell < 0 || Number.isNaN(grid.elevation[habitatCell]!)) {
    return emptyPlan('The habitat is outside the loaded terrain.', false);
  }
  const field = (cell: number, direction: 'from' | 'to'): CostField => {
    const key = `${cell}:${direction}`;
    let f = cache.get(key);
    if (!f) {
      f = computeCostField(grid, slopeDeg, profile, cell, direction);
      cache.set(key, f);
    }
    return f;
  };
  const outbound = field(habitatCell, 'from');
  const homeward = field(habitatCell, 'to');

  // Keep stops that sit on the terrain and can be reached and returned from.
  const candidates: Array<{ stop: Stop; cell: number }> = [];
  for (const stop of request.stops) {
    const cell = cellIndex(grid, stop.position);
    if (cell < 0 || Number.isNaN(grid.elevation[cell]!))
      excluded.push({ stop, reason: 'outside-terrain' });
    else if (!Number.isFinite(outbound.energy[cell]!) || !Number.isFinite(homeward.energy[cell]!)) {
      excluded.push({ stop, reason: 'unreachable' });
    } else candidates.push({ stop, cell });
  }
  const blocked = excluded.find((e) => e.stop.required);
  // Too many candidates for the exact solver: keep required stops, then the most valuable.
  candidates.sort(
    (a, b) => Number(b.stop.required) - Number(a.stop.required) || b.stop.value - a.stop.value,
  );
  for (const dropped of candidates.splice(MAX_STOPS))
    excluded.push({ stop: dropped.stop, reason: 'over-limit' });

  const m = candidates.length;
  const cells = [habitatCell, ...candidates.map((c) => c.cell)];
  const fields = [outbound, ...candidates.map((c) => field(c.cell, 'from'))];
  const energy = cells.map((_, i) => cells.map((cell) => fields[i]!.energy[cell]!));
  const seconds = cells.map((_, i) => cells.map((cell) => fields[i]!.seconds[cell]!));
  const dwellS = candidates.map((c) => c.stop.dwellMinutes * 60);
  const dwellJ = dwellS.map((s) => s * profile.workMetabolicW);

  const tour = solveTour(
    energy,
    seconds,
    candidates.map((c) => c.stop),
    dwellJ,
    dwellS,
    usableJ,
    timeBudgetS,
  );
  const visited = new Set(tour.order);
  candidates.forEach((c, i) => {
    if (!visited.has(i)) excluded.push({ stop: c.stop, reason: 'budget' });
  });
  if (tour.order.length === 0) {
    const problem = blocked
      ? `Required stop "${blocked.stop.name}" is ${blocked.reason === 'unreachable' ? 'cut off by slopes over the suit limit' : 'outside the loaded terrain'}.`
      : m > 0
        ? describeProblem(tour, usableJ, timeBudgetS)
        : null;
    return emptyPlan(problem, !blocked && tour.feasible && m === 0);
  }

  // Walk the chosen loop and collect geometry, statistics and walk-back margins.
  const nodes = [0, ...tour.order.map((i) => i + 1), 0];
  const names = ['Habitat', ...candidates.map((c) => c.stop.name)];
  const legs: Leg[] = [];
  const visits: Visit[] = [];
  const profilePoints: ProfilePoint[] = [];
  let clockS = 0;
  let usedJ = 0;
  let walkedM = 0;
  let ascentTotal = 0;
  let steepest = 0;
  let minMarginJ = usableJ;
  let minMarginAt: LatLon | null = null;

  for (let k = 0; k < nodes.length - 1; k++) {
    const a = nodes[k]!;
    const b = nodes[k + 1]!;
    const legField = fields[a]!;
    const pathCells = tracePath(legField, cells[b]!);
    const path = pathCells.map((c) => cellCenter(grid, c));
    let distanceM = 0;
    let ascentM = 0;
    let descentM = 0;
    let maxSlopeDeg = 0;
    for (let i = 0; i < pathCells.length; i++) {
      const cell = pathCells[i]!;
      if (i > 0) {
        const prevCell = pathCells[i - 1]!;
        const stepX = ((cell % grid.width) - (prevCell % grid.width)) * grid.cellSizeX;
        const stepY =
          (Math.floor(cell / grid.width) - Math.floor(prevCell / grid.width)) * grid.cellSizeY;
        const horizontal = Math.hypot(stepX, stepY);
        const rise = grid.elevation[cell]! - grid.elevation[prevCell]!;
        distanceM += horizontal;
        if (rise > 0) ascentM += rise;
        else descentM -= rise;
        maxSlopeDeg = Math.max(
          maxSlopeDeg,
          (Math.atan(Math.abs(rise) / horizontal) * 180) / Math.PI,
        );
      }
      profilePoints.push({ distanceM: walkedM + distanceM, elevationM: grid.elevation[cell]! });
      const marginJ = usableJ - (usedJ + legField.energy[cell]!) - homeward.energy[cell]!;
      if (marginJ < minMarginJ) {
        minMarginJ = marginJ;
        minMarginAt = cellCenter(grid, cell);
      }
    }
    legs.push({
      fromName: names[a]!,
      toName: names[b]!,
      path,
      distanceM,
      seconds: seconds[a]![b]!,
      joules: energy[a]![b]!,
      ascentM,
      descentM,
      maxSlopeDeg,
    });
    walkedM += distanceM;
    ascentTotal += ascentM;
    steepest = Math.max(steepest, maxSlopeDeg);
    clockS += seconds[a]![b]!;
    usedJ += energy[a]![b]!;

    if (b !== 0) {
      const stopIndex = b - 1;
      const arrivalS = clockS;
      clockS += dwellS[stopIndex]!;
      usedJ += dwellJ[stopIndex]!;
      const walkbackJ = homeward.energy[cells[b]!]!;
      const marginJ = usableJ - usedJ - walkbackJ;
      if (marginJ < minMarginJ) {
        minMarginJ = marginJ;
        minMarginAt = candidates[stopIndex]!.stop.position;
      }
      visits.push({
        stop: candidates[stopIndex]!.stop,
        arrivalS,
        departureS: clockS,
        o2UsedKg: o2KgFromJoules(usedJ),
        walkbackKg: o2KgFromJoules(walkbackJ),
        walkbackMarginKg: o2KgFromJoules(marginJ),
      });
    }
  }

  const totalDwellS = visits.reduce((sum, v) => sum + (v.departureS - v.arrivalS), 0);
  const feasible = tour.feasible && !blocked;
  return {
    feasible,
    problem: feasible
      ? null
      : blocked
        ? `Required stop "${blocked.stop.name}" is ${blocked.reason === 'unreachable' ? 'cut off by slopes over the suit limit' : 'outside the loaded terrain'}.`
        : describeProblem(tour, usableJ, timeBudgetS),
    visits,
    legs,
    excluded,
    profile: decimate(profilePoints, 600),
    totals: {
      distanceM: walkedM,
      walkS: clockS - totalDwellS,
      dwellS: totalDwellS,
      totalS: clockS,
      o2Kg: o2KgFromJoules(usedJ),
      ascentM: ascentTotal,
      scienceValue: tour.value,
      maxSlopeDeg: steepest,
    },
    budget: {
      usableO2Kg: o2KgFromJoules(usableJ),
      timeBudgetS,
      o2MarginKg: o2KgFromJoules(usableJ - usedJ),
      timeMarginS: timeBudgetS - clockS,
    },
    walkback: { minMarginKg: o2KgFromJoules(minMarginJ), at: minMarginAt },
  };
}

function decimate<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * step)]!);
}

/**
 * Safe-return envelope: for every cell, the share of the usable oxygen that a
 * round trip from the habitat (out and straight back, no work) would consume.
 * Values above 1 cannot be reached and returned from; NaN is unreachable.
 */
export function returnEnvelope(
  grid: TerrainGrid,
  slopeDeg: Float32Array,
  habitat: LatLon,
  profile: SuitProfile,
  cache: FieldCache = new Map(),
): Float32Array {
  const out = new Float32Array(grid.width * grid.height).fill(Number.NaN);
  const cell = cellIndex(grid, habitat);
  if (cell < 0) return out;
  const get = (direction: 'from' | 'to'): CostField => {
    const key = `${cell}:${direction}`;
    let f = cache.get(key);
    if (!f) {
      f = computeCostField(grid, slopeDeg, profile, cell, direction);
      cache.set(key, f);
    }
    return f;
  };
  const outbound = get('from');
  const homeward = get('to');
  const usableJ = usableEnergyJ(profile);
  for (let i = 0; i < out.length; i++) {
    const total = outbound.energy[i]! + homeward.energy[i]!;
    if (Number.isFinite(total)) out[i] = total / usableJ;
  }
  return out;
}
