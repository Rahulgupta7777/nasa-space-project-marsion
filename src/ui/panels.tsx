import type { SuitProfile } from '../core/cost';
import type { MarsClock } from '../core/marsTime';
import {
  EARTH_HOURS_PER_MARS_HOUR,
  formatClock,
  isDustStormSeason,
  seasonName,
} from '../core/marsTime';
import type { ExclusionReason, Plan } from '../core/planner';
import { MAX_STOPS } from '../core/planner';
import type { Assessment } from '../core/verdict';
import type { Climatology, RemsSol } from '../core/weather';
import { evaDoseMsv } from '../core/weather';
import { ENDPOINTS } from '../data/endpoints';
import { DERIVED_LAYERS, TILE_LAYERS, trekCapabilitiesUrl } from '../data/layers';
import type { Manifest } from '../data/snapshot';
import type { LayerState, StopConfig, StopMode } from '../state';
import { degC, hm, kg, km } from './format';

const REASONS: Record<ExclusionReason, string> = {
  budget: 'does not fit the budget',
  unreachable: 'cut off by steep ground',
  'outside-terrain': 'outside loaded terrain',
  'over-limit': `over the ${MAX_STOPS}-stop limit`,
};

/* ------------------------------------------------------------------ Plan */

interface PlanPanelProps {
  plan: Plan | null;
  planning: boolean;
  assessment: Assessment | null;
  stops: StopConfig[];
  suit: SuitProfile;
  departureLmst: number;
  returnLmst: number | null;
  clock: MarsClock;
  onStop: (id: string, patch: Partial<StopConfig>) => void;
  onRemoveStop: (id: string) => void;
  onSuit: (patch: Partial<SuitProfile>) => void;
  onDeparture: (lmst: number) => void;
  onBriefing: () => void;
  onExport: () => void;
}

export function PlanPanel(p: PlanPanelProps): JSX.Element {
  const { plan, assessment } = p;
  const order = new Map((plan?.visits ?? []).map((v, i) => [v.stop.id, i + 1]));
  const excluded = new Map((plan?.excluded ?? []).map((e) => [e.stop.id, e.reason]));
  const used = plan ? Math.min(1, plan.totals.o2Kg / plan.budget.usableO2Kg) : 0;

  return (
    <div className="panel">
      <section
        className={`verdict-card verdict-${assessment?.verdict ?? 'PENDING'}`}
        aria-live="polite"
      >
        <div className="verdict-head">
          <span className="verdict">
            {p.planning && !plan ? '…' : (assessment?.verdict ?? '…')}
          </span>
          <p>
            {!plan
              ? 'Working out the route…'
              : plan.visits.length === 0
                ? (plan.problem ?? 'Choose at least one stop to plan a sortie.')
                : assessment?.verdict === 'GO'
                  ? 'Every budget closes with margin. You can always walk home.'
                  : assessment?.verdict === 'CAUTION'
                    ? 'The sortie closes, with points to brief before egress.'
                    : 'Do not egress on this plan.'}
          </p>
        </div>
        {assessment && assessment.findings.length > 0 && (
          <ul className="findings">
            {assessment.findings.map((f) => (
              <li key={f.code} className={`finding finding-${f.severity}`}>
                {f.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {plan && plan.visits.length > 0 && (
        <section>
          <dl className="stats">
            <div>
              <dt>Loop</dt>
              <dd>{km(plan.totals.distanceM)}</dd>
            </div>
            <div>
              <dt>EVA time</dt>
              <dd>{hm(plan.totals.totalS)}</dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>{plan.totals.ascentM.toFixed(0)} m</dd>
            </div>
            <div>
              <dt>Science</dt>
              <dd>
                {plan.totals.scienceValue} pts · {plan.visits.length} stops
              </dd>
            </div>
            <div>
              <dt>Back by</dt>
              <dd>{p.returnLmst === null ? '--:--' : formatClock(p.returnLmst)} LMST</dd>
            </div>
            <div>
              <dt>Walk-back margin</dt>
              <dd>{kg(plan.walkback.minMarginKg)}</dd>
            </div>
          </dl>
          <div
            className="meter"
            role="img"
            aria-label={`Oxygen: ${kg(plan.totals.o2Kg)} of ${kg(plan.budget.usableO2Kg)} usable`}
          >
            <span
              style={{ width: `${used * 100}%` }}
              className={
                plan.totals.o2Kg > plan.budget.usableO2Kg
                  ? 'meter-over'
                  : used > 0.85
                    ? 'meter-high'
                    : ''
              }
            />
          </div>
          <p className="fine">
            Oxygen {kg(plan.totals.o2Kg)} of {kg(plan.budget.usableO2Kg)} usable ·{' '}
            {kg(p.suit.o2PrimaryKg * p.suit.o2ReserveFraction)} reserve untouched
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={p.onBriefing}>
              Sortie briefing
            </button>
            <button type="button" onClick={p.onExport}>
              Export GeoJSON
            </button>
          </div>
        </section>
      )}

      <section>
        <h3>Science stops</h3>
        <p className="fine">
          Mark what you must see. RELIC orders the stops and spends the remaining oxygen on the
          highest-priority optional ones. Click the map to add your own.
        </p>
        <ul className="stops">
          {p.stops.map((s) => (
            <li key={s.id} className={order.has(s.id) ? 'stop visited' : 'stop'}>
              <div className="stop-head">
                <span className="stop-order">{order.get(s.id) ?? '·'}</span>
                <span className="stop-name">{s.name}</span>
                {s.custom && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => p.onRemoveStop(s.id)}
                    aria-label={`Remove ${s.name}`}
                  >
                    remove
                  </button>
                )}
              </div>
              <div className="stop-controls">
                <div className="segmented" role="group" aria-label={`Plan for ${s.name}`}>
                  {(['required', 'optional', 'skip'] as StopMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={s.mode === mode}
                      onClick={() => p.onStop(s.id, { mode })}
                    >
                      {mode === 'required' ? 'Must' : mode === 'optional' ? 'If able' : 'Skip'}
                    </button>
                  ))}
                </div>
                <label>
                  Priority
                  <select
                    value={s.value}
                    onChange={(e) => p.onStop(s.id, { value: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Work
                  <select
                    value={s.dwellMinutes}
                    onChange={(e) => p.onStop(s.id, { dwellMinutes: Number(e.target.value) })}
                  >
                    {[10, 20, 30, 45, 60, 90].map((v) => (
                      <option key={v} value={v}>
                        {v} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {s.mode !== 'skip' && excluded.has(s.id) && (
                <p className="stop-note">Left out: {REASONS[excluded.get(s.id)!]}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Egress and suit</h3>
        <div className="form">
          <label>
            Egress time (LMST)
            <select value={p.departureLmst} onChange={(e) => p.onDeparture(Number(e.target.value))}>
              {[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((h) => (
                <option key={h} value={h}>
                  {formatClock(h)}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="Primary oxygen"
            unit="kg"
            min={0.2}
            max={1.2}
            step={0.05}
            value={p.suit.o2PrimaryKg}
            onChange={(v) => p.onSuit({ o2PrimaryKg: v })}
          />
          <Slider
            label="Reserve held back"
            unit="%"
            min={0}
            max={40}
            step={5}
            value={Math.round(p.suit.o2ReserveFraction * 100)}
            onChange={(v) => p.onSuit({ o2ReserveFraction: v / 100 })}
          />
          <Slider
            label="Walking speed on the flat"
            unit="m/s"
            min={0.4}
            max={1.6}
            step={0.1}
            value={p.suit.flatSpeedMps}
            onChange={(v) => p.onSuit({ flatSpeedMps: v })}
          />
          <Slider
            label="Slope limit"
            unit="°"
            min={10}
            max={30}
            step={1}
            value={p.suit.maxSlopeDeg}
            onChange={(v) =>
              p.onSuit({ maxSlopeDeg: v, cautionSlopeDeg: Math.min(p.suit.cautionSlopeDeg, v) })
            }
          />
          <Slider
            label="Longest EVA"
            unit="h"
            min={2}
            max={10}
            step={0.5}
            value={p.suit.maxEvaHours}
            onChange={(v) => p.onSuit({ maxEvaHours: v })}
          />
        </div>
        <p className="fine">
          Sunset today at this site: {formatClock(p.clock.sunsetLmst)} LMST. Return is planned at
          least 60 minutes earlier. Suit numbers are adjustable assumptions; see docs/MODEL.md.
        </p>
      </section>
    </div>
  );
}

function Slider(p: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <label className="slider">
      <span>
        {p.label}
        <output>
          {Number.isInteger(p.step) ? p.value : p.value.toFixed(2).replace(/0$/, '')} {p.unit}
        </output>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    </label>
  );
}

/* ---------------------------------------------------------------- Layers */

interface LayersPanelProps {
  base: string;
  layers: Record<string, LayerState>;
  onBase: (id: string) => void;
  onLayer: (id: string, patch: Partial<LayerState>) => void;
}

export function LayersPanel(p: LayersPanelProps): JSX.Element {
  const row = (
    id: string,
    title: string,
    mission: string,
    use: string,
    resolution?: string,
  ): JSX.Element => {
    const state = p.layers[id] ?? { on: false, opacity: 1 };
    return (
      <li key={id} className="layer">
        <label className="layer-title">
          <input
            type="checkbox"
            checked={state.on}
            onChange={(e) => p.onLayer(id, { on: e.target.checked })}
          />
          <span>{title}</span>
          {resolution && <em>{resolution}</em>}
        </label>
        <p className="fine">
          {mission}. {use}
        </p>
        {state.on && (
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={state.opacity}
            aria-label={`${title} opacity`}
            onChange={(e) => p.onLayer(id, { opacity: Number(e.target.value) })}
          />
        )}
      </li>
    );
  };
  return (
    <div className="panel">
      <section>
        <h3>Planning layers</h3>
        <ul className="layers">
          {DERIVED_LAYERS.map((d) => row(d.id, d.title, d.mission, d.use))}
        </ul>
      </section>
      <section>
        <h3>Orbital imagery and thermal data</h3>
        <ul className="layers">
          {TILE_LAYERS.filter((d) => d.kind === 'overlay').map((d) =>
            row(d.id, d.title, d.mission, d.use, d.resolution),
          )}
        </ul>
      </section>
      <section>
        <h3>Base map</h3>
        <ul className="layers">
          {TILE_LAYERS.filter((d) => d.kind === 'base').map((d) => (
            <li key={d.id} className="layer">
              <label className="layer-title">
                <input
                  type="radio"
                  name="base"
                  checked={p.base === d.id}
                  onChange={() => p.onBase(d.id)}
                />
                <span>{d.title}</span>
                <em>{d.resolution}</em>
              </label>
              <p className="fine">
                {d.mission}. {d.use}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ Conditions */

interface ConditionsPanelProps {
  clock: MarsClock;
  latitude: number;
  latest: RemsSol | null;
  weatherAgeDays: number | null;
  weatherLive: boolean;
  climate: Climatology | null;
  plan: Plan | null;
}

export function ConditionsPanel(p: ConditionsPanelProps): JSX.Element {
  const { clock, latest, climate } = p;
  const daylight = (clock.sunsetLmst - clock.sunriseLmst + 24) % 24;
  return (
    <div className="panel">
      <section>
        <h3>Now at the habitat</h3>
        <p className="clock">
          {formatClock(clock.lmstHours)} <small>LMST</small>
        </p>
        <dl className="stats">
          <div>
            <dt>True solar time</dt>
            <dd>{formatClock(clock.ltstHours)}</dd>
          </div>
          <div>
            <dt>Sun elevation</dt>
            <dd>{clock.sunElevationDeg.toFixed(0)}°</dd>
          </div>
          <div>
            <dt>Sunrise</dt>
            <dd>{formatClock(clock.sunriseLmst)}</dd>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{formatClock(clock.sunsetLmst)}</dd>
          </div>
          <div>
            <dt>Daylight</dt>
            <dd>{hm(daylight * 3600 * EARTH_HOURS_PER_MARS_HOUR)}</dd>
          </div>
          <div>
            <dt>Season</dt>
            <dd>
              Ls {clock.ls.toFixed(0)}°, {seasonName(clock.ls, p.latitude)}
            </dd>
          </div>
        </dl>
        <p className="fine">
          Computed with the NASA GISS Mars24 algorithm.{' '}
          {isDustStormSeason(clock.ls)
            ? 'Mars is in its dust-storm season (Ls 180 to 360).'
            : 'Outside the main dust-storm season.'}{' '}
          The Sun is {clock.sunDistanceAU.toFixed(2)} AU away.
        </p>
      </section>

      <section>
        <h3>Weather at Gale Crater</h3>
        {latest ? (
          <>
            <p className="fine">
              Newest Curiosity REMS report: sol {latest.sol}, {latest.date}
              {p.weatherAgeDays !== null && ` (${Math.round(p.weatherAgeDays)} days ago)`} ·{' '}
              {p.weatherLive ? 'live from NASA' : 'bundled snapshot'}
            </p>
            <dl className="stats">
              <div>
                <dt>Air, low / high</dt>
                <dd>
                  {degC(latest.minAirC)} / {degC(latest.maxAirC)}
                </dd>
              </div>
              <div>
                <dt>Ground, low / high</dt>
                <dd>
                  {degC(latest.minGroundC)} / {degC(latest.maxGroundC)}
                </dd>
              </div>
              <div>
                <dt>Pressure</dt>
                <dd>{latest.pressurePa ?? 'n/a'} Pa</dd>
              </div>
              <div>
                <dt>Sky</dt>
                <dd>{latest.opacity ?? 'n/a'}</dd>
              </div>
              <div>
                <dt>UV index</dt>
                <dd>{latest.uvIndex?.replace('_', ' ') ?? 'n/a'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="fine">No weather report loaded.</p>
        )}
        {climate && climate.sols > 0 && (
          <>
            <h4>Expected at this time of year</h4>
            <p className="fine">
              From {climate.sols} REMS sols within 5° of today&apos;s solar longitude, across{' '}
              {climate.marsYears} Mars years.
            </p>
            <dl className="stats">
              <div>
                <dt>Air low</dt>
                <dd>
                  {degC(climate.minAirC?.mean)}{' '}
                  <small>
                    ({degC(climate.minAirC?.min)} to {degC(climate.minAirC?.max)})
                  </small>
                </dd>
              </div>
              <div>
                <dt>Air high</dt>
                <dd>
                  {degC(climate.maxAirC?.mean)}{' '}
                  <small>
                    ({degC(climate.maxAirC?.min)} to {degC(climate.maxAirC?.max)})
                  </small>
                </dd>
              </div>
              <div>
                <dt>Ground high</dt>
                <dd>{degC(climate.maxGroundC?.mean)}</dd>
              </div>
              <div>
                <dt>Pressure</dt>
                <dd>{climate.pressurePa ? `${climate.pressurePa.mean.toFixed(0)} Pa` : 'n/a'}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section>
        <h3>Radiation</h3>
        <p className="fine">
          Curiosity RAD measured an average of 0.64 mSv per day from galactic cosmic rays on the
          floor of Gale Crater.
          {p.plan && p.plan.visits.length > 0
            ? ` This sortie adds about ${evaDoseMsv(p.plan.totals.totalS).toFixed(2)} mSv.`
            : ''}{' '}
          Solar particle events are not forecast here: check space weather before egress.
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Data */

interface DataPanelProps {
  manifest: Manifest | null;
  terrainSource: string;
  terrainBusy: boolean;
  terrainError: string | null;
  weatherLive: boolean;
  onLiveTerrain: () => void;
  onSnapshotTerrain: () => void;
}

export function DataPanel(p: DataPanelProps): JSX.Element {
  return (
    <div className="panel">
      <section>
        <h3>Planning terrain</h3>
        <p className="fine">{p.terrainSource || 'Loading…'}</p>
        <div className="row">
          <button type="button" onClick={p.onLiveTerrain} disabled={p.terrainBusy}>
            {p.terrainBusy ? 'Asking NASA Trek…' : 'Load finer terrain for this view'}
          </button>
          <button type="button" onClick={p.onSnapshotTerrain} disabled={p.terrainBusy}>
            Reset
          </button>
        </div>
        {p.terrainError && (
          <p className="error" role="alert">
            {p.terrainError}
          </p>
        )}
        <p className="fine">
          Zoom the map to the ground you care about, then load it: RELIC asks NASA Trek for the
          HiRISE elevation model of exactly that box, down to a few metres per cell, and re-plans on
          it.
        </p>
      </section>
      <section>
        <h3>Sources</h3>
        <p className="fine">
          Everything on screen comes from NASA-hosted services, read directly by your browser.
          Weather:{' '}
          {p.weatherLive ? 'live' : 'bundled snapshot (live refresh pending or unavailable)'}.
        </p>
        <ul className="sources">
          {(p.manifest?.entries ?? []).map((e) => (
            <li key={e.file}>
              <a href={e.url} target="_blank" rel="noreferrer">
                {e.title}
              </a>
              <p className="fine">
                {e.mission} · {e.provider} · snapshot {e.fetchedAt.slice(0, 10)}
                {e.note ? ` · ${e.note}` : ''}
              </p>
            </li>
          ))}
          {TILE_LAYERS.map((d) => (
            <li key={d.id}>
              <a href={trekCapabilitiesUrl(d.trekId)} target="_blank" rel="noreferrer">
                {d.title}
              </a>
              <p className="fine">
                {d.mission} · {d.resolution} · {d.credit} · live WMTS tiles from NASA Solar System
                Treks
              </p>
            </li>
          ))}
          <li>
            <a href={`${ENDPOINTS.molaDem}?f=json`} target="_blank" rel="noreferrer">
              MOLA global elevation
            </a>
            <p className="fine">
              Mars Global Surveyor · used for terrain outside the HiRISE footprint
            </p>
          </li>
          <li>
            <a
              href="https://www.giss.nasa.gov/tools/mars24/help/algorithm.html"
              target="_blank"
              rel="noreferrer"
            >
              Mars24 Sunclock algorithm
            </a>
            <p className="fine">
              NASA Goddard Institute for Space Studies · Mars time, season and Sun position
            </p>
          </li>
        </ul>
      </section>
    </div>
  );
}
