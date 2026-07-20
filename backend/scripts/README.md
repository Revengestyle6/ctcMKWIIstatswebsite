# Backend Maintenance Scripts

Run these commands from `backend/` with the project Python environment.

| Script | Purpose | Writes data? |
| --- | --- | --- |
| `capture_phase0_baseline.py` | Capture approved API/database regression evidence | Yes, under `docs/baselines/` |
| `compare_phase0_api.py` | Compare current API responses with Phase 0 fixtures | No |
| `compare_identity_partitions.py` | Compare friend-code identity partitions in two SQLite databases | Only with `--output` |
| `convert_txt_json.py` | Convert archived `.txt` JSON payloads to formatted `.json` files | Yes; use `--overwrite` cautiously |
| `inspect_db.py` | Print database counts and review rows | No |
| `merge_player_identities.py` | Apply the reviewed identity registry to an existing SQLite database | Yes; creates a backup unless `--no-backup` |
| `reconcile_json_archive.py` | Compare the JSON archive with imported source rows | No |

Prefer a disposable database for rebuild or identity experiments. Never run a
write-capable script against staging or production merely by inheriting a shell
environment; inspect its options and target path first.
