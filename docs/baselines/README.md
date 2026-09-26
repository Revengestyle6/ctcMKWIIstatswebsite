# Regression baselines

`phase-0-2026-07-19/` preserves the approved historical baseline: 17 API responses,
archive/registry fingerprints, SQLite-era table and integrity evidence, identity
partition comparisons, and desktop/mobile screenshots for ten routes. These files
are evidence from that date, not assertions that today's expanded product has the
same schema, counts, or presentation.

Do not replace baseline fixtures to make an unintended change pass. Normal
verification uses the current PostgreSQL tests and browser smoke suite in
[CONTRIBUTING](../../CONTRIBUTING.md).

## Historical capture tooling

The original SQLite capture and comparison utilities are retained as
[non-executable source snapshots](../archive/sqlite-retired/README.md). Their old
`--db`/`--rebuild` examples are not supported PostgreSQL commands. Rebuild a current
disposable database with Alembic and the importer described in
[local setup](../development/local-development-startup.md).

## Deliberate UI capture

The current Playwright capture file is
[capture-baseline.spec.ts](../../frontend/e2e/capture-baseline.spec.ts). Install
Chromium once, configure a local database/API, then from `frontend/` run:

```bash
npx playwright install chromium
PYTHON_BIN=../.venv/bin/python npm run baseline:ui
```

This command writes into the dated baseline directory. Review every changed image
before accepting new evidence. It is deliberately separate from `npm run test:e2e`
and does not approve visual changes automatically.
