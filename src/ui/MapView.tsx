import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef } from 'react';

import type { SuitProfile } from '../core/cost';
import type { Bounds, LatLon } from '../core/geo';
import { MARS_RADIUS_M } from '../core/geo';
import type { Plan } from '../core/planner';
import type { TerrainGrid } from '../core/terrain';
import { cellIndex, computeHillshade } from '../core/terrain';
import { TILE_LAYERS, trekTileUrl } from '../data/layers';
import type { ExplorationRoi, Traverse } from '../data/snapshot';
import type { LayerState, StopConfig, StopMode } from '../state';
import { coord } from './format';
import { renderEnvelope, renderHillshade, renderSlope } from './overlays';

/** Mars Trek's equirectangular tiling is plain lat/lon; only the sphere radius differs from Earth. */
const MARS_CRS = L.Util.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M }) as L.CRS;

const toLeafletBounds = (b: Bounds): L.LatLngBounds =>
  L.latLngBounds([b.south, b.west], [b.north, b.east]);

interface Props {
  base: string;
  layers: Record<string, LayerState>;
  terrain: TerrainGrid | null;
  slope: Float32Array | null;
  envelope: Float32Array | null;
  suit: SuitProfile;
  habitat: LatLon;
  stops: StopConfig[];
  plan: Plan | null;
  traverse: Traverse | null;
  rois: ExplorationRoi[];
  onSetHabitat: (p: LatLon) => void;
  onAddStop: (p: LatLon) => void;
  onStopMode: (id: string, mode: StopMode) => void;
  onViewChange: (bounds: Bounds) => void;
}

const button = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};

export function MapView(props: Props): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef(new Map<string, L.TileLayer>());
  const images = useRef(new Map<string, L.ImageOverlay>());
  const groups = useRef({
    traverse: L.layerGroup(),
    sites: L.layerGroup(),
    roi: L.layerGroup(),
    route: L.layerGroup(),
  });
  const latest = useRef(props);
  latest.current = props;

  // Create the map once.
  useEffect(() => {
    if (!container.current || map.current) return;
    const m = L.map(container.current, {
      crs: MARS_CRS,
      center: [-4.655, 137.4],
      zoom: 12,
      minZoom: 2,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: false,
    });
    m.attributionControl.setPrefix('Imagery and terrain: NASA Solar System Treks');
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
    for (const pane of ['computed', 'vectors']) m.createPane(pane);
    m.getPane('computed')!.style.zIndex = '350';
    m.getPane('vectors')!.style.zIndex = '450';
    Object.values(groups.current).forEach((g) => g.addTo(m));

    m.on('click', (event: L.LeafletMouseEvent) => {
      const { terrain, slope } = latest.current;
      const p = { lat: event.latlng.lat, lon: event.latlng.lng };
      const box = document.createElement('div');
      box.className = 'map-popup';
      const index = terrain ? cellIndex(terrain, p) : -1;
      const z = index >= 0 ? terrain!.elevation[index]! : Number.NaN;
      const s = index >= 0 && slope ? slope[index]! : Number.NaN;
      const title = document.createElement('strong');
      title.textContent = coord(p.lat, p.lon);
      const detail = document.createElement('p');
      detail.textContent = Number.isNaN(z)
        ? 'Outside the loaded terrain.'
        : `Elevation ${z.toFixed(0)} m${Number.isNaN(s) ? '' : `, slope ${s.toFixed(0)}°`}`;
      box.append(title, detail);
      if (!Number.isNaN(z)) {
        box.append(
          button('Add a stop here', () => {
            latest.current.onAddStop(p);
            m.closePopup();
          }),
          button('Move habitat here', () => {
            latest.current.onSetHabitat(p);
            m.closePopup();
          }),
        );
      }
      L.popup({ className: 'relic-popup' }).setLatLng(event.latlng).setContent(box).openOn(m);
    });
    const report = (): void => {
      const b = m.getBounds();
      latest.current.onViewChange({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };
    m.on('moveend', report);
    map.current = m;
    report();
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // NASA Trek tile layers.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    TILE_LAYERS.forEach((def, order) => {
      const state =
        def.kind === 'base' ? { on: props.base === def.id, opacity: 1 } : props.layers[def.id];
      let layer = tiles.current.get(def.id);
      if (state?.on && !layer) {
        layer = L.tileLayer(trekTileUrl(def), {
          tileSize: 256,
          maxNativeZoom: def.maxNativeZoom,
          maxZoom: 18,
          noWrap: true,
          bounds: def.bounds ? toLeafletBounds(def.bounds) : undefined,
          zIndex: def.kind === 'base' ? 1 : 10 + order,
          attribution: def.credit,
        }).addTo(m);
        tiles.current.set(def.id, layer);
      } else if (!state?.on && layer) {
        layer.remove();
        tiles.current.delete(def.id);
      }
      if (state?.on) tiles.current.get(def.id)?.setOpacity(state.opacity);
    });
  }, [props.base, props.layers]);

  // Rasters computed from the terrain.
  const hillshadeUrl = useMemo(
    () =>
      props.terrain && props.layers.hillshade?.on
        ? renderHillshade(props.terrain, computeHillshade(props.terrain))
        : null,
    [props.terrain, props.layers.hillshade?.on],
  );
  const slopeUrl = useMemo(
    () =>
      props.terrain && props.slope && props.layers.slope?.on
        ? renderSlope(props.terrain, props.slope, props.suit)
        : null,
    [props.terrain, props.slope, props.layers.slope?.on, props.suit],
  );
  const envelopeUrl = useMemo(
    () =>
      props.terrain &&
      props.envelope &&
      props.layers.envelope?.on &&
      props.envelope.length === props.terrain.width * props.terrain.height
        ? renderEnvelope(props.terrain, props.envelope)
        : null,
    [props.terrain, props.envelope, props.layers.envelope?.on],
  );
  useEffect(() => {
    const m = map.current;
    if (!m || !props.terrain) return;
    const bounds = toLeafletBounds(props.terrain.bounds);
    const entries: Array<[string, string | null, number]> = [
      ['hillshade', hillshadeUrl, 1],
      ['slope', slopeUrl, 2],
      ['envelope', envelopeUrl, 3],
    ];
    for (const [id, url, z] of entries) {
      images.current.get(id)?.remove();
      images.current.delete(id);
      if (!url) continue;
      const overlay = L.imageOverlay(url, bounds, {
        pane: 'computed',
        opacity: props.layers[id]?.opacity ?? 1,
        zIndex: z,
        className: 'crisp',
        interactive: false,
      }).addTo(m);
      images.current.set(id, overlay);
    }
  }, [props.terrain, hillshadeUrl, slopeUrl, envelopeUrl, props.layers]);

  // Frame the planning terrain whenever a new grid arrives.
  useEffect(() => {
    if (map.current && props.terrain)
      map.current.fitBounds(toLeafletBounds(props.terrain.bounds), { padding: [20, 20] });
  }, [props.terrain]);

  // Curiosity traverse and Exploration Zone regions.
  useEffect(() => {
    const g = groups.current.traverse.clearLayers();
    const state = props.layers.traverse;
    if (!props.traverse || !state?.on) return;
    L.polyline(
      props.traverse.line.map(([lon, lat]) => [lat, lon] as [number, number]),
      {
        pane: 'vectors',
        color: '#f4efe9',
        weight: 1.5,
        opacity: state.opacity,
        dashArray: '4 4',
        interactive: false,
      },
    ).addTo(g);
    const { latest: rover } = props.traverse;
    L.circleMarker([rover.lat, rover.lon], {
      pane: 'vectors',
      radius: 5,
      color: '#14100e',
      weight: 1,
      fillColor: '#f4efe9',
      fillOpacity: 1,
    })
      .bindTooltip(`Curiosity, sol ${rover.sol}`)
      .addTo(g);
  }, [props.traverse, props.layers.traverse]);

  useEffect(() => {
    const g = groups.current.roi.clearLayers();
    const state = props.layers.roi;
    if (!state?.on) return;
    for (const roi of props.rois) {
      L.polygon(
        roi.ring.map(([lon, lat]) => [lat, lon] as [number, number]),
        {
          pane: 'vectors',
          color: '#c9a2ff',
          weight: 1.5,
          opacity: state.opacity,
          fillOpacity: 0.05,
          dashArray: '6 4',
        },
      )
        .bindPopup(
          `<strong>Region of interest ${roi.id}</strong><p>Proposed for human exploration of Gale Crater. ` +
            `${roi.scienceCriteria} science and ${roi.resourceCriteria} resource criteria flagged.</p>` +
            `<a href="${roi.abstract}" target="_blank" rel="noreferrer">Workshop abstract ${roi.proposal}</a>`,
          { className: 'relic-popup' },
        )
        .addTo(g);
    }
  }, [props.rois, props.layers.roi]);

  // Science sites.
  useEffect(() => {
    const g = groups.current.sites.clearLayers();
    if (!props.layers.sites?.on) return;
    const visitOrder = new Map((props.plan?.visits ?? []).map((v, i) => [v.stop.id, i + 1]));
    for (const stop of props.stops) {
      const order = visitOrder.get(stop.id);
      const classes = ['site', `site-${stop.mode}`, order ? 'site-visited' : ''].join(' ');
      const marker = L.marker([stop.position.lat, stop.position.lon], {
        pane: 'vectors',
        zIndexOffset: order ? 500 : 0,
        icon: L.divIcon({
          className: '',
          html: `<span class="${classes}">${order ?? ''}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).bindTooltip(stop.name, { direction: 'top', offset: [0, -10] });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        const box = document.createElement('div');
        box.className = 'map-popup';
        const title = document.createElement('strong');
        title.textContent = stop.name;
        box.append(title);
        if (stop.info) {
          const link = document.createElement('a');
          link.href = stop.info;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = 'NASA site notes';
          box.append(link);
        }
        const modes: Array<[StopMode, string]> = [
          ['required', 'Must visit'],
          ['optional', 'Visit if able'],
          ['skip', 'Skip'],
        ];
        for (const [mode, label] of modes) {
          const b = button(label, () => {
            latest.current.onStopMode(stop.id, mode);
            map.current?.closePopup();
          });
          if (mode === stop.mode) b.setAttribute('aria-pressed', 'true');
          box.append(b);
        }
        L.popup({ className: 'relic-popup' })
          .setLatLng(marker.getLatLng())
          .setContent(box)
          .openOn(map.current!);
      });
      marker.addTo(g);
    }
  }, [props.stops, props.plan, props.layers.sites]);

  // Habitat and planned route.
  const { plan, habitat } = props;
  useEffect(() => {
    const g = groups.current.route.clearLayers();
    if (plan) {
      for (const leg of plan.legs) {
        const line = leg.path.map((p) => [p.lat, p.lon] as [number, number]);
        L.polyline(line, {
          pane: 'vectors',
          color: '#14100e',
          weight: 7,
          opacity: 0.7,
          interactive: false,
        }).addTo(g);
        L.polyline(line, {
          pane: 'vectors',
          color: plan.feasible ? '#ff8a3d' : '#ff5d5d',
          weight: 3.5,
          interactive: false,
        }).addTo(g);
      }
      if (plan.walkback.at && plan.visits.length) {
        L.marker([plan.walkback.at.lat, plan.walkback.at.lon], {
          pane: 'vectors',
          icon: L.divIcon({
            className: '',
            html: '<span class="tightest"></span>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        })
          .bindTooltip(`Tightest walk-back margin: ${plan.walkback.minMarginKg.toFixed(2)} kg O₂`)
          .addTo(g);
      }
    }
    L.marker([habitat.lat, habitat.lon], {
      pane: 'vectors',
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: '',
        html: '<span class="habitat">H</span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    })
      .bindTooltip('Habitat')
      .addTo(g);
  }, [plan, habitat]);

  return (
    <div ref={container} className="map" role="application" aria-label="Map of Gale Crater, Mars" />
  );
}
