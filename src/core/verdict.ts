/**
 * GO / CAUTION / NO-GO assessment of a planned sortie.
 *
 * Each rule produces a finding with a severity; the verdict is the worst
 * severity present. Rules are deliberately few and explainable: every finding
 * names the number that triggered it.
 */
import type { SuitProfile } from './cost';
import type { Plan } from './planner';

export type Severity = 'info' | 'caution' | 'no-go';
export type Verdict = 'GO' | 'CAUTION' | 'NO-GO';

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

export interface Conditions {
  /** Departure and sunset, Local Mean Solar Time, hours. */
  departureLmst: number;
  sunsetLmst: number;
  /** Planned return must be this long before sunset, minutes. */
  sunsetMarginMin: number;
  /** Mars hours from departure to planned return. */
  returnLmst: number;
  dustStormSeason: boolean;
  /** Atmospheric opacity reported by REMS, if any. */
  opacity: string | null;
  uvIndex: string | null;
  /** Age of the newest REMS report, Earth days. */
  weatherAgeDays: number | null;
}

export interface Assessment {
  verdict: Verdict;
  findings: Finding[];
}

/** Share of the usable oxygen below which the margin is flagged. */
export const LOW_MARGIN_FRACTION = 0.15;

export function assess(plan: Plan, profile: SuitProfile, conditions: Conditions): Assessment {
  const findings: Finding[] = [];
  const add = (severity: Severity, code: string, message: string): void => {
    findings.push({ severity, code, message });
  };

  if (!plan.feasible && plan.problem) add('no-go', 'INFEASIBLE', plan.problem);

  if (plan.visits.length > 0) {
    const { budget, totals, walkback } = plan;
    if (walkback.minMarginKg < 0) {
      add(
        'no-go',
        'WALKBACK',
        `At the tightest point an immediate walk home would overdraw the usable oxygen by ${(-walkback.minMarginKg).toFixed(2)} kg.`,
      );
    } else if (budget.o2MarginKg < LOW_MARGIN_FRACTION * budget.usableO2Kg) {
      add(
        'caution',
        'LOW_O2_MARGIN',
        `Only ${budget.o2MarginKg.toFixed(2)} kg of usable oxygen is left on return (under ${Math.round(LOW_MARGIN_FRACTION * 100)}% of ${budget.usableO2Kg.toFixed(2)} kg).`,
      );
    }

    const latestReturn = conditions.sunsetLmst - conditions.sunsetMarginMin / 60;
    if (conditions.returnLmst > latestReturn) {
      const lateMin = Math.round((conditions.returnLmst - latestReturn) * 60);
      add(
        'no-go',
        'DAYLIGHT',
        `Planned return is ${lateMin} Mars-minutes past the latest safe return (${conditions.sunsetMarginMin} min before sunset).`,
      );
    }

    if (totals.maxSlopeDeg >= profile.cautionSlopeDeg) {
      add(
        'caution',
        'STEEP',
        `The route includes steps of up to ${totals.maxSlopeDeg.toFixed(0)} deg (caution threshold ${profile.cautionSlopeDeg} deg, limit ${profile.maxSlopeDeg} deg).`,
      );
    }
    if (totals.totalS > profile.maxEvaHours * 3600 * 0.9) {
      add(
        'caution',
        'LONG_EVA',
        `The EVA lasts ${(totals.totalS / 3600).toFixed(1)} h, within 10% of the ${profile.maxEvaHours} h suit limit.`,
      );
    }
  }

  if (conditions.opacity && !/sunny|clear/i.test(conditions.opacity)) {
    add(
      'caution',
      'OPACITY',
      `REMS reports atmospheric opacity "${conditions.opacity}": expect reduced visibility and solar power.`,
    );
  }
  if (conditions.uvIndex && /very[_ ]?high/i.test(conditions.uvIndex)) {
    add('caution', 'UV', 'REMS reports a very high UV irradiance index at the surface.');
  }
  if (conditions.dustStormSeason) {
    add(
      'info',
      'DUST_SEASON',
      'Mars is in its dust-storm season (Ls 180-360). Check for regional storms before egress.',
    );
  }
  if (conditions.weatherAgeDays !== null && conditions.weatherAgeDays > 14) {
    add(
      'info',
      'STALE_WEATHER',
      `The newest REMS report is ${Math.round(conditions.weatherAgeDays)} days old; seasonal statistics are shown alongside it.`,
    );
  }

  const verdict: Verdict = findings.some((f) => f.severity === 'no-go')
    ? 'NO-GO'
    : findings.some((f) => f.severity === 'caution')
      ? 'CAUTION'
      : 'GO';
  return { verdict, findings };
}
