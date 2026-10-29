/**
 * Locomotion and life-support cost model for a suited astronaut on Mars.
 *
 * Every number here is an explicit, user-adjustable engineering assumption,
 * documented with its rationale in docs/MODEL.md. None of it is a NASA
 * requirement. The planner minimises metabolic energy, because breathing
 * oxygen is the consumable that ends an EVA.
 */
import { MARS_GRAVITY } from './geo';

export interface SuitProfile {
  name: string;
  /** Walking speed on level ground, m/s. */
  flatSpeedMps: number;
  /** Terrain steeper than this is impassable, degrees. */
  maxSlopeDeg: number;
  /** Terrain steeper than this is flagged as a caution, degrees. */
  cautionSlopeDeg: number;
  /** Astronaut plus suit and tools, kg. */
  suitedMassKg: number;
  /** Metabolic rate while walking on level ground, W. */
  walkMetabolicW: number;
  /** Metabolic rate while working at a science stop, W. */
  workMetabolicW: number;
  /** Fraction of metabolic energy that becomes climbing work. */
  climbEfficiency: number;
  /** Primary oxygen supply, kg. */
  o2PrimaryKg: number;
  /** Share of the primary supply held back and never planned against. */
  o2ReserveFraction: number;
  /** Longest EVA the life-support system is rated for, hours. */
  maxEvaHours: number;
}

export const DEFAULT_SUIT: SuitProfile = {
  name: 'Reference surface suit',
  flatSpeedMps: 0.9,
  maxSlopeDeg: 20,
  cautionSlopeDeg: 15,
  suitedMassKg: 180,
  walkMetabolicW: 300,
  workMetabolicW: 250,
  climbEfficiency: 0.25,
  o2PrimaryKg: 0.55,
  o2ReserveFraction: 0.2,
  maxEvaHours: 8,
};

/** Energy released per kilogram of oxygen consumed: 20.1 kJ per litre at 1.429 g/L. */
export const JOULES_PER_KG_O2 = 20_100 / 1.429e-3;

export function o2KgFromJoules(joules: number): number {
  return joules / JOULES_PER_KG_O2;
}

/** Oxygen available for planning after the reserve is set aside, as energy in joules. */
export function usableEnergyJ(profile: SuitProfile): number {
  return profile.o2PrimaryKg * (1 - profile.o2ReserveFraction) * JOULES_PER_KG_O2;
}

/**
 * Walking speed on a grade, m/s. The shape is Tobler's hiking function
 * (fastest on a gentle descent, falling off exponentially either side),
 * scaled so that level ground gives `flatSpeedMps`.
 */
export function speedOnGrade(profile: SuitProfile, grade: number): number {
  return profile.flatSpeedMps * Math.exp(-3.5 * Math.abs(grade + 0.05) + 3.5 * 0.05);
}

export interface StepCost {
  seconds: number;
  joules: number;
}

/**
 * Cost of walking one grid step.
 *
 * @param horizontalM horizontal length of the step
 * @param riseM elevation gain (negative when descending)
 * @returns null when the step is steeper than the suit allows
 */
export function stepCost(
  profile: SuitProfile,
  horizontalM: number,
  riseM: number,
): StepCost | null {
  const grade = riseM / horizontalM;
  const slopeDeg = (Math.atan(Math.abs(grade)) * 180) / Math.PI;
  if (!(slopeDeg <= profile.maxSlopeDeg)) return null; // also rejects NaN
  const seconds = horizontalM / speedOnGrade(profile, grade);
  // Level-walking metabolic cost plus the work of lifting the suited mass
  // against Mars gravity. Descending earns no credit.
  const climbJ =
    riseM > 0 ? (profile.suitedMassKg * MARS_GRAVITY * riseM) / profile.climbEfficiency : 0;
  return { seconds, joules: profile.walkMetabolicW * seconds + climbJ };
}
