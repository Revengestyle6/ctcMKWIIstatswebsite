# Current Architecture

## Repository Boundaries

```text
frontend/               React 19, TypeScript, Vite, Tailwind, Playwright
backend/                Flask API, SQLAlchemy analytics, JSON ingestion
backend/JSON/           authoritative historical match archive
backend/data/           reviewed registries; retained SQLite recovery artifacts are ignored
backend/scripts/        explicit maintenance and regression commands
docs/adr/               accepted production architecture decisions
docs/baselines/         Phase 0 API, database, identity, and UI evidence
docs/archive/           historical material only
```

## Current Local Request Flow

1. Vite serves the React application and public media.
2. React calls the shared client in `frontend/src/api.ts`.
3. During local development, Vite proxies `/api` to Flask on port 5000.
4. Flask registers separate public and administrative route blueprints.
5. Shared route helpers validate request parameters and authorization.
6. Focused catalog, match, player-dashboard, and team-dashboard modules read
   through SQLAlchemy sessions.
7. Flask returns structured JSON for the UI.

The frontend uses same-origin `/api` requests by default. Local or intentionally
split deployments can override the origin with `VITE_API_URL`.

## Data Ownership

- Archived JSON is the immutable input and audit record.
- Reviewed CSV/JSON registries define player identity, team normalization, and
  analytics exclusions. Health reviews are durable database records.
- PostgreSQL is the sole supported operational database in every environment.
- Retained SQLite files are recovery artifacts and are never opened by active code.
- Git stores code, migrations, documentation, registries, and the historical JSON
  archive until durable object storage is implemented.

## Match Upload Flow

The JSON editor compiles and previews a canonical document. Anonymous users may
submit it to a temporary review queue without changing analytics. An allowlisted
Firebase administrator reviews it and uses the single acceptance service, which
commits PostgreSQL first and then promotes the exact canonical bytes to immutable
local/GCS archive storage. Audit and repair state are durable.

## Accepted Production Target

Firebase Hosting will serve the frontend and rewrite `/api/**` to Cloud Run. Cloud
Run will use Cloud SQL PostgreSQL and Cloud Storage. Firebase Authentication will
protect administrator actions. See `docs/adr/` for the accepted decisions.
