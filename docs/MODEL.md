# Planning model and assumptions

RELIC separates measured data from modelling assumptions. Terrain, imagery, weather, radiation and time
are NASA data or NASA algorithms. The numbers on this page are engineering assumptions chosen to be
plausible and transparent; every one is a field of `SuitProfile` (`src/core/cost.ts`) and most can be
changed in the app. None is a NASA requirement.

## Terrain

- Grid: equirectangular lat/lon raster on the IAU2000:104905 sphere (radius 3,396,190 m), row 0 north.
- Slope per cell: Horn's 3x3 estimator, the same one GDAL and ArcGIS use.
- Moves: 8-connected lattice. A cell whose own slope exceeds the limit is never entered, so a route cannot
  contour across a hillside too steep to stand on; a step whose directional grade exceeds the limit is refused.
- Lattice paths overestimate distance by up to 8% against free-angle walking. That errs on the safe side.

## Walking

| Quantity                | Default                                                      | Why                                                                                      |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Speed on level ground   | 0.9 m/s (3.2 km/h)                                           | Deliberate pace in a pressurised suit; Apollo walking traverses averaged a few km/h.     |
| Speed on a grade        | Tobler's hiking function, rescaled to the level-ground speed | Standard empirical shape: fastest on a gentle descent, exponential fall-off either side. |
| Slope limit             | 20° (caution from 15°)                                       | Apollo crews found slopes near 20° hard going; adjustable 10 to 30°.                     |
| Suited mass             | 180 kg                                                       | Astronaut plus surface suit and tools.                                                   |
| Metabolic rate, walking | 300 W                                                        | About 1000 BTU/h, typical of surface EVA averages.                                       |
| Metabolic rate, working | 250 W                                                        | Lighter than walking.                                                                    |
| Climbing                | suited mass x 3.71 m/s² x rise / 0.25                        | Work against Mars gravity at 25% muscular efficiency. Descending earns no credit.        |

## Oxygen

- 20.1 kJ of metabolic energy per litre of O2, 1.429 g/L, so 14.07 MJ per kg of O2.
- Primary supply 0.55 kg, of which 20% is a reserve the planner never spends. Usable: 0.44 kg, about
  5.7 hours of level walking.
- The planner minimises metabolic energy, because oxygen is the consumable that ends an EVA.

## Budgets

- Oxygen: total energy of walking plus work at stops must not exceed the usable supply.
- Time: no longer than the suit limit (8 h), and back at least 60 Mars-minutes before sunset.
- Walk-back: at every cell of the route, oxygen used so far plus the least-energy walk straight home from
  there. For a closed loop that fits the budget this margin is never negative; RELIC reports its minimum and
  where it occurs, and each stop's abort margin.

## Choosing stops

An orienteering problem: maximise the summed priority of visited stops subject to the budgets, visiting all
"must" stops. With n ≤ 12 candidates RELIC runs Held-Karp dynamic programming over all subsets, once
minimising energy and once minimising time, and accepts a subset when either ordering fits both budgets.
With one binding budget this is exact (tested against exhaustive search); with both binding it can miss an
ordering that trades one for the other, never the reverse.

## Verdict

NO-GO: infeasible plan, negative walk-back margin, or return later than the daylight margin.
CAUTION: under 15% of usable oxygen left, steps at or above the caution slope, EVA within 10% of the suit
limit, or (with a REMS report under 14 days old) opacity other than sunny or a very high UV index.
Informational: dust-storm season (Ls 180 to 360), stale weather.

## What is not modelled

Boulders and sand traps below grid resolution, suit thermal load, battery, CO2 scrubbing, cooling water,
communications line of sight, solar particle events, and fatigue.
