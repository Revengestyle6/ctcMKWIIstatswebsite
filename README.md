# CTC Mario Kart Wii Statistics

React and Flask application for Custom Track Cup match history, player, team, and
track analytics. Archived Table Bot JSON is the durable input record; SQLAlchemy
provides the operational analytics model.

## Prerequisites

- Python 3.11
- Node.js 22 and npm
- Playwright Chromium only when running browser smoke tests
- Docker Desktop only when building the current container

## Local Setup

Create a Python environment at the repository root:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
```

Install the frontend reproducibly:

```bash
cd frontend
npm ci
```

Build the local SQLite database from the archived JSON and reviewed registries:

```bash
cd backend
../.venv/bin/python import_json_to_db.py --rebuild
```

Use the appropriate virtual-environment executable on Windows or when your local
environment has a different path.

## Run Locally

Start the API from `backend/`:

```bash
../.venv/bin/python -m flask --app app run
```

In another terminal, start the frontend from `frontend/`:

```bash
npm run dev
```

Vite serves the UI at `http://127.0.0.1:3000` and proxies `/api` to Flask at
`http://127.0.0.1:5000`. The current frontend still has a Render fallback when
`VITE_API_URL` is unset; replacing that fallback with same-origin API paths is
scheduled before the Firebase cutover.

## Verification

```bash
cd backend
../.venv/bin/ruff check .
../.venv/bin/ruff format . --check
../.venv/bin/python -m unittest discover -v
../.venv/bin/python scripts/compare_phase0_api.py

cd ../frontend
npm run check
npm run build
PYTHON_BIN=../.venv/bin/python npm run test:e2e
```

Install the Playwright browser once with `npx playwright install chromium`.

The browser smoke command covers ten representative routes in desktop and mobile
Chromium. `npm run baseline:ui` is reserved for deliberate baseline capture and
must not be used to approve visual changes without reviewing the images.

## Common Maintenance Commands

Run commands from `backend/` unless noted otherwise:

```bash
../.venv/bin/python scripts/inspect_db.py
../.venv/bin/python scripts/reconcile_json_archive.py
../.venv/bin/python scripts/convert_txt_json.py --help
../.venv/bin/python scripts/merge_player_identities.py --help
```

See [backend/scripts/README.md](backend/scripts/README.md) before running commands
that write archive or database data.

## Documentation

- [Documentation map](docs/md/README.md)
- [Current architecture](docs/md/architecture.md)
- [Data pipeline](docs/md/data-pipeline.md)
- [Production readiness plan](docs/md/production-readiness-plan.md)
- [Architecture decisions](docs/adr/README.md)
- [Regression baselines](docs/baselines/README.md)
- [Historical documentation](docs/archive/README.md)

Local databases, backups, virtual environments, caches, IDE state, build output,
and Playwright output are intentionally excluded from Git.
