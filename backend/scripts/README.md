# Backend Maintenance Scripts

Run these commands from `backend/` with the project Python environment.

| Script | Purpose | Writes data? |
| --- | --- | --- |
| `convert_txt_json.py` | Convert archived `.txt` JSON payloads to formatted `.json` files | Yes; use `--overwrite` cautiously |
| `inspect_db.py` | Print database counts and review rows | No |
| `reconcile_json_archive.py` | Compare the JSON archive with imported source rows | No |
| `bootstrap_owner.py` | Create or restore the first allowlisted application owner | Yes |
| `run_phase3_maintenance.py` | Expire queue objects and repair accepted archive promotion | Yes |

All database commands require PostgreSQL through `DATABASE_URL` or their explicit
`--database-url` option. Never run a write-capable script against staging or
production merely by inheriting a shell environment; inspect its options first.

Historical SQLite and Phase 0 baseline utilities are retained as non-executable
source snapshots in `docs/archive/sqlite-retired/`.
