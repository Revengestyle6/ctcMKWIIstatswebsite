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

| Service | Why it is used |
| --- | --- |
| Firebase Hosting | Serves the compiled React UI and static media through a CDN, manages TLS/custom domains, and forwards `/api/**` without running application code |
| Firebase Authentication | Gives each administrator an attributable Google identity and ID token; it does not store application data or run Flask |
| Cloud Run | Runs the existing containerized Flask API only when HTTP requests arrive and can scale to zero between requests |
| Cloud SQL | Holds relational application state and supports transactional ingestion, migrations, analytics queries, backups, and point-in-time recovery |
| Cloud Storage | Preserves exact accepted JSON as immutable audit/rebuild input and keeps logical database exports outside the database |
| Secret Manager | Supplies runtime-only credentials and HMAC material without committing secrets or baking them into the container |
| Artifact Registry | Stores the immutable backend container images that Cloud Run deploys |
| GitHub Actions with Workload Identity Federation | Runs verified deployments with short-lived Google credentials instead of service-account keys |

These services are deliberately narrow. Firebase is the browser-facing product
layer, while the Google Cloud services provide the Python runtime and durable data
services that static Hosting cannot provide.
