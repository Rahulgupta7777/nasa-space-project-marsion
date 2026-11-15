# NASA data sources

Every endpoint below was requested from a clean environment on 2026-11-15 and answered 200 with a CORS
header that lets a browser read it directly (`Access-Control-Allow-Origin: *`, or the caller's origin for
the Trek ArcGIS services). RELIC therefore needs no backend, proxy or API key.

## Used by the app

### NASA Solar System Treks (JPL): Mars Trek

- Portal: https://trek.nasa.gov/mars/
- WMTS API documentation: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars
- Product catalogue (225 Mars products, JSON):
  `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=2000&facetKeys=itemType&facetValues=product`
- Services of one product: `https://trek.nasa.gov/mars/TrekServices/ws/index/getLayerServices?uuid=<item_UUID>`
- Tile template: `https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{y}/{x}.<ext>`
  (equirectangular; zoom 0 is two 256 px tiles wide; matches Leaflet's `L.CRS.EPSG4326`).
- Capabilities per layer: `https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/WMTSCapabilities.xml`

| Layer id                                                 | Mission, instrument                 | Resolution | Format, max zoom |
| -------------------------------------------------------- | ----------------------------------- | ---------- | ---------------- |
| `Mars_Viking_MDIM21_ClrMosaic_global_232m`               | Viking Orbiters, VIS                | 232 m      | jpg, 7           |
| `Mars_MGS_MOLA_ClrShade_merge_global_463m`               | Mars Global Surveyor, MOLA          | 463 m      | jpg, 7           |
| `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw` | MGS MOLA + Mars Express HRSC        | 200 m      | jpg, 8           |
| `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`         | 2001 Mars Odyssey, THEMIS           | 100 m      | png, 9           |
| `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`       | 2001 Mars Odyssey, THEMIS           | 100 m      | png, 9           |
| `TES_Dust`                                               | Mars Global Surveyor, TES           | ~7 km      | png, 1           |
| `curiosity_ctx_mosaic`                                   | Mars Reconnaissance Orbiter, CTX    | 6 m        | png, 10          |
| `curiosity_hirise_mosaic`                                | Mars Reconnaissance Orbiter, HiRISE | 25 cm      | png, 16          |

Elevation and features come from Trek's ArcGIS server, `https://trek.nasa.gov/mars/trekarcgis/rest/services`:

| Service                                                   | What RELIC reads                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Gale_DEM_SMG_1m/ImageServer`                             | MRO HiRISE stereo DEM of Gale Crater, 1 m, float32 metres. `exportImage?format=bip&pixelType=F32` returns raw little-endian floats, row 0 north, followed by a 1-bit validity mask. |
| `mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer` | MGS MOLA global DEM, ~463 m. Fallback outside the HiRISE footprint.                                                                                                                 |
| `curiosity_waypoints/MapServer/0`                         | 14 named Curiosity science sites with NASA description pages.                                                                                                                       |
| `EZMars/MapServer/3`                                      | Regions of interest proposed for human Exploration Zones (2015 Human Landing Sites Study).                                                                                          |

### NASA Mars Exploration Program (mars.nasa.gov)

- Curiosity REMS daily weather: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
  (4,745 sols, 2012-08-07 to 2026-08-25 at the time of the snapshot; data provided by Centro de Astrobiologia).
  NASA's CDN answers 403 to headless-browser user agents; ordinary browsers receive the feed.
- Curiosity traverse: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json
- Curiosity waypoints (sol, position, elevation): https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json

### NASA GISS

- Mars24 Sunclock algorithm and worked example: https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
  (Allison and McEwen 2000). Implemented in `src/core/marsTime.ts`; the worked example is a unit test.

### Curiosity RAD

- Surface dose equivalent rate 0.64 ± 0.12 mSv/day: Hassler et al. 2014, Science 343, 1244797.
- Archive: https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/

## Also on Mars Trek for Gale Crater (not yet wired in)

- `Gale_DEM_SMG_1m` as WMTS, `Gale_CTX_BlockAdj_dd` (CTX mosaic), `mola_roughness`, `TES_Thermal_Inertia`,
  `Mars_MGS_TES_Albedo_mosaic_global_7410m`, `SIM3292_Global_Geology` (USGS global geologic map).
- Feature services: `curiosity_path`, `combinedNom` (IAU nomenclature), `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0`,
  `mars_mro_crism_mtrdr_c0a_humex_frt_sites`, `Dune_Field`, `RSLs_Gullies_New_IcyCraters_clon0`.
- Other sites with a NASA-hosted raw elevation service: Columbia Hills (`DEM_1m_ColumbiaHills`), Endeavour and
  Victoria craters, InSight. Jezero's HiRISE and CTX DEMs are served as picture tiles only.

## Other NASA resources for this challenge

- Challenge page: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/
- HiRISE images and DTMs: https://www.uahirise.org/ and https://hirise-pds.lpl.arizona.edu/PDS/
- MRO CRISM mineral maps: https://pds-geosciences.wustl.edu/missions/mro/crism.htm, search at https://ode.rsl.wustl.edu/mars/
- NASA Ames Mars climate reference simulations: https://data.nas.nasa.gov/mcmcref/ (tools: https://github.com/NASA-Planetary-Science/AmesCAP)
- NASA Image and Video Library API: https://images-api.nasa.gov/search (docs: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf)
- Space weather (DONKI): https://ccmc.gsfc.nasa.gov/tools/DONKI/ and https://api.nasa.gov/. Not wired in: on
  2026-11-15 the shared `DEMO_KEY` was rate-limited and `/DONKI/FLR` answered 404, so it needs your own key and a re-test.
- Perseverance traverse on Trek: `Perseverance_Traverse_Path/MapServer/0`.

## Not used, and why

- `CTX_beta01_uncontrolled_5m_Caltech` (global CTX mosaic): listed by Trek, but its tiles are served from
  `astro.arcgis.com` (Esri), not a NASA host. RELIC uses the NASA-hosted regional CTX mosaic instead.
