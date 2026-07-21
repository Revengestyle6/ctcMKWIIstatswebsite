# CTC Mario Kart Wii Statistics

React and Flask application for Custom Track Cup match history, player, team, and
track analytics. Archived Table Bot JSON is the durable input record; SQLAlchemy
provides the operational analytics model.

## Prerequisites

- Python 3.11
- Node.js 22 and npm
- Playwright Chromium only when running browser smoke tests
- Docker Desktop or Docker Engine with Compose for local PostgreSQL

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

Start PostgreSQL 18, apply the schema, and load the archived JSON and reviewed
registries:

```bash
docker compose up -d postgres
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
.venv/bin/alembic upgrade head
.venv/bin/python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

Use the appropriate virtual-environment executable on Windows or when your local
environment has a different path. The credentials above are intentionally local
development values, not production secrets. Stop the database with
`docker compose stop postgres`; its ignored named volume preserves local data.

PostgreSQL is required for local development and tests. Historical SQLite files
remain ignored under `backend/data/` as recovery artifacts only; active code does
not open them.

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
`http://127.0.0.1:5000`. Hosted builds use same-origin `/api` requests by default.

## Verification

```bash
cd backend
../.venv/bin/ruff check .
../.venv/bin/ruff format . --check
../.venv/bin/python -m unittest discover -v
cd ../frontend
npm run check
npm run build
PYTHON_BIN=../.venv/bin/python npm run test:e2e
```

Install the Playwright browser once with `npx playwright install chromium`.

The browser smoke command covers ten representative routes in desktop and mobile
Chromium. `npm run baseline:ui` is reserved for deliberate baseline capture and
must not be used to approve visual changes without reviewing the images.

CI starts a clean PostgreSQL 18 service, applies and drift-checks the Alembic
schema, imports the accepted archive, and runs every backend test against isolated
PostgreSQL schemas.

## Common Maintenance Commands

Run commands from `backend/` unless noted otherwise:

```bash
../.venv/bin/python scripts/inspect_db.py
../.venv/bin/python scripts/reconcile_json_archive.py
../.venv/bin/python scripts/run_phase3_maintenance.py
../.venv/bin/python scripts/convert_txt_json.py --help
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
