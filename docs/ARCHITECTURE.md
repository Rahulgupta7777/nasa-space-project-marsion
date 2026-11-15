# Architecture

```
NASA Trek WMTS tiles ───────────────────────────────┐
NASA Trek ImageServer (HiRISE / MOLA elevation) ─┐   │
mars.nasa.gov (REMS weather, MSL traverse) ──────┤   │
public/data snapshot (same data, bundled) ───────┤   │
                                                 ▼   ▼
                         src/data  ──►  src/App (React state)  ──►  src/ui (Leaflet map, panels, briefing)
                                              │      ▲
                                 PlanRequest  ▼      │ Plan + envelope
                                        src/worker (Web Worker)
                                              │
                                              ▼
                              src/core (pure TypeScript, unit-tested)
```

## Layers and rules

| Folder                  | Responsibility                                                                  | May import                           |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `src/core`              | Mars time, geodesy, terrain, cost model, cost fields, planner, verdict, weather | nothing outside `core` (ESLint rule) |
| `src/data`              | Endpoint URLs, layer catalogue, snapshot and live loaders                       | `core`                               |
| `src/worker`            | Runs `core` planning off the main thread, caches cost fields                    | `core`                               |
| `src/ui`, `src/App.tsx` | Presentation and interaction                                                    | everything                           |
| `scripts`               | Reproducible snapshot of NASA data                                              | `core`, `data/endpoints`             |

`core` has no `window`, `document` or `fetch`. That is what lets the same code run in the browser, in the
worker, in Node tests and in the snapshot script.

## Decisions

1. **Static site, no backend.** Every NASA endpoint used sends CORS headers, so the browser reads NASA
   directly. Fewer moving parts, free hosting, nothing between the user and the source.
2. **Gale Crater as the site.** It is the one place where NASA hosts a raw, queryable 1 m elevation service
   next to HiRISE and CTX mosaics, a decade of surface weather and radiation measurements, a rover's ground
   truth and a human Exploration Zone proposal. Jezero's DEMs are only served as pictures.
3. **Snapshot first, live second.** The app loads a bundled copy of the data, then upgrades. A demo does not
   die with a slow service, and the offline story is real. `manifest.json` records URL and time for each file.
4. **Minimise energy, not distance.** Oxygen ends an EVA. Energy is strictly positive per step, so Dijkstra
   applies; time is carried along the same path.
5. **Exact subset DP instead of a heuristic.** Twelve stops is 4,096 subsets; an exact answer in milliseconds
   is easier to trust and to test than a tuned heuristic.
6. **Planner in a worker with a field cache.** One cost field over 266,000 cells takes about 0.2 s. Fields
   depend only on terrain, suit and source cell, so toggling a stop reuses them.
7. **Leaflet with `L.CRS.EPSG4326`.** Trek's equirectangular tiling is exactly that grid; only the sphere
   radius is overridden so distances and the scale bar are Martian.
8. **React, no state library.** One screen; `useState` in `App` is enough and keeps the dependency list short.

## Testing

`npm test` runs 45 unit tests in Node: the Mars24 worked example, the binary elevation decoder against the
layout NASA returns, slope and hillshade on analytic surfaces, path costs on flat, inclined and walled
terrain, the tour solver against exhaustive search, the planner on synthetic terrain, and an end-to-end
plan on the bundled HiRISE terrain of Gale Crater with NASA's named sites.

CI (`.github/workflows/ci.yml`) runs format check, typecheck, lint, tests and build on every push and pull
request, then deploys `main` to GitHub Pages.
