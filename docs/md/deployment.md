# Deployment

## Accepted Target

- Firebase Hosting: React build, CDN, TLS, and `/api/**` rewrite.
- Cloud Run: Flask API with request-based billing and zero minimum instances.
- Cloud SQL: PostgreSQL 18 on the initial cost-first `db-f1-micro` configuration.
- Cloud Storage: immutable archived JSON and database exports.
- Firebase Authentication: Google sign-in for administrator actions.
- GitHub Actions: Workload Identity Federation for deployment credentials.

See `docs/adr/` for accepted decisions and constraints.

## Transitional Files

`render.yaml`, `railway.json`, `.github/workflows/deploy.yml`, `Dockerfile`, and
`start.sh` remain temporarily because they describe the currently reproducible or
rollback deployment paths. They must not be removed until Cloud Run staging and its
replacement workflow work. They are not the production target.

## Phase 3 Docker Artifact

The image contains only the Python API and runtime adapters, installs dependencies
in a cacheable layer, and runs Gunicorn as the unprivileged `app` user. It excludes
the frontend, tests, historical JSON, and generated databases. Image construction
never migrates or imports a database; those are explicit deployment jobs.

Build the current regression artifact from the repository root:

```bash
docker build -t ctc-stats:phase3 .
```

## Local Development

Use the root `README.md`. Flask listens on port 5000 and Vite on port 3000. The Vite
proxy forwards `/api` to Flask.

No cloud resources are provisioned during repository cleanup.
