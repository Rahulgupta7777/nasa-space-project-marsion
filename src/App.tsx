import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SuitProfile } from './core/cost';
import { DEFAULT_SUIT } from './core/cost';
import type { Bounds, LatLon } from './core/geo';
import { contains } from './core/geo';
import { EARTH_HOURS_PER_MARS_HOUR, isDustStormSeason, marsClock } from './core/marsTime';
import type { Plan } from './core/planner';
import type { TerrainGrid } from './core/terrain';
import { computeSlopeDeg } from './core/terrain';
import { assess } from './core/verdict';
import type { RemsSol } from './core/weather';
import { climatology, latestReport } from './core/weather';
import type { ExplorationRoi, Manifest, Traverse } from './data/snapshot';
import {
  fetchLiveTerrain,
  fetchLiveWeather,
  loadManifest,
  loadRois,
  loadSites,
  loadSnapshotTerrain,
  loadSnapshotWeather,
  loadTraverse,
} from './data/snapshot';
import type { LayerState, StopConfig, StopMode } from './state';
import { DEFAULT_BASE, DEFAULT_HABITAT, defaultLayers, stopsFromSites } from './state';
import { Briefing } from './ui/Briefing';
import { MapView } from './ui/MapView';
import { ConditionsPanel, DataPanel, LayersPanel, PlanPanel } from './ui/panels';
import { ProfileChart } from './ui/ProfileChart';
import type { PlanResult } from './worker/client';
import { PlannerClient } from './worker/client';

type Tab = 'plan' | 'layers' | 'conditions' | 'data';
const TABS: Array<[Tab, string]> = [
  ['plan', 'Plan'],
  ['layers', 'Layers'],
  ['conditions', 'Conditions'],
  ['data', 'Data'],
];
const SUNSET_MARGIN_MIN = 60;

function routeGeoJson(plan: Plan, habitat: LatLon): string {
  const features = [
    {
      type: 'Feature',
      properties: { kind: 'habitat' },
      geometry: { type: 'Point', coordinates: [habitat.lon, habitat.lat] },
    },
    ...plan.legs.map((leg, i) => ({
      type: 'Feature',
      properties: {
        kind: 'leg',
        order: i + 1,
        from: leg.fromName,
        to: leg.toName,
        distance_m: Math.round(leg.distanceM),
        walk_s: Math.round(leg.seconds),
        ascent_m: Math.round(leg.ascentM),
      },
      geometry: { type: 'LineString', coordinates: leg.path.map((p) => [p.lon, p.lat]) },
    })),
    ...plan.visits.map((v, i) => ({
      type: 'Feature',
      properties: {
        kind: 'stop',
        order: i + 1,
        name: v.stop.name,
        work_min: v.stop.dwellMinutes,
        o2_used_kg: Number(v.o2UsedKg.toFixed(3)),
        walkback_margin_kg: Number(v.walkbackMarginKg.toFixed(3)),
      },
      geometry: { type: 'Point', coordinates: [v.stop.position.lon, v.stop.position.lat] },
    })),
  ];
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: 'RELIC sortie, Gale Crater (IAU2000:104905, east-positive)',
      features,
    },
    null,
    1,
  );
}

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('plan');
  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  const [terrainBusy, setTerrainBusy] = useState(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const [habitat, setHabitat] = useState<LatLon>(DEFAULT_HABITAT);
  const [stops, setStops] = useState<StopConfig[]>([]);
  const [suit, setSuit] = useState<SuitProfile>(DEFAULT_SUIT);
  const [departureLmst, setDepartureLmst] = useState(9);
  const [base, setBase] = useState(DEFAULT_BASE);
  const [layers, setLayers] = useState<Record<string, LayerState>>(defaultLayers);
  const [traverse, setTraverse] = useState<Traverse | null>(null);
  const [rois, setRois] = useState<ExplorationRoi[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [weather, setWeather] = useState<{ sols: RemsSol[]; live: boolean } | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const viewBounds = useRef<Bounds | null>(null);
  const planner = useRef<PlannerClient | null>(null);
  const customCount = useRef(0);

  // Bundled snapshot first, so the app is usable offline; live data replaces it when it arrives.
  useEffect(() => {
    planner.current = new PlannerClient();
    loadSnapshotTerrain()
      .then(setTerrain)
      .catch((e: Error) => setFatal(`Could not load the terrain snapshot: ${e.message}`));
    loadSites()
      .then((sites) => setStops(stopsFromSites(sites, DEFAULT_HABITAT)))
      .catch(() => setStops([]));
    loadTraverse()
      .then(setTraverse)
      .catch(() => undefined);
    loadRois()
      .then(setRois)
      .catch(() => undefined);
    loadManifest()
      .then(setManifest)
      .catch(() => undefined);
    loadSnapshotWeather()
      .then((sols) => setWeather((current) => current ?? { sols, live: false }))
      .catch(() => undefined);
    fetchLiveWeather()
      .then((sols) => setWeather({ sols, live: true }))
      .catch((e: Error) =>
        console.warn('Live REMS weather unavailable, using the snapshot:', e.message),
      );
    const tick = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearInterval(tick);
      planner.current?.dispose();
      planner.current = null;
    };
  }, []);

  const slope = useMemo(() => (terrain ? computeSlopeDeg(terrain) : null), [terrain]);
  useEffect(() => {
    if (terrain) planner.current?.setTerrain(terrain);
  }, [terrain]);

  const clock = useMemo(() => marsClock(now, habitat), [now, habitat]);
  // Sunrise and sunset drift by seconds per sol; round so the plan does not re-run every clock tick.
  const sunsetLmst = Math.round(clock.sunsetLmst * 60) / 60;
  const timeBudgetS = useMemo(() => {
    const suitLimit = suit.maxEvaHours * 3600;
    if (Number.isNaN(sunsetLmst)) return suitLimit;
    const daylightMarsHours = Math.max(0, sunsetLmst - SUNSET_MARGIN_MIN / 60 - departureLmst);
    return Math.min(suitLimit, daylightMarsHours * 3600 * EARTH_HOURS_PER_MARS_HOUR);
  }, [suit.maxEvaHours, sunsetLmst, departureLmst]);

  // Re-plan whenever an input changes. The worker caches cost fields, so most edits are quick.
  useEffect(() => {
    if (!terrain || !planner.current) return;
    setPlanning(true);
    const handle = window.setTimeout(() => {
      planner.current
        ?.plan({
          habitat,
          profile: suit,
          timeBudgetS,
          stops: stops
            .filter((s) => s.mode !== 'skip')
            .map((s) => ({
              id: s.id,
              name: s.name,
              position: s.position,
              value: s.value,
              dwellMinutes: s.dwellMinutes,
              required: s.mode === 'required',
            })),
        })
        .then((r) => {
          if (!r) return; // superseded by a newer request
          setResult(r);
          setPlanning(false);
        })
        .catch((e: Error) => {
          setPlanning(false);
          setTerrainError(`Planner error: ${e.message}`);
        });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [terrain, habitat, stops, suit, timeBudgetS]);

  const plan = result?.plan ?? null;
  const latest = useMemo(() => (weather ? latestReport(weather.sols) : null), [weather]);
  const weatherAgeDays = latest?.date
    ? (now.getTime() - Date.parse(latest.date)) / 86_400_000
    : null;
  const lsBucket = Math.round(clock.ls);
  const climate = useMemo(
    () => (weather ? climatology(weather.sols, lsBucket) : null),
    [weather, lsBucket],
  );
  const returnLmst =
    plan && plan.visits.length
      ? departureLmst + plan.totals.totalS / 3600 / EARTH_HOURS_PER_MARS_HOUR
      : null;
  const assessment = useMemo(() => {
    if (!plan) return null;
    const fresh = weatherAgeDays !== null && weatherAgeDays <= 14;
    return assess(plan, suit, {
      departureLmst,
      sunsetLmst,
      sunsetMarginMin: SUNSET_MARGIN_MIN,
      returnLmst: returnLmst ?? departureLmst,
      dustStormSeason: isDustStormSeason(clock.ls),
      opacity: fresh ? (latest?.opacity ?? null) : null,
      uvIndex: fresh ? (latest?.uvIndex ?? null) : null,
      weatherAgeDays,
    });
  }, [plan, suit, departureLmst, sunsetLmst, returnLmst, clock.ls, latest, weatherAgeDays]);

  const patchStop = useCallback((id: string, patch: Partial<StopConfig>) => {
    setStops((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const addStop = useCallback((position: LatLon) => {
    customCount.current += 1;
    const n = customCount.current;
    setStops((list) => [
      ...list,
      {
        id: `custom-${n}`,
        name: `Waypoint ${n}`,
        position,
        value: 3,
        dwellMinutes: 20,
        mode: 'required',
        custom: true,
      },
    ]);
    setTab('plan');
  }, []);
  const onStopMode = useCallback(
    (id: string, mode: StopMode) => patchStop(id, { mode }),
    [patchStop],
  );
  const onViewChange = useCallback((b: Bounds) => {
    viewBounds.current = b;
  }, []);

  const loadLiveTerrain = async (): Promise<void> => {
    const view = viewBounds.current;
    if (!view) return;
    if (!contains(view, habitat)) {
      setTerrainError(
        'The habitat is outside the current map view. Pan so the habitat is visible, or move the habitat first.',
      );
      return;
    }
    setTerrainBusy(true);
    setTerrainError(null);
    try {
      setTerrain(await fetchLiveTerrain(view));
    } catch (e) {
      setTerrainError(
        `${e instanceof Error ? e.message : String(e)}. Still planning on the previous terrain.`,
      );
    } finally {
      setTerrainBusy(false);
    }
  };
  const resetTerrain = (): void => {
    setTerrainError(null);
    loadSnapshotTerrain()
      .then(setTerrain)
      .catch((e: Error) => setTerrainError(e.message));
  };
  const exportGeoJson = (): void => {
    if (!plan) return;
    const url = URL.createObjectURL(
      new Blob([routeGeoJson(plan, habitat)], { type: 'application/geo+json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relic-sortie.geojson';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (fatal) {
    return (
      <main className="fatal" role="alert">
        <h1>RELIC could not start</h1>
        <p>{fatal}</p>
      </main>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <h1>RELIC</h1>
          <p>Route &amp; EVA Layered Intelligence Console · Gale Crater</p>
        </header>
        <nav className="tabs" role="tablist" aria-label="Console sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="tab-body" role="tabpanel">
          {tab === 'plan' && (
            <PlanPanel
              plan={plan}
              planning={planning}
              assessment={assessment}
              stops={stops}
              suit={suit}
              departureLmst={departureLmst}
              returnLmst={returnLmst}
              clock={clock}
              onStop={patchStop}
              onRemoveStop={(id) => setStops((list) => list.filter((s) => s.id !== id))}
              onSuit={(patch) => setSuit((s) => ({ ...s, ...patch }))}
              onDeparture={setDepartureLmst}
              onBriefing={() => setBriefing(true)}
              onExport={exportGeoJson}
            />
          )}
          {tab === 'layers' && (
            <LayersPanel
              base={base}
              layers={layers}
              onBase={setBase}
              onLayer={(id, patch) =>
                setLayers((all) => ({
                  ...all,
                  [id]: { ...(all[id] ?? { on: false, opacity: 1 }), ...patch },
                }))
              }
            />
          )}
          {tab === 'conditions' && (
            <ConditionsPanel
              clock={clock}
              latitude={habitat.lat}
              latest={latest}
              weatherAgeDays={weatherAgeDays}
              weatherLive={Boolean(weather?.live)}
              climate={climate}
              plan={plan}
            />
          )}
          {tab === 'data' && (
            <DataPanel
              manifest={manifest}
              terrainSource={terrain?.source ?? ''}
              terrainBusy={terrainBusy}
              terrainError={terrainError}
              weatherLive={Boolean(weather?.live)}
              onLiveTerrain={() => void loadLiveTerrain()}
              onSnapshotTerrain={resetTerrain}
            />
          )}
        </div>
      </aside>

      <main className="stage">
        <MapView
          base={base}
          layers={layers}
          terrain={terrain}
          slope={slope}
          envelope={result?.envelope ?? null}
          suit={suit}
          habitat={habitat}
          stops={stops}
          plan={plan}
          traverse={traverse}
          rois={rois}
          onSetHabitat={setHabitat}
          onAddStop={addStop}
          onStopMode={onStopMode}
          onViewChange={onViewChange}
        />
        <div className="status" aria-live="polite">
          {planning
            ? 'Planning…'
            : result
              ? `Planned in ${(result.elapsedMs / 1000).toFixed(1)} s on ${terrain ? Math.round(terrain.cellSizeX) : '?'} m terrain`
              : 'Loading NASA terrain…'}
        </div>
        {plan && plan.visits.length > 0 && (
          <section className="drawer" aria-label="Route profile">
            <ProfileChart plan={plan} />
            <ol className="legs">
              {plan.visits.map((v, i) => (
                <li key={v.stop.id}>
                  <b>{i + 1}</b> {v.stop.name}
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>

      {briefing && plan && assessment && (
        <Briefing
          plan={plan}
          assessment={assessment}
          suit={suit}
          departureLmst={departureLmst}
          sunsetLmst={sunsetLmst}
          terrainSource={terrain?.source ?? ''}
          onClose={() => setBriefing(false)}
        />
      )}
    </div>
  );
}
