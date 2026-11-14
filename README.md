# Ember Calendar — harmonized MODIS + VIIRS fire activity

Frontend for the NASA Space Apps Challenge 2026 challenge **"Harmonization of MODIS and VIIRS Hot Spots"** (authored by CONAE).
It turns two fire records that cannot be compared directly — MODIS (1 km, 2000→) and VIIRS (375 m, 2012→) — into one burn-activity calendar for an area of interest.

> "Ember Calendar" is a working title. Change it in `src/lib/env.ts` (`APP_NAME`) and `index.html`.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build in dist/
npm run preview    # serve the build
```

Node 20+ recommended.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | `true`: every `/api/*` call is answered by `src/mocks` with **synthetic** data. `false`: calls go to the backend. |
| `VITE_API_URL` | *(empty)* | Backend origin without trailing slash, e.g. `http://localhost:8000`. Empty = same origin. |

Defaults live in `.env` (no secrets). Override them in `.env.local`, which is git-ignored.

### Turning the mocks off and connecting the backend

```bash
cp .env.example .env.local   # VITE_USE_MOCKS=false, VITE_API_URL=http://localhost:8000
npm run dev
```

Nothing else changes: `src/lib/api.ts` is the only network entry point, and the mock layer returns real `Response` objects, so parsing, the worker and the UI run the same code in both modes. While mocks are on, the header shows a **Demo data** badge.

## API contract

Types are in `src/lib/types.ts` and must be matched exactly.

| Endpoint | Returns |
|---|---|
| `GET /api/aoi/search?q=` | `AOI[]` |
| `GET /api/calendar?aoi=&from=&to=&resolution=day\|week\|month` | `CalendarResponse` |
| `GET /api/hotspots?bbox=W,S,E,N&date=YYYY-MM-DD&sensor=modis\|viirs` | `Hotspot[]` |
| `GET /api/anomalies?aoi=` | `Anomaly[]` |
| `GET /api/satellites/tle` | `TLE[]` |
| `POST /api/analyst` | SSE stream (see below) |

Things the frontend assumes beyond the type definitions — please confirm or tell us to change them:

- **`null` means "no observation"**, never zero. Null cells are drawn hatched.
- **Custom areas** (drawn rectangle, clicked point) are sent as `aoi=bbox:W,S,E,N`. The backend needs to accept that id form.
- **Week bins** start on 1 January of each year (`week = floor((doy − 1) / 7)`, 53 per year); `date` is the first day of the bin. Month bins use the first of the month.
- **`climatology[].doy`** is the first day-of-year of each bin at the requested resolution, and describes the harmonized series.
- **`anomalyZ`** is omitted for the bin still in progress (current week/month).
- **Hotspots for a month or year** are fetched one day at a time (8 requests in parallel) because the contract takes a single `date`. A year is ~730 requests; if that is too heavy, add `from`/`to` to the endpoint and change the loop in `src/lib/data.worker.ts`.
- **Analyst SSE**: each event is a `data:` line. `{"delta":"text"}` (or `{"text":"…"}`, or plain text) is appended to the answer; the final event is `{"highlights":[{"date","reason"}]}`. `[DONE]` is ignored. The parser is `src/lib/sse.ts`.
- **TLEs** in `src/mocks/tle.json` are a CelesTrak snapshot from 2026-11-14. The backend should serve fresh ones; positions degrade as a TLE ages.

## What the mock data is

`src/mocks/model.ts` is a seeded generator, not a sample of FIRMS. It reproduces the *shape* of the problem: a fire season, year-to-year variability, multi-day episodes, sensor start dates (Terra 2000, Aqua 2002, S-NPP 2012, NOAA-20 2018, NOAA-21 2024), a few outages and gaps. Calendar counts and hotspot points come from the same generator, so they agree. **No number shown in demo mode is a measurement**, including the VIIRS/MODIS ratio.

## Architecture

```
src/
  app/          App shell, data loaders (TanStack Query), i18n + locales (EN default, ES)
  intro/        Intro sequence (GSAP timeline)
  scenes/       The single WebGL scene: Globe (Earth + Atmosphere), Hotspots, Satellites, Overlays, CameraRig
  features/
    landing/    Hero, Problem, Header, OrbitNav (scroll satellites), Credits
    explorer/   Globe/map stage, layers, timeline, 2D map, pick panel
    aoi/        Area search
    calendar/   Burn-activity calendar (canvas)
    anomalies/  methodology/  analyst/
  components/ui/
  lib/          api client, worker, satellite propagation, colour scales, geo/sun maths
  mocks/        Mock backend
  store/        Zustand stores
```

- **One WebGL renderer.** The canvas is fixed behind the page. Any DOM element can become a "stage" (`useGlobeStage`); the camera uses a projection view-offset to keep the globe centred on the active stage, so the intro, the hero and the explorer share the same Earth.
- **Earth-fixed frame.** The Earth never rotates; the camera orbits it. Satellites (satellite.js, SGP4 → ECEF) and the sun direction (day/night terminator) are computed in that frame from a simulated UTC clock (×1 / ×60 / ×600).
- **Rendering on demand.** `frameloop="demand"`; `CameraRig` requests frames only while something moves, plus a 4 fps heartbeat for satellites. Nothing renders when the tab is hidden or no stage is on screen.
- **Hotspots** are one `Points` draw call with a shader; density hexagons are one `InstancedMesh`.
- **Worker.** Fetching, parsing, typed-array packing, hex binning and CSV export run in `src/lib/data.worker.ts`.
- **2D fallback.** Without WebGL2, or on low-memory devices, the app uses the Equal Earth canvas map (`Map2D`), which is also the "2D" side of the view toggle.
- **Code splitting.** First paint is the star field (2D canvas) and the logo, ~120 KB gzip of JS+CSS (React, GSAP core, satellite.js, TanStack Query). three.js, the scene, the landing and the calendar are lazy chunks.

## Brand assets

Put the official NASA Space Apps Challenge logo at `public/brand/space-apps-logo.svg` (from <https://www.spaceappschallenge.org/brand>). Until it exists the intro shows plain text instead. The intro only fades and uniformly scales the logo. Colours and fonts in `tailwind.config.ts` follow the Space Apps palette from memory — check the hex values against the current brand guide.

## Accessibility

Keyboard: the globe (arrows, `+`/`−`, Enter), the calendar grid (arrows, Home/End, Enter) and every control are reachable; focus is always visible. The calendar has a year × month table alternative ("View as table", also exposed to screen readers). `prefers-reduced-motion` skips the intro and stops auto-rotation.

## Known limits

- Earth textures stop at 4K, so the surface is soft at the highest zoom levels; borders are Natural Earth 1:50m, countries only (no departments).
- Area drawing supports rectangles, not free polygons.
- Verified in Chrome at 360, 768, 1280 and 1920 px with software WebGL. Not yet measured: Lighthouse scores, 60 fps with 100k points on real GPUs, Safari/Firefox, real phones.

## Data credits

- **NASA FIRMS / LANCE** — MODIS (Collection 6.1) and VIIRS 375 m active-fire products. *We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).*
- **CONAE** — author of the challenge.
- **CelesTrak** — orbital elements (TLE).
- **Natural Earth** via `world-atlas` — country boundaries.
- **NASA Blue Marble / Black Marble** — Earth textures (files taken from the three.js examples; rebuild with `scripts/build-textures.mjs`).

Independent hackathon project; not an official NASA or CONAE product.
