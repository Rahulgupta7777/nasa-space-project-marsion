import type { SuitProfile } from '../core/cost';
import { EARTH_HOURS_PER_MARS_HOUR, formatClock } from '../core/marsTime';
import type { Plan } from '../core/planner';
import type { Assessment } from '../core/verdict';
import { evaDoseMsv } from '../core/weather';
import { hm, kg, km } from './format';

interface Props {
  plan: Plan;
  assessment: Assessment;
  suit: SuitProfile;
  departureLmst: number;
  sunsetLmst: number;
  terrainSource: string;
  onClose: () => void;
}

/** LMST clock after `seconds` of Earth time have passed since departure. */
const lmstAfter = (departure: number, seconds: number): string =>
  formatClock(departure + seconds / 3600 / EARTH_HOURS_PER_MARS_HOUR);

/**
 * One-page sortie briefing, in the spirit of the cuff checklists Apollo crews
 * wore on the lunar surface. Prints cleanly on a single sheet.
 */
export function Briefing({
  plan,
  assessment,
  suit,
  departureLmst,
  sunsetLmst,
  terrainSource,
  onClose,
}: Props): JSX.Element {
  return (
    <div className="briefing-backdrop" role="dialog" aria-modal="true" aria-label="Sortie briefing">
      <article className="briefing">
        <header>
          <div>
            <p className="eyebrow">RELIC sortie briefing · Gale Crater, Mars</p>
            <h2>
              {plan.visits.length} stops · {km(plan.totals.distanceM)} · {hm(plan.totals.totalS)}
            </h2>
          </div>
          <span className={`verdict verdict-${assessment.verdict}`}>{assessment.verdict}</span>
        </header>

        <dl className="briefing-facts">
          <div>
            <dt>Egress</dt>
            <dd>{formatClock(departureLmst)} LMST</dd>
          </div>
          <div>
            <dt>Ingress</dt>
            <dd>{lmstAfter(departureLmst, plan.totals.totalS)} LMST</dd>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{formatClock(sunsetLmst)} LMST</dd>
          </div>
          <div>
            <dt>O₂ planned</dt>
            <dd>
              {kg(plan.totals.o2Kg)} of {kg(plan.budget.usableO2Kg)}
            </dd>
          </div>
          <div>
            <dt>O₂ reserve held</dt>
            <dd>{kg(suit.o2PrimaryKg * suit.o2ReserveFraction)}</dd>
          </div>
          <div>
            <dt>Radiation</dt>
            <dd>{evaDoseMsv(plan.totals.totalS).toFixed(2)} mSv</dd>
          </div>
        </dl>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Leg</th>
              <th>Walk</th>
              <th>Climb</th>
              <th>Arrive</th>
              <th>Work</th>
              <th>O₂ used, kg</th>
              <th>Abort margin, kg</th>
            </tr>
          </thead>
          <tbody>
            {plan.legs.map((leg, i) => {
              const visit = plan.visits[i];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {leg.fromName} → {leg.toName}
                  </td>
                  <td>
                    {km(leg.distanceM)} · {hm(leg.seconds)}
                  </td>
                  <td>
                    +{Math.round(leg.ascentM)} / −{Math.round(leg.descentM)} m
                  </td>
                  <td>{lmstAfter(departureLmst, visit ? visit.arrivalS : plan.totals.totalS)}</td>
                  <td>{visit ? `${visit.stop.dwellMinutes} min` : 'ingress'}</td>
                  <td>{(visit ? visit.o2UsedKg : plan.totals.o2Kg).toFixed(2)}</td>
                  <td>{visit ? visit.walkbackMarginKg.toFixed(2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="fine">
          Abort margin: usable oxygen left if you stop work and walk straight home from that stop.
          Tightest point on the route: {kg(plan.walkback.minMarginKg)}.
        </p>

        {assessment.findings.length > 0 && (
          <ul className="findings">
            {assessment.findings.map((f) => (
              <li key={f.code} className={`finding finding-${f.severity}`}>
                {f.message}
              </li>
            ))}
          </ul>
        )}

        <p className="fine">
          Terrain: {terrainSource}. Suit model: {suit.flatSpeedMps.toFixed(1)} m/s on the flat,
          slope limit {suit.maxSlopeDeg}°, {suit.suitedMassKg} kg suited mass. A planning aid built
          on NASA open data; the cost model is an engineering assumption, not a NASA requirement.
        </p>
        <footer className="no-print">
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </article>
    </div>
  );
}
