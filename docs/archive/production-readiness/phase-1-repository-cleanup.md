# Phase 1 Repository Cleanup

## Status

- Completed: July 19, 2026
- Baseline: Phase 0 at commit `03cd3e648ce0e46d9097a327aaf5317ab2fd6a2b`
- Outcome: behavior-preserving cleanup complete; ready for Phase 2

## Repository Cleanup

- Removed 15,511 virtual-environment files from Git tracking while preserving both
  local environments on disk.
- Stopped tracking generated Python caches and the SQLite backup while preserving
  the local backup file.
- Removed tracked IDE state and generated PDF copies.
- Archived the obsolete static website, completed implementation plans, design
  specifications, and historical optimization reports under `docs/archive/`.
- Removed the superseded CSV analytics data and `stats.py`, `find.py`, `extract.py`,
  and scratch `main.py` modules after confirming no runtime imports.
- Moved maintenance commands into `backend/scripts/` and documented their purpose
  and write risk.
- Removed stale Create React App HTML/manifest files, the unused `App.css`, and the
  duplicate source logo.

## Tooling Cleanup

- Removed the redundant root Node package and lockfile. `frontend/` is the sole Node
  package and Tailwind/PostCSS configuration boundary.
- Removed unused Axios and retained native `fetch` as the shared API transport.
- Added Terser explicitly because the Vite configuration selects it directly.
- Removed duplicate CDN Tailwind/font declarations; compiled frontend CSS remains
  unchanged in size and hash.
- Added a dedicated desktop/mobile Playwright route smoke suite.
- Updated the transitional GitHub Pages workflow to Node 22, current checkout/setup
  actions, npm caching, and `npm ci`.
- Removed pandas and NumPy after their only importers—the retired CSV pipeline—were
  deleted.
- Expanded `.dockerignore` to exclude local environments, generated databases,
  caches, documentation, and repository-only tooling from the build context.

## Documentation

- Added a root `README.md` with reproducible setup, run, build, test, and maintenance
  commands.
- Replaced stale CSV-era architecture, backend, frontend, data-pipeline, database,
  deployment, and environment documentation with current SQL-backed descriptions.
- Added archive and maintenance-script indexes so historical material cannot be
  mistaken for current instructions.

## Verification

- 62 backend tests passed.
- All 17 Phase 0 API fixtures matched byte-for-byte after canonicalization.
- TypeScript and the Vite production build passed.
- 20 Playwright smoke tests passed across ten routes in desktop Chromium and Pixel
  7 projects.
- Docker image `ctc-stats:phase1` built successfully.
- The Docker import retained 244 matches, 268 players, 2,868 races, and 28,898
  race-player results.
- Docker `npm ci` succeeded from the frontend lockfile.
- No tracked file is matched by `.gitignore` after the cleanup.

The frontend audit count fell from 10 dependency vulnerabilities in the Phase 0
Docker build to 7 (1 low, 1 moderate, 5 high). Security upgrades that could change
runtime behavior remain separate reviewed work.

## Deliberately Deferred

- `render.yaml`, `railway.json`, `.github/workflows/deploy.yml`, `Dockerfile`, and
  `start.sh` remain as transitional deployment/rollback artifacts until a working
  Cloud Run staging replacement exists.
- The hard-coded Render API fallback remains until same-origin Firebase/Cloud Run
  routing is implemented.
- Large module refactors, route lazy loading, lint/format tooling, component tests,
  and automatic pixel diffs belong to Phase 2.
