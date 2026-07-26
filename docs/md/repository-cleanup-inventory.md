# Repository Cleanup Inventory

## Status

- Created: July 19, 2026
- Phase: Phase 1 complete
- Baseline commit: `03cd3e648ce0e46d9097a327aaf5317ab2fd6a2b`

This document records the original disposition assigned to questionable repository
content and the safety conditions used during Phase 1.

Execution completed July 19, 2026. See
[`phase-1-repository-cleanup.md`](phase-1-repository-cleanup.md) for results and
verification. Transitional deployment files remain until Cloud Run staging meets
their documented replacement condition.

## Summary

- Tracked files: 16,563
- Tracked files now matched by `.gitignore`: 15,529
- Largest category: root `.venv/` with 9,781 tracked files
- Second largest ignored category: `backend/` with 5,737 tracked files, primarily
  `backend/.venv/` plus generated Python files and one database backup
- Frontend application/assets: 407 tracked files
- Backend application/data/archive: 6,237 tracked files including the virtual env

The Docker build sends approximately 444 MB as build context, largely because local
and historical artifacts are not sufficiently excluded. This should fall sharply
after cleanup and `.dockerignore` correction.

## Remove From Git Tracking

These are generated or workstation-specific and should not remain versioned.

| Path/category | Proposed action | Verification before action |
| --- | --- | --- |
| `.venv/` | Remove from Git tracking; keep ignored | Confirm local environment can be recreated from requirements |
| `backend/.venv/` | Remove from Git tracking; keep ignored | Confirm no scripts reference executables inside it |
| root and backend `__pycache__/` | Remove from Git tracking | None beyond existing ignore rules |
| `.idea/` | Remove from Git tracking | Confirm no team-required run configuration is stored only here |
| `.vscode/` | Remove or replace with an intentional shared settings subset | Review its single tracked file |
| tracked SQLite backup in `backend/data/` | Remove from Git tracking and store backups outside Git | Confirm current database and JSON archive are backed up |

Use Git index removal rather than deleting a collaborator's local virtual environment.

## Remove After Runtime Verification

| Path/category | Evidence | Proposed action |
| --- | --- | --- |
| `old-website-backup/` | Four small prototype files; no runtime references found | Remove or export to a historical archive outside the active tree |
| `backend/CSV/` | Superseded flattened analytics data | Remove after SQL/API fixture comparison passes |
| `backend/stats.py` | Imports legacy `find.py`; live app imports `stats_db.py` | Remove after import/reference and API regression verification |
| `backend/find.py` | Used by legacy `stats.py` only | Remove with legacy CSV pipeline |
| `backend/extract.py` | Legacy JSON-to-CSV generator | Archive or remove with legacy CSV pipeline |
| `backend/main.py` | Scratch entrypoint importing `extract`, `stats`, and `find` | Remove or replace later with a documented smoke command |
| `frontend/public/index.html` | Stale Create React App template; Vite uses `frontend/index.html` | Remove after clean build and route smoke test |
| `frontend/src/logo.svg` | Byte-for-byte duplicate of public logo and appears unused | Remove after reference search and visual smoke check |
| unused `axios` dependency | Application currently appears to use native `fetch` | Confirm with full import search, then remove and rebuild |

## Replace When Production Target Is Accepted

Do not remove these until the relevant ADR is accepted and replacement deployment
configuration exists.

| Path | Current role | Proposed disposition |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | Frontend-only GitHub Pages deploy | Replace with CI plus staging/production GCP workflows |
| `render.yaml` | Render Flask deployment that rebuilds SQLite | Remove after Cloud Run staging deploy works |
| `railway.json` | Railway Docker builder definition | Remove after Cloud Run staging deploy works |
| `Dockerfile` | Combined frontend/API image with build-time SQLite | Replace with API-only production image; do not simply delete |
| `start.sh` | Gunicorn entrypoint | Keep or replace with explicit container command after API image design |
| hard-coded Render URL in `frontend/src/api.ts` | Production API fallback | Replace with same-origin `/api` before Firebase cutover |

## Reorganize Or Archive

| Path/category | Proposed action |
| --- | --- |
| `backend/convert_txt_json.py` and maintenance scripts | Move under `backend/scripts/` with documented purpose and safety |
| completed migration/implementation plans | Move under `docs/archive/` or mark completed/historical |
| `docs/pdf/` generated PDF copies | Remove or regenerate only through an explicit documentation task |
| root optimization/change Markdown files | Merge current guidance into canonical docs; archive historical reports |
| root `package.json` and lockfile | Choose a real workspace or remove proxy-only tooling after command audit |
| frontend and root Tailwind configuration | Consolidate on the frontend's actual toolchain |
| large Flask/analytics/import modules | Split by responsibility during Phase 2, not Phase 1 deletion |
| large React pages | Split into route, components, hooks, types, and utilities during Phase 2 |

## Keep

| Path/category | Reason |
| --- | --- |
| `backend/JSON/` | Authoritative historical match archive and rebuild input |
| `backend/data/player_identities.csv` | Durable identity grouping registry; currently incomplete for five historical merges |
| `backend/data/team_aliases.csv` | Historical parser-correction manifest required only for rebuilding older match data; live aliases are database-backed |
| `backend/data/analytics_excluded_race_blocks.json` | Reviewed analytics exclusion registry |
| `backend/data/database_health_reviews.json` | Reviewed warning disposition registry until moved to durable production storage |
| `backend/models.py` and SQL-backed analytics | Active application implementation |
| frontend music and background assets | Intentional product assets; optimize delivery/caching without design removal |
| `.agents/skills/` and `skills-lock.json` | Keep if repository-level agent conventions are intentionally shared with collaborators |
| tests under `backend/test_*.py` | Current executable regression baseline |
| Phase 0 baseline fixtures and scripts | Evidence for behavior-preserving refactor |

## Approved Owner Dispositions

Approved July 19, 2026:

- Remove tracked `.idea/` and `.vscode/` workstation state unless a setting is proven
  necessary and intentionally recreated as shared configuration.
- Archive `old-website-backup/` under the historical documentation area rather than
  keep it in the active application tree.
- Keep repository-level agent skills as intentional collaborator tooling.
- Remove generated PDFs; Markdown remains canonical.
- Move completed implementation plans to the historical documentation area when
  their phase is complete.

## Phase 1 Safety Rules

- Apply cleanup in category-specific commits.
- Never delete local environments merely to stop tracking them.
- Run backend tests, frontend production build, database baseline capture, and API
  fixture comparison after each runtime-related removal group.
- Preserve the JSON archive and all normalization/review registries.
- Do not combine file deletion with refactoring behavior in the same commit.
