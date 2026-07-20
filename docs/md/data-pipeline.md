# Data Pipeline

## Authoritative Inputs

Match documents live under:

```text
backend/JSON/{league}/{season}/{division}/{match}.json
```

Reviewed registries under `backend/data/` preserve decisions that raw match files
cannot express reliably:

- `player_identities.csv`
- `team_aliases.csv`
- `analytics_excluded_race_blocks.json`
- `database_health_reviews.json`

The archived source and registries must be preserved during every rebuild.

## Rebuild Flow

```text
archived JSON + reviewed registries
              |
              v
     import_json_to_db.py
              |
              v
 SQLAlchemy operational database
              |
              v
 Flask analytics and dashboard APIs
```

Run a local rebuild from `backend/`:

```bash
../.venv/bin/python import_json_to_db.py --rebuild
```

The importer prefers `.json` over a same-stem legacy `.txt`, fingerprints source
files, resolves identities and team aliases, stores raw audit fields, expands races
and results, preserves explicit roles, and records findings that require review.

## Editor Upload Flow

1. The browser compiles deterministic scores, totals, and canonical JSON.
2. The preview endpoint validates the document and proposes new catalog entries.
3. The reviewer approves allowable entries.
4. The commit endpoint repeats validation and duplicate checks.
5. The backend stages exact JSON bytes, imports normalized rows in one SQL
   transaction, publishes the archive file, and records addition logs.
6. Archive reconciliation detects interrupted or inconsistent local uploads.

Cloud Storage and an explicit cross-system upload state machine will replace local
archive publishing for production.

## Regression Checks

The Phase 0 evidence contains table counts, archive and registry fingerprints, 17
API fixtures, identity comparisons, and UI screenshots. Use
`scripts/compare_phase0_api.py` after behavior-preserving cleanup. Never replace an
approved fixture merely to make a changed response pass.

The old flattened `backend/CSV/` analytics pipeline was removed in Phase 1 after
tests and every API fixture matched the SQL-backed implementation.
