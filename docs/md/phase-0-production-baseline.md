# Phase 0 Production Readiness Baseline

## Status

- Captured: July 19, 2026
- Baseline branch: `zach-dev`
- Baseline commit: `03cd3e648ce0e46d9097a327aaf5317ab2fd6a2b`
- Phase status: Complete

## Outcome

The current backend tests, frontend production build, and Docker build pass. The
working SQLite database passes integrity and foreign-key checks and contains no
critical database-health findings.

The initial Phase 0 capture found a reproducibility gap: a clean JSON/registry
rebuild created 273 players, while the working database contained 268. All 291
friend codes were present in both databases, but five pairs were grouped
differently. The owner confirmed all five historical merges, they were added to
`player_identities.csv`, and a second clean rebuild matched all 268 player identity
partitions exactly.

## Executable Checks

### Backend

Command:

```bash
cd backend
../.venv-wsl/bin/python -m unittest discover -v
```

Result:

- 62 tests passed.
- 0 failures and 0 errors.
- Runtime: approximately 1.6 seconds.

Coverage is concentrated on role analytics, dashboard contracts, health reporting,
JSON import role inference, and legacy/API delegation. There is no coverage report,
PostgreSQL integration suite, or end-to-end browser suite yet.

### Frontend

Command:

```bash
cd frontend
npm run build
```

Result:

- TypeScript compilation passed.
- Vite production build passed.
- 64 modules transformed.
- Main application chunk: 375.08 KB, 99.16 KB gzip.
- Vendor chunk: 46.66 KB, 16.30 KB gzip.
- CSS: 35.24 KB, 7.19 KB gzip.

Observed gaps:

- The repository began Phase 0 without frontend tests. The new Playwright harness
  covers route loading and baseline capture, but there are still no component/unit
  tests or automatic pixel-diff assertions.
- No lint or format-check command.
- Browser compatibility data is seven months old.
- The main application is eagerly bundled into one relatively large route chunk.

The React performance guidance makes route-level code splitting a Phase 2 priority,
but it is not applied during baseline capture.

### Docker

Command:

```bash
docker build -t ctc-stats:phase0 .
```

Result:

- Image build passed.
- Frontend and backend dependencies installed successfully.
- Frontend production build passed inside Docker.
- JSON import completed with 244 matches.
- Build context was approximately 444 MB.
- `npm ci` reported 10 dependency vulnerabilities: 1 low, 2 moderate, and 7 high.
- The image rebuild produced 273 players rather than the working database's 268.

Post-identity-resolution verification:

- Rebuilt `ctc-stats:phase0-resolved` successfully on July 19, 2026.
- The in-image import completed with 244 matches, 268 players, 291 friend codes,
  2,868 races, and 28,898 race-player results.
- The earlier 273-player Docker discrepancy is resolved by the approved identity
  registry entries.

The current Docker image is a successful development artifact, not yet a safe
production architecture: it installs Node in the Python runtime image, builds the
database into the image, runs package installation as root, and copies a frontend
build that Flask does not serve.

## Database Snapshot

| Metric | Baseline |
| --- | ---: |
| Database size | 3,952,640 bytes |
| SQLite integrity check | `ok` |
| Foreign-key violations | 0 |
| Seasons | 3 |
| Divisions | 10 |
| Source files | 244 |
| Matches | 244 |
| Teams | 41 |
| Players | 268 |
| Friend codes | 291 |
| Tracks | 195 |
| Races | 2,868 |
| Race player results | 28,898 |
| Penalties | 93 |
| Total health-dashboard records | 38,895 |

Health status:

- Overall status: warning.
- Critical entity count: 0.
- Warning entity count: 36.
- Active issue cards captured: 15, comprising 14 warnings and 1 informational
  analytics-exclusion finding.
- Dismissed findings: 10.
- Matches needing review: 0.

The machine-readable counts, issue keys, archive fingerprint, and registry hashes
are in `docs/baselines/phase-0-2026-07-19/database-summary.json`.

## Resolved Rebuild Reproducibility Gap

The clean rebuild split these working identities into separate players:

| Working canonical player | Friend codes grouped in working DB | Clean rebuild identities |
| --- | --- | --- |
| Ivan | `4043-2944-1210`, `3871-5056-8304` | Ivan + Ivan |
| kyzui | `1938-7576-8064`, `2926-6126-9292` | kyzui + SIX FIVE HTN |
| Flavian | `1981-7080-7744`, `3098-4111-1001` | Flavian + Flavian |
| scuttlebug | `3141-3583-8311`, `5031-1476-0709` | scuttlebug + Parvati Shallow |
| season | `4816-3694-6844`, `3012-5129-6240` | season + season |

No friend codes were missing from either database. The question was identity
grouping, not record loss. On July 19, 2026, the owner confirmed all five groups and
the mappings were added to `player_identities.csv`.

The original detailed comparison is stored in
`docs/baselines/phase-0-2026-07-19/identity-rebuild-comparison.json`. The resolved
comparison is stored in `identity-rebuild-resolved.json` and shows 268 players, 291
friend codes, no partition differences, and no missing codes.

## API Contract Fixtures

Seventeen read-only fixtures cover:

- Seasons, divisions, match scopes, and team scopes.
- Season 3 Division 1 players, teams, tracks, and match history.
- Match detail for match ID 222.
- Runner overview, performance, and track analytics for player ID 180.
- Overview, runner roster, and track analytics for team ID 41.
- A populated runner track-ranking response.
- Database health without archive reconciliation.

Each fixture is canonical JSON. The manifest records its endpoint, HTTP status, size,
and SHA-256. These fixtures are regression evidence, not permanent API golden tests
yet; Phase 2 should turn stable contracts into automated comparisons that allow
explicitly approved changes.

## Repository Baseline

- Tracked files: 16,563.
- Files currently both tracked and ignored: 15,529.
- Root virtual environment: 9,781 tracked files.
- Ignored tracked content under `backend/`: 5,737 files.
- Current deployment definitions span GitHub Pages, Render, Railway, and Docker.
- Live frontend API fallback points to Render.
- Legacy CSV modules have no active Flask import path.

The approved disposition for each category is documented in
`repository-cleanup-inventory.md`. No cleanup deletion was performed in Phase 0.

## UI Screenshot Baseline

Playwright now captures the following routes at a 1440-pixel desktop viewport and a
Pixel 7 mobile viewport:

- Home/dashboard.
- Player dashboard.
- Team dashboard.
- Match history.
- Player statistics legacy page.
- Team statistics legacy page.
- Track averages.
- Team matchups.
- JSON editor.
- Database health dashboard.

Result:

- 20 screenshots captured successfully.
- Two Playwright project runs passed.
- Captures total approximately 4 MB.
- The music opt-in prompt is dismissed before each capture.
- CSS animations are disabled during the screenshot operation.

The files are stored under `docs/baselines/phase-0-2026-07-19/ui/`. This is a
capture harness rather than pixel-diff assertions; Phase 2 can promote selected
screenshots to automatic visual comparisons after determining an acceptable
cross-platform tolerance.

## Accepted Architecture Records

- ADR 0001 accepts Firebase Hosting and Cloud Run.
- ADR 0002 accepts Cloud SQL PostgreSQL and Cloud Storage.
- ADR 0003 accepts Firebase Authentication for administrator actions.

All three ADRs were accepted on July 19, 2026. No cloud resource has been created.

## Owner Decisions

Resolved July 19, 2026:

1. Accepted Firebase Hosting, Cloud Run, Cloud SQL, Cloud Storage, and Firebase
   Authentication.
2. Selected `us-central1`, request-based Cloud Run billing with zero minimum
   instances, and a Firebase staging subdomain.
3. Accepted a best-effort, no-formal-SLA launch configuration using a single-zone
   `db-f1-micro` Cloud SQL Enterprise PostgreSQL 18 instance with 10 GB SSD.
4. Selected seven retained daily automated backups and seven days of point-in-time
   recovery logs.
5. Confirmed all five historical identity groups and added them to the durable
   registry.
6. Approved the Phase 1 cleanup dispositions in
   `repository-cleanup-inventory.md`.

## Phase 0 Exit Checklist

- [x] Record current Git baseline.
- [x] Run complete discovered backend tests.
- [x] Run frontend type-check and production build.
- [x] Run current Docker build.
- [x] Capture representative API fixtures.
- [x] Capture table counts, integrity, health keys, archive hash, and registry hashes.
- [x] Test a clean rebuild in a disposable database.
- [x] Document the clean-rebuild identity discrepancy.
- [x] Produce keep/remove/archive cleanup inventory.
- [x] Draft architecture decision records.
- [x] Receive owner architecture/region/domain/availability/retention decisions.
- [x] Review the five missing identity-registry groupings.
- [x] Capture managed desktop and mobile UI screenshots.
- [x] Add confirmed identities and verify a clean 268-player rebuild.
