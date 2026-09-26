# Repository map

Use this map to find the owner of a change. The [architecture overview](README.md)
explains how these modules cooperate; the [backend](backend.md) and
[frontend](frontend.md) guides list detailed responsibilities.

```text
/
├── README.md / CONTRIBUTING.md       onboarding and required verification
├── CONTEXT.md                        competition and identity glossary
├── AGENTS.md / docs/agents/          agent issue/domain conventions
├── frontend/
│   ├── src/
│   │   ├── App.tsx / index.tsx       routing and browser entry
│   │   ├── api.ts / *Api.ts          HTTP transport and query contracts
│   │   ├── authClient.ts            Firebase browser identity
│   │   ├── context/ / hooks/        league, scope and session state
│   │   ├── config/                  league, navigation and match-set values
│   │   ├── pages/                   routed views
│   │   ├── features/match-editor/   draft, validation and editor UI
│   │   ├── features/match-history/  match history, views and links
│   │   └── components/              shared UI and admin/dashboard views
│   ├── public/media/                shipped league imagery and audio
│   ├── e2e/                         browser smoke and deliberate capture
│   └── scripts/                     media-reference verification
├── backend/
│   ├── app.py / extensions.py       Flask construction and extensions
│   ├── routes/                      HTTP parsing, auth and orchestration
│   ├── match_*.py                   match catalog, validation, review, edits
│   ├── acceptance_service.py        accepted-match transaction and archive flow
│   ├── review_queue.py              public temporary submission workflow
│   ├── *_stats.py / *_analytics.py  query and analytics modules
│   ├── database.py / models.py       PostgreSQL connection and relational model
│   ├── migrations/                  immutable ordered Alembic history
│   ├── import_json_to_db.py          historical and accepted editor ingestion
│   ├── archive_storage.py           local/GCS JSON adapters
│   ├── media_storage.py             local/GCS uploaded-image adapters
│   ├── scripts/                     explicit maintenance commands
│   ├── data/                        reviewed registries; ignored local state
│   ├── JSON/                        checked-in historical input archive
│   └── test_*.py / test_support.py   PostgreSQL-isolated test suite
├── docs/                            current guides, decisions and history
├── infra/                           managed-resource and IAM runbooks
└── .github/workflows/ci-staging.yml  local-equivalent checks and staging release
```

Backend modules retain their established flat import layout: Flask, maintenance
commands, Alembic, and tests already use it. Grouping documentation by capability
avoids an unrelated Python packaging migration.

## Root configuration

| Files | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Pinned Firebase deployment CLI; no browser application code |
| `frontend/package.json`, `frontend/package-lock.json` | Browser runtime and build/test dependencies |
| `pyproject.toml`, `backend/requirements*.txt` | Ruff policy and Python runtime/development dependencies |
| `alembic.ini`, `backend/migrations/` | Schema migration configuration and history |
| `compose.yaml`, `.env.example` | Host-local PostgreSQL and non-secret environment examples |
| `Dockerfile`, `start.sh` | Non-root Flask/Gunicorn runtime image; startup does not migrate/import |
| `cloudbuild.yaml`, `.gcloudignore`, `.dockerignore` | Remote image build and allowed build inputs |
| `firebase.json`, `.firebaserc` | Static Hosting target, headers and same-origin rewrite |
| `.gitignore` | Excludes dependencies, credentials, local databases and generated output |
| `.agents/skills/`, `skills-lock.json` | Repository agent guidance, separate from application runtime |
| `project.md` | Compatibility pointer to contributor verification requirements |

The retired Railway and Python buildpack descriptors live in
[historical deployment artifacts](../archive/deployment/README.md). They are not
active deployment choices.

## Find the owner by task

| Task | Start here |
| --- | --- |
| Change a validation message or score rule | [Editor validation](../json-editor/validation.md) and its source-function index |
| Explain a player/team name | [Identity guides](../features/README.md), importer, `player_naming.py`, `team_identity_management.py` |
| Explain a leaderboard number | Query module in [backend guide](backend.md), role/exclusion methodology |
| Add a database column | `models.py`, a new Alembic revision, relevant test fixture, [data model](data-model.md) |
| Diagnose an accepted match with missing archive | `acceptance_service.py`, `phase3_maintenance.py`, [operations](../operations/README.md) |
| Change a page URL or scope behavior | `App.tsx`, `config/navigation.ts`, `context/LeagueContext.tsx`, route module |
| Change deployment/permissions | CI workflow plus the relevant `infra/` runbook |
| Propose new behavior | GitHub Issue; [roadmap](../roadmap/README.md) for current direction |

## Data that must not be mistaken for bloat

Historical JSON/TXT documents, reviewed identity registries, migrations, source
fingerprints, approved baselines, and branded media have product or recovery value.
A same-stem `.json` is preferred over `.txt` by the importer, but this cleanup does
not delete the retained source evidence. Generated output (`frontend/build`,
Playwright results, Python caches, local databases, local object/media storage)
is ignored and is not a source of truth.
