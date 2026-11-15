# Build prompt for Claude Opus 5.5

Paste everything below the line into Claude Code (model: Opus 5.5) in an empty folder. It is self-contained:
it states the goal, the verified NASA endpoints with their quirks, the product, the architecture and the
acceptance checks. To extend this repository instead of rebuilding it, use the short prompt at the end.

---

You are building a complete, working entry for the NASA Space Apps Challenge 2026 challenge
"Interplanetary Survival Guide: Martian Map". Work autonomously until every acceptance check at the end
passes. Do not ask me questions; make the reasonable choice and record it in docs/ARCHITECTURE.md.

## The challenge

Create a layered, integrated view of a location or route on the Martian surface that pulls together data
from multiple NASA science missions and could help a human explorer plan and carry out a successful
Marswalk while conducting new science along the way. Judges look for impact, creativity, validity,
relevance and presentation.

## What to build

"RELIC" (Route & EVA Layered Intelligence Console): a static web app that plans a walking sortie for an
astronaut at Gale Crater. The user marks science stops as must / if able / skip. The app:

1. Shows NASA map layers from several missions on one map, each with mission, instrument, resolution,
   credit, an opacity control and one sentence on why an astronaut would look at it.
2. Reads real elevation (MRO HiRISE stereo DEM) and computes slope, least-energy walking paths, and the
   oxygen and time each leg costs for an adjustable suit model.
3. Chooses which stops to visit and in what order to maximise summed science priority inside the oxygen,
   suit-duration and daylight budgets, always including the "must" stops (exact subset dynamic
   programming, at most 12 stops).
4. Tracks the walk-back margin along the route (oxygen left if the astronaut abandons the plan and walks
   straight home from that point) and draws a safe-return envelope on the map.
5. Shows current conditions: Mars local time, season, Sun elevation, sunrise and sunset (NASA GISS Mars24
   algorithm); Curiosity REMS weather with the age of the newest report and a climatology for the current
   solar longitude; radiation dose from the Curiosity RAD average.
6. Gives a GO / CAUTION / NO-GO verdict in which every finding names the number that triggered it, an
   elevation profile, a printable one-page sortie briefing, and a GeoJSON export.
7. Works offline from a bundled, reproducible snapshot of the NASA data and upgrades to live data.

## NASA data: use only these hosts (all verified on 2026-11-15 to allow browser CORS)

Map tiles, NASA Solar System Treks WMTS (equirectangular, zoom 0 = two 256 px tiles; matches Leaflet
L.CRS.EPSG4326; override the CRS radius R to 3396190 so distances are Martian):
`https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{y}/{x}.<ext>`

| layer                                                  | mission                                             | ext | max native zoom |
| ------------------------------------------------------ | --------------------------------------------------- | --- | --------------- |
| Mars_Viking_MDIM21_ClrMosaic_global_232m               | Viking Orbiters                                     | jpg | 7               |
| Mars_MGS_MOLA_ClrShade_merge_global_463m               | MGS MOLA                                            | jpg | 7               |
| Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw | MGS MOLA + Mars Express HRSC                        | jpg | 8               |
| THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018         | Mars Odyssey THEMIS (65S-65N)                       | png | 9               |
| THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018       | Mars Odyssey THEMIS (65S-65N)                       | png | 9               |
| TES_Dust                                               | MGS TES                                             | png | 1               |
| curiosity_ctx_mosaic                                   | MRO CTX (136.277..139.386E, -7.214..-3.580N)        | png | 10              |
| curiosity_hirise_mosaic                                | MRO HiRISE (137.1225..137.7298E, -4.9255..-4.2490N) | png | 16              |

Read `<layer>/1.0.0/WMTSCapabilities.xml` if you add a layer; some are jpg, some png. Do not use
CTX_beta01_uncontrolled_5m_Caltech: its tiles come from astro.arcgis.com, not a NASA host.

Elevation, ArcGIS ImageServer on `https://trek.nasa.gov/mars/trekarcgis/rest/services`:

- `Gale_DEM_SMG_1m/ImageServer` (HiRISE, 1 m, float32 metres; same footprint as the HiRISE mosaic)
- `mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer` (MOLA, ~463 m; fallback elsewhere)
- Request: `/exportImage?bbox=W,S,E,N&bboxSR=104905&imageSR=104905&size=WIDTH,HEIGHT&format=bip&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`
- Response: WIDTH*HEIGHT little-endian float32, row-major, row 0 = north, column 0 = west, followed by a
  validity mask of 1 bit per pixel (MSB first, 1 = valid). NoData pixels hold about -3.4e38. Treat both as NaN.
- Sanity value: Bradbury Landing (137.4416E, -4.5895N) is about -4501 m.

Features, same ArcGIS server (`/query?where=1=1&outFields=*&returnGeometry=true&outSR=104905&f=json`):

- `curiosity_waypoints/MapServer/0`: 14 named Curiosity sites; attribute `template` is a path under
  `https://trek.nasa.gov/mars/` to NASA's description page.
- `EZMars/MapServer/3`: human Exploration Zone regions of interest (polygons; keep those with roi = 1).

mars.nasa.gov:

- REMS weather: `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` (key `soles`,
  strings, "--" means missing; fields sol, terrestrial_date, ls, min_temp, max_temp, pressure,
  min_gts_temp, max_gts_temp, atmo_opacity, local_uv_irradiance_index). About 1.7 MB. The CDN returns 403
  to headless-browser user agents, so test the parser on a saved copy and rely on the snapshot fallback.
- Curiosity traverse: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json`
  (MultiLineString of [lon, lat, elevation]); waypoints with sol: `.../MSL_waypoints.json`.

Algorithms and constants:

- Mars24 (Allison and McEwen 2000), https://www.giss.nasa.gov/tools/mars24/help/algorithm.html. Unit-test
  the published worked example: 2000-01-06 00:00:00 UTC at 0N 0E gives Ls 277.18758, EOT -5.18774 deg,
  MTC 23.99425 h, LTST 23.64840 h, declination -25.22838 deg, subsolar longitude 174.72600 W, 1.39358 AU.
- RAD surface dose equivalent 0.64 mSv/day (Hassler et al. 2014, Science 343, 1244797).

Do not use api.nasa.gov with DEMO_KEY (rate-limited) or any non-NASA tile host.

## Engineering requirements

- Vite + TypeScript (strict, noUncheckedIndexedAccess) + React 18 + Leaflet. No backend, no API keys,
  no web fonts, no analytics. `base: './'` so the build runs on GitHub Pages.
- `src/core/`: pure domain logic (geo, marsTime, terrain, cost, pathfield, planner, verdict, weather) with
  no DOM, fetch, React or Leaflet imports; enforce with an ESLint no-restricted-imports rule.
- `src/data/`: endpoints, layer catalogue, snapshot and live loaders. `src/worker/`: planner in a Web
  Worker with a cache of cost fields. `src/ui/`: components. `scripts/fetch-data.ts`: writes
  `public/data/` (terrain as raw float32 plus JSON metadata, sites, decimated traverse, compact REMS rows,
  ROIs) and a `manifest.json` with source URL and fetch time for every file.
- Default operations area 137.32..137.48E, -4.75..-4.56N at about 20 m per cell; default habitat on a
  flat pad chosen from the DEM, movable by the user. A button loads finer live terrain for the current view.
- Planner: Dijkstra over an 8-connected grid minimising metabolic energy (time carried along), separate
  `from` and `to` fields because climbing costs more than descending; cells steeper than the suit limit
  are impassable; Held-Karp subset DP over terrain-measured leg matrices; walk-back margin; envelope.
- Suit model as explicit, adjustable assumptions documented in docs/MODEL.md and labelled in the UI as
  assumptions, not NASA requirements.
- Every remote failure degrades to the snapshot with a visible note. No silent failures, no fake data.
- Accessible: keyboard reachable, visible focus, aria-live verdict, verdict never colour-only,
  prefers-reduced-motion respected. Responsive down to phone width.
- Vitest unit tests for every core module, including a brute-force comparison for the tour solver and an
  end-to-end plan on the bundled HiRISE terrain. ESLint, Prettier, GitHub Actions CI that runs format
  check, typecheck, lint, test and build, then deploys to GitHub Pages.
- Docs: README (what, why different, challenge mapping table, run, demo script, limits, credits),
  docs/ARCHITECTURE.md, docs/MODEL.md, docs/DATA_SOURCES.md, docs/SUBMISSION.md. MIT licence. State that
  the project is not affiliated with NASA.

## How to work

1. Probe each endpoint with curl first (status, content type, CORS header) and decode one small elevation
   request before writing app code. If an endpoint differs from this prompt, trust the endpoint and note it.
2. Build and unit-test `src/core` before any UI.
3. Run the snapshot script, then build the UI on the snapshot, then add live loaders.
4. Verify in a real browser against live NASA tiles: default plan, a "must" stop that strains the budget,
   an oxygen supply too small (expect NO-GO and a visible envelope), a map click that adds a stop, and a
   live terrain reload. Fix every console error you cause.

## Acceptance checks

- `npm ci && npm run check && npm run build` succeeds with zero lint warnings.
- Opening the built app shows a planned multi-stop loop with a verdict within a few seconds, on real NASA
  imagery, with the terrain source named on screen.
- The Mars24 worked-example test and the bundled-terrain planning test pass.
- With the network disabled after first load, planning still works from the snapshot.
- Every data source on screen is traceable to a NASA URL in the Data tab and in docs/DATA_SOURCES.md.
- Nothing in the UI or docs claims a number is a NASA requirement when it is a model assumption.

Finish with a short report: what was built, what was verified and how, and what remains unverified.

---

## Short prompt: extend this repository

Read README.md, docs/ARCHITECTURE.md, docs/MODEL.md and docs/DATA_SOURCES.md, then run `npm ci && npm run
check`. Implement the next item from "Good next steps" in docs/SUBMISSION.md. Keep `src/core` pure and
unit-tested, use only NASA-hosted data listed in docs/DATA_SOURCES.md (probe any new endpoint with curl for
status and CORS first), label every modelling assumption as such, and finish only when `npm run check &&
npm run build` passes and you have exercised the feature in a browser. Report what you verified and what
you could not.
