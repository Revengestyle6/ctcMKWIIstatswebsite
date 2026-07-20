# Analytics Database

SQLAlchemy models provide the operational analytics schema. SQLite is supported for
local development and selected tests; Cloud SQL PostgreSQL is the accepted
production target.

## Files

- `backend/database.py`: URL, engine, sessions, and SQLite pragmas.
- `backend/models.py`: relational schema.
- `backend/import_json_to_db.py`: rebuild and ingestion behavior.
- `backend/data/`: reviewed registries; generated database files are ignored.
- `backend/scripts/inspect_db.py`: read-only count and review summary.

## Local Rebuild

From `backend/`:

```bash
../.venv/bin/python import_json_to_db.py --rebuild
../.venv/bin/python scripts/inspect_db.py
```

The default database is `backend/data/ctc_stats.sqlite`. Override it with `--db`
for importer/maintenance commands or `DATABASE_URL` for normal application
sessions. Baseline tools deliberately ignore inherited `DATABASE_URL` values.

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

## Production Migration

Phase 3 will add Alembic, a PostgreSQL driver, portable health queries, connection
configuration, and PostgreSQL integration tests. Staging and production will be
rebuilt from the authoritative JSON and registries rather than copied from SQLite.
