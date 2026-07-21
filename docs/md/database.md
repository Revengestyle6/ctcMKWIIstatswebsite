# Analytics Database

SQLAlchemy models provide the operational analytics schema. PostgreSQL is the only
supported database for development, tests, and production.

## Files

- `backend/database.py`: PostgreSQL URL validation, normalization, bounded pooling,
  and sessions.
- `backend/models.py`: relational schema.
- `backend/import_json_to_db.py`: idempotent archive ingestion into a migrated schema.
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

`DATABASE_URL` is mandatory. Non-PostgreSQL URLs fail immediately in every
environment. Alembic owns schema creation; neither application startup nor the
importer creates or deletes schemas.

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

Phase 3 adds Psycopg, Alembic, the local PostgreSQL service,
administrator/review/archive state, and PostgreSQL integration coverage. CI verifies
a clean migration, checks for model/schema drift, imports the authoritative archive,
and runs the suite in disposable PostgreSQL schemas. Frozen Phase 0 fixtures remain
historical review evidence and are not silently re-recorded.

Staging and production will be rebuilt from the authoritative JSON and registries.
