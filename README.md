# Mario Kart Wii statistics

A React and Flask application for CTC and GSC match history, standings, and player,
team, and track analytics. The JSON editor prepares and validates matches; public
submissions enter an administrator review queue. PostgreSQL holds operational
state and accepted JSON provides durable audit/rebuild evidence.

**The hosted application is still in staging.** See the
[production gates](docs/roadmap/README.md) for remaining operational work.

## Start here

| Need | Guide |
| --- | --- |
| Run the project | [Complete local setup](docs/development/local-development-startup.md) |
| Understand the whole repo | [Repository map](docs/architecture/repository-map.md) and [architecture diagrams](docs/architecture/README.md) |
| Understand the domain | [Competition and identity glossary](CONTEXT.md) |
| Work on the JSON editor | [Editor documentation](docs/json-editor/README.md): workflow, validations, data sources and JSON compilation |
| Make and verify a change | [Contributing](CONTRIBUTING.md) |
| Find a runbook or feature guide | [Documentation index](docs/README.md) |

## Local quick start

Requires Python 3.11, Node.js 22/npm, and Docker with Compose for PostgreSQL 18.
From the repository root:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
npm ci
npm ci --prefix frontend
docker compose up -d postgres
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
export FIREBASE_PROJECT_ID=mkw-stats
alembic upgrade head
python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

Wait for `docker compose ps postgres` to report healthy before migrating. The
credentials above are local development defaults. Importing historical data is a
setup operation, not a normal startup step.

In one terminal, activate the environment, export the variables above, and run:

```bash
cd backend
python -m flask --app app run
```

In another terminal, from the repository root:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`. Vite proxies `/api` to Flask on port 5000. Real Google
sign-in needs the public Firebase web configuration described in the
[local setup runbook](docs/development/local-development-startup.md). Use the Python
executable/activation path appropriate to your operating system.

## Verification and maintenance

[CONTRIBUTING](CONTRIBUTING.md#required-end-of-work-ci-validation) lists the required
migration, drift, archive import, backend, frontend, and production-build checks
against a disposable PostgreSQL database. Browser regressions additionally run with:

```bash
cd frontend
PYTHON_BIN=../.venv/bin/python npm run test:e2e
```

Install Chromium once with `npx playwright install chromium`. Set `APP_ENV=test`
and `DATABASE_URL` to a local disposable database for browser checks; the Playwright
configuration can reuse existing servers on ports 5000/4173, so ensure those are
your intended test processes. Baseline capture is a separate deliberate action,
documented in [regression evidence](docs/baselines/README.md).

See the [maintenance command catalog](backend/scripts/README.md) before running
commands that write archive or database state. Deployment follows the
[staging workflow](docs/operations/deployment.md); production cutover remains separate.
