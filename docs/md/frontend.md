# Frontend

The frontend uses React 19, React Router 7, TypeScript, Vite, Tailwind CSS, and
Playwright. All Node configuration and dependencies live under `frontend/`; there
is no root Node package.

## Commands

From `frontend/`:

```bash
npm ci
npm run dev
npm run check
npm run format
npm run build
npm run preview
npm run test:e2e
```

Install Chromium once with `npx playwright install chromium`. Set `PYTHON_BIN` for
browser tests when the backend interpreter is not available as `python`.
For real local Google sign-in, create the ignored
`frontend/.env.development.local` file and restart Vite. The complete procedure
is in the [local development startup runbook](local-development-startup.md).

## Routes

- `/`: home dashboard
- `/players` and `/teams`: scoped directories
- `/players/:playerId` and `/teams/:teamId`: structured dashboards
- `/matches`: match history and detail
- `/stats`, `/top-team-players`, `/top-tracks`, `/best-matchups`: legacy analytics views
- `/json-editor`: match entry, validation, preview, and upload
- `/database-health`: integrity and review dashboard

`BackgroundSlideshow` and `MusicPlayer` render globally. Public media remains an
intentional product asset and is not duplicated in source.

## API Client

`src/api.ts` owns the base URL, JSON request handling, and common API types.
`src/dashboardApi.ts` defines the structured dashboard contracts. The application
uses native `fetch`; Axios was removed as unused.

`VITE_API_URL` is embedded at build time when an intentionally separate API origin
is needed. Otherwise the client uses `window.location.origin`, so hosted builds are
ready for Firebase Hosting's same-origin `/api/**` rewrite. Local development may
set `VITE_API_URL` explicitly or use Vite's proxy.

## Build And CSS

`index.html` is the sole Vite HTML entry. Tailwind scans it and `src/`; PostCSS owns
CSS compilation. Production output is written to `frontend/build`. Vite's built-in
minifier keeps builds fast and avoids a separate Terser/compression dependency chain.

Every page-level route is loaded on demand with `React.lazy`. The match-history
controller and views are separate modules, as are the JSON editor's form, domain
model, and validation/upload contracts.

## Tests And Baselines

`npm run test:e2e` performs route-loading smoke checks at desktop and Pixel 7
viewports. `npm run baseline:ui` writes the approved screenshot set and should only
be run when intentionally capturing reviewed baseline evidence.

Biome provides formatting and linting, and strict TypeScript checking is part of
`npm run check`. Automatic pixel-diff approval remains future test-hardening work;
the reviewed Phase 0 images stay immutable.
