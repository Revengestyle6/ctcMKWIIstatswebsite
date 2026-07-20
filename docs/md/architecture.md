# Current Architecture

## Repository Boundaries

```text
frontend/               React 19, TypeScript, Vite, Tailwind, Playwright
backend/                Flask API, SQLAlchemy analytics, JSON ingestion
backend/JSON/           authoritative historical match archive
backend/data/           reviewed registries; generated SQLite is ignored
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

The current frontend retains a temporary Render fallback in `api.ts`. Same-origin
`/api` requests are the accepted production direction and will replace it before
Firebase Hosting cutover.

## Data Ownership

- Archived JSON is the immutable input and audit record.
- Reviewed CSV/JSON registries define player identity, team normalization,
  analytics exclusions, and health-review decisions.
- SQLite is generated local/test state.
- PostgreSQL will be the production operational database.
- Git stores code, migrations, documentation, registries, and the historical JSON
  archive until durable object storage is implemented.

## Match Upload Flow

The JSON editor compiles and previews a canonical document. Flask revalidates the
preview, stages the archive file, imports all normalized database rows in one SQL
transaction, publishes the staged file, and records addition logs. Local writes can
be protected by `MATCH_UPLOAD_TOKEN`; Firebase administrator authentication and
Cloud Storage are planned production changes.

## Accepted Production Target

Firebase Hosting will serve the frontend and rewrite `/api/**` to Cloud Run. Cloud
Run will use Cloud SQL PostgreSQL and Cloud Storage. Firebase Authentication will
protect administrator actions. See `docs/adr/` for the accepted decisions.
