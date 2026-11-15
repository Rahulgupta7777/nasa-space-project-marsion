# Submission kit

## One-line pitch

RELIC turns five NASA missions' worth of Gale Crater data into one decision for a Marswalk: which science
you can reach, in what order, on the oxygen you carry, with proof you can always walk home.

## 30-second version

The first astronauts on Mars will step out with a few hours of oxygen and no way to call for a tow. RELIC is
their sortie planner. It layers Viking, MOLA, THEMIS, CTX and HiRISE maps with Curiosity's own track, reads
the real 1-metre HiRISE elevation model straight from NASA, and solves for the loop that collects the most
science inside the oxygen, time and daylight budgets. It shades out ground you cannot return from, checks
Mars time and Curiosity's weather record, and ends with GO, CAUTION or NO-GO and a printable checklist.

## Before you submit

- [ ] Push this repository to GitHub (public) and enable Pages with source "GitHub Actions"; confirm the
      workflow turns green and the demo URL loads.
- [ ] Open the demo in a normal browser and confirm the Conditions tab says "live from NASA" for weather.
- [ ] Record the two-minute demo from the README (screen capture, no slides needed).
- [ ] Project page: paste the pitch, the demo URL, the repository URL and the video link.
- [ ] "NASA data" field: copy the "Used by the app" section of docs/DATA_SOURCES.md.
- [ ] "Use of AI" field: state plainly that an AI assistant (Claude) was used to research the NASA endpoints
      and to write code, tests and documentation, and that the team reviewed and ran it. Space Apps asks
      teams to disclose AI use.
- [ ] Team name, members and location match the registration.

## Good next steps if there is time

1. Boulder and sand hazards from the HiRISE image itself (rock abundance) to complement slope.
2. Line-of-sight to the habitat for radio coverage, computed from the same elevation grid.
3. A second site: Columbia Hills (Spirit) has the same NASA raw-elevation service.
4. Space-weather gate from NASA DONKI once tested with your own api.nasa.gov key.
5. Installable offline app (service worker caching visited tiles).
