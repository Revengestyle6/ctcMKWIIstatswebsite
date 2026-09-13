# Project Instructions

## Required end-of-work CI validation

Treat `.github/workflows/ci-staging.yml` as the authoritative CI definition. After every change, run all of the local CI checks below before considering the work complete. Do not rely on CI to discover formatting, lint, type, test, migration, import, or build failures.

Use Python 3.11, Node.js 22, and a disposable PostgreSQL 18 database with the same test environment used by CI:

```bash
export APP_ENV=test
export DATABASE_URL=postgresql+psycopg://ctc_test:ctc_test@127.0.0.1:5432/ctc_test
export TEST_DATABASE_URL="$DATABASE_URL"
```

### 1. Database migration and import checks

Start from a clean/disposable PostgreSQL test database, then verify that migrations apply, Alembic detects no schema drift, and the archived data imports successfully:

```bash
alembic upgrade head
alembic check
python backend/import_json_to_db.py
```

These commands catch invalid migrations, model/schema drift, and importer regressions before the application tests run.

### 2. Backend lint and formatting checks

From the repository root, run:

```bash
ruff check backend
ruff format backend --check
```

If lint errors are safely auto-fixable, run `ruff check backend --fix`; otherwise correct them manually. If formatting fails, run `ruff format backend`. Always rerun both check commands afterward and ensure both pass.

### 3. Backend unit and integration tests

Run the complete backend test discovery against the disposable PostgreSQL database:

```bash
cd backend
python -m unittest discover -v
cd ..
```

Do not substitute a targeted test run for this final full suite.

### 4. Frontend formatting, lint, and type checks

Run the same combined check as CI:

```bash
npm run check --prefix frontend
```

This runs `biome check .` followed by `tsc --noEmit`. If Biome reports formatting problems, run `npm run format --prefix frontend`; fix any remaining lint or TypeScript errors manually. Rerun `npm run check --prefix frontend` until it passes.

### 5. Frontend production build

Verify the production TypeScript and Vite build separately, as CI does:

```bash
npm run build --prefix frontend
```

The check command alone is not sufficient because it does not exercise Vite's production bundle.

### 6. Completion rule

Report which checks ran and their results when handing work back. If a check cannot run because PostgreSQL, dependencies, credentials, or another required service is unavailable, clearly identify that check as not run and explain why; never describe the work as fully validated.

### Staging-only checks performed by CI

On pushes to `main` or manual workflow runs, CI also builds an immutable backend container, runs the staging migration job, deploys that exact image digest to Cloud Run, verifies the deployed digest, builds and deploys Firebase Hosting, and probes these endpoints:

```text
/api/health/ready
/api/health/data
/
```

These deployment checks require GitHub/OIDC and staging credentials. Do not perform a local or manual staging deployment unless the user explicitly requests it, but account for relevant deployment, migration, health-check, and production-build implications while making changes.
