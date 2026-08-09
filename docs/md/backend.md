# Backend

The backend is a Flask API backed by SQLAlchemy. It reads analytics from the
operational database; the retired CSV analytics pipeline is historical and no
longer part of the repository.

## Main Modules

- `app.py`: application factory and extension/blueprint registration.
- `routes/public.py`: public analytics and directory reads.
- `routes/admin.py`: upload, health, review, and event-stream operations.
- `routes/reviews.py`: public queue and administrator review decisions.
- `routes/access.py`: authentication session and owner-managed allowlist.
- `routes/operations.py`: liveness, readiness, and safe aggregate health.
- `routes/common.py`: shared request parsing, errors, and write authorization.
- `database.py`: required PostgreSQL URL, engine, and sessions.
- `models.py`: relational models.
- `stats_db.py`: legacy-compatible analytics facade.
- `stats_queries.py`: catalog, identity, match-list, and match-detail queries.
- `dashboard_stats.py`: compatibility facade for structured dashboards.
- `player_dashboard_stats.py` and `team_dashboard_stats.py`: focused dashboard queries.
- `player_role_analytics.py`: runner/bagger classification and metrics.
- `database_health.py`: integrity, catalog, archive, and analytics checks.
- `import_json_to_db.py`: idempotent archive and editor-match ingestion.
- `match_upload.py`: canonical serialization, staging, publishing, and audit logs.
- `archive_storage.py`: local and Cloud Storage archive adapters.
- `media_storage.py`: local and Cloud Storage adapters for public uploaded media.
- `team_logo_management.py`: validated image normalization, season-scoped logo
  activation, and admin serialization.
- `team_identity_management.py`: conventional and season-level team name/tag
  editing, uniqueness validation, and canonical-tag alias preservation.
- `acceptance_service.py`: idempotent database/archive acceptance state machine.
- `phase3_maintenance.py`: queue expiry and archive repair.
- `scripts/`: explicit maintenance and regression commands.

## API Groups

- Scope and directory reads: seasons, divisions, match scopes, team scopes,
  players, teams, tracks, and identities.
- Analytics reads: player, team, track, matchup, match history, and dashboard APIs.
- Editor workflow: public preview/queue submission and administrator acceptance.
- Operations: safe health summaries, administrator health reviews, and bounded
  polling for addition history.

Administrator routes verify Firebase ID tokens and require an active database
allowlist entry. An explicit local/test override is disabled by default.

## Commands

From `backend/`:

```bash
../.venv/bin/python import_json_to_db.py
../.venv/bin/python -m flask --app app run
../.venv/bin/python -m unittest discover -v
../.venv/bin/ruff check .
../.venv/bin/ruff format . --check
../.venv/bin/python scripts/inspect_db.py
../.venv/bin/python scripts/reconcile_json_archive.py
../.venv/bin/python scripts/run_phase3_maintenance.py
```

Use the executable path for your own environment. Script purposes and write risks
are documented in `backend/scripts/README.md`.

## Current Constraints

- CORS is enabled only for local/test split-origin development; hosted environments
  use Firebase Hosting's same-origin API routing.
- Provider IAM, read-only PostgreSQL grants, Firebase configuration, and managed
  secrets are Phase 4 deployment checkpoints.
- Historical SQLite tools are non-executable snapshots under
  `docs/archive/sqlite-retired/`; all schema changes use Alembic.
