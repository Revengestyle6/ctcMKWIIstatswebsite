# Backend

The backend is a Flask API backed by SQLAlchemy. It reads analytics from the
operational database; the retired CSV analytics pipeline is historical and no
longer part of the repository.

## Main Modules

- `app.py`: application factory and extension/blueprint registration.
- `routes/public.py`: public analytics and directory reads.
- `routes/admin.py`: upload, health, review, and event-stream operations.
- `routes/common.py`: shared request parsing, errors, and write authorization.
- `database.py`: database URL, engine, sessions, and SQLite pragmas.
- `models.py`: relational models.
- `stats_db.py`: legacy-compatible analytics facade.
- `stats_queries.py`: catalog, identity, match-list, and match-detail queries.
- `dashboard_stats.py`: compatibility facade for structured dashboards.
- `player_dashboard_stats.py` and `team_dashboard_stats.py`: focused dashboard queries.
- `player_role_analytics.py`: runner/bagger classification and metrics.
- `database_health.py`: integrity, catalog, archive, and analytics checks.
- `import_json_to_db.py`: rebuild and editor-match ingestion.
- `match_upload.py`: canonical serialization, staging, publishing, and audit logs.
- `scripts/`: explicit maintenance and regression commands.

## API Groups

- Scope and directory reads: seasons, divisions, match scopes, team scopes,
  players, teams, tracks, and identities.
- Analytics reads: player, team, track, matchup, match history, and dashboard APIs.
- Editor workflow: preview, new-entry review, and commit.
- Operations: database health, health reviews, addition history, and SSE updates.

Public production reads and administrator-only operational details will be split
during the authentication phase. Current local mutation protection uses an optional
`MATCH_UPLOAD_TOKEN`.

## Commands

From `backend/`:

```bash
../.venv/bin/python import_json_to_db.py --rebuild
../.venv/bin/python -m flask --app app run
../.venv/bin/python -m unittest discover -v
../.venv/bin/python scripts/compare_phase0_api.py
../.venv/bin/ruff check .
../.venv/bin/ruff format . --check
../.venv/bin/python scripts/inspect_db.py
../.venv/bin/python scripts/reconcile_json_archive.py
```

Use the executable path for your own environment. Script purposes and write risks
are documented in `backend/scripts/README.md`.

## Current Constraints

- SQLite-specific health queries need PostgreSQL implementations.
- CORS is permissive and production authentication is not implemented yet.
- PostgreSQL, migrations, durable archive storage, and production error/request
  logging are Phase 3 work.
