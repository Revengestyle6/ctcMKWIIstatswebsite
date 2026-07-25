# Regression Baselines

This directory contains snapshots used to detect unintended changes during the
production-readiness cleanup and refactor.

## Phase 0 Baseline

The July 19, 2026 baseline contains:

- Canonical JSON responses from 17 representative read-only API requests.
- A manifest with endpoint, status, byte size, and SHA-256 for each fixture.
- SQLite integrity and foreign-key results.
- Counts for every SQLAlchemy table.
- Database-health status and stable issue keys.
- A fingerprint of the archived JSON tree and identity/normalization registries.
- A comparison between the working player identity partition and a clean rebuild.
- A post-approval verification showing that the confirmed identity registry produces
  exactly the working 268-player partition.
- Desktop and mobile screenshots for ten representative application routes.

The health response replaces its capture timestamp and absolute local database path
with placeholders. Other data is preserved so regressions remain visible.

## Capture Command

From `backend/`:

```bash
../.venv-wsl/bin/python scripts/capture_phase0_baseline.py
```

The script is deliberately read-only with respect to the working database. It also
removes `DATABASE_URL` from its own process before importing the application so a
developer cannot accidentally snapshot staging or production.

To reproduce and compare player identities without overwriting the working database:

```bash
../.venv-wsl/bin/python import_json_to_db.py \
  --db /tmp/ctc_phase0_rebuild.sqlite \
  --rebuild

../.venv-wsl/bin/python scripts/compare_identity_partitions.py \
  data/ctc_stats.sqlite \
  /tmp/ctc_phase0_rebuild.sqlite
```

Do not automatically replace baseline fixtures after a refactor. Review the semantic
diff first. Update a fixture only when the changed behavior is intentional and
documented.

## UI Capture Command

Install the Playwright Chromium runtime once:

```bash
cd frontend
npx playwright install chromium
```

Then capture the UI baseline with the local API and Vite server managed by
Playwright:

```bash
PYTHON_BIN=../.venv-wsl/bin/python npm run baseline:ui
```

Use a different `PYTHON_BIN` when the virtual environment lives elsewhere. The
capture covers ten routes in desktop and Pixel 7 viewports, dismisses the music
prompt, disables CSS animations during capture, and writes approved JPEGs under the
dated baseline's `ui/` directory.
