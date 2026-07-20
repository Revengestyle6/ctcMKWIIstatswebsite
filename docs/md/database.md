# Analytics Database

SQLAlchemy models provide the operational analytics schema. SQLite is supported for
local development and selected tests; Cloud SQL PostgreSQL is the accepted
production target.

## Files

- `backend/database.py`: environment validation, URL normalization, engines,
  bounded PostgreSQL pooling, sessions, and SQLite pragmas.
- `backend/models.py`: relational schema.
- `backend/import_json_to_db.py`: rebuild and ingestion behavior.
- `alembic.ini` and `backend/migrations/`: versioned schema ownership.
- `compose.yaml`: local PostgreSQL 18 service and persistent development volume.
- `backend/data/`: reviewed registries; generated database files are ignored.
- `backend/scripts/inspect_db.py`: read-only count and review summary.

## Local PostgreSQL

From the repository root:

```bash
docker compose up -d postgres
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
.venv/bin/alembic upgrade head
.venv/bin/python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

The service publishes port `55432` by default so it does not take the conventional
local PostgreSQL port. Override the host port with `POSTGRES_PORT`. The
`ctc-postgres-data` volume persists until it is explicitly removed; normal
`docker compose stop` and `docker compose down` do not delete it.

Alembic owns every PostgreSQL schema change. Application startup never creates
PostgreSQL tables. Run `alembic upgrade head` before starting the API against a new
database and `alembic check` after model changes. The frozen
`20260719_0001_current_schema` revision reproduces the Phase 2 schema.

## SQLite Compatibility Rebuild

From `backend/`:

```bash
../.venv/bin/python import_json_to_db.py --rebuild
../.venv/bin/python scripts/inspect_db.py
```

The default database is `backend/data/ctc_stats.sqlite`. Override it with `--db`
for importer/maintenance commands or `DATABASE_URL` for normal application
sessions. `--rebuild` and `--repair-inferred-roles` remain SQLite-only maintenance
operations. Baseline tools deliberately ignore inherited `DATABASE_URL` values.

## Phase 0 Verified Counts

| Entity | Count |
| --- | ---: |
| Seasons | 3 |
| Divisions | 10 |
| Source files / matches | 244 |
| Teams | 41 |
| Players | 268 |
| Friend codes | 291 |
| Tracks | 195 |
| Races | 2,868 |
| Race-player results | 28,898 |
| Penalties | 93 |

The clean registry rebuild matches the working identity partition exactly.

## Phase 3 Verification

Phase 3 adds PostgreSQL configuration, Psycopg, Alembic, the local service,
administrator/review/archive state, and CI integration coverage. CI verifies a
clean migration, checks for model/schema drift, imports the authoritative archive,
runs a PostgreSQL acceptance workflow, and compares all 16
portable API responses exactly between clean SQLite and PostgreSQL databases. Six
data-independent Phase 0 fixtures are also checked directly. The other frozen
fixtures contain numeric IDs and incremental database history that a clean archive
rebuild cannot reproduce; they remain review evidence and are not silently
re-recorded. Detailed health is administrator-only and dialect-aware; public data
health exposes only safe aggregate freshness state.

Staging and production will be rebuilt from the authoritative JSON and registries
rather than copied from SQLite. Setting `APP_ENV=staging` or `APP_ENV=production`
with a missing or SQLite database URL fails immediately.
