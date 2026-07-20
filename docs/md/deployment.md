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

## Current Docker Artifact

The current image contains only the Python API, installs dependencies in a cacheable
layer, rebuilds the regression SQLite database, and runs Gunicorn as the unprivileged
`app` user. Removing unused Node/frontend runtime content reduced the local image
from 269.2 MB in Phase 1 to 70.7 MB in Phase 2. The final Cloud Run image will not
build production data into the image.

Build the current regression artifact from the repository root:

```bash
docker build -t ctc-stats:phase2 .
```

## Local Development

Use the root `README.md`. Flask listens on port 5000 and Vite on port 3000. The Vite
proxy forwards `/api` to Flask.

No cloud resources are provisioned during repository cleanup.
