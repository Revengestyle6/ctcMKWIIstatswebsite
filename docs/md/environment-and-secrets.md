# Environment And Secrets

No secret belongs in Git, a frontend bundle, or a committed environment file.

| Variable | Consumer | Purpose |
| --- | --- | --- |
| `APP_ENV` | Backend | `local`, `test`, `staging`, or `production` |
| `DATABASE_URL` | Backend | Required PostgreSQL connection URL |
| `TEST_DATABASE_URL` | Tests | Optional PostgreSQL override; defaults only to the documented local Compose URL and never inherits `DATABASE_URL` |
| `DB_POOL_SIZE` | Backend | PostgreSQL persistent connection count per process; defaults to 3 |
| `DB_MAX_OVERFLOW` | Backend | Temporary PostgreSQL connections per process; defaults to 2 |
| `DB_POOL_RECYCLE_SECONDS` | Backend | PostgreSQL connection recycle interval; defaults to 1,800 seconds |
| `DB_APPLICATION_NAME` | Backend | PostgreSQL connection label for diagnostics |
| `POSTGRES_PORT` | Compose | Local PostgreSQL host port; defaults to 55432 |
| `MKC_API_TIMEOUT_SECONDS` | Backend | MKCentral read timeout per friend-code request; defaults to 6 seconds |
| `MKC_REFRESH_WORKERS` | Backend | Parallel MKCentral bulk-refresh requests; defaults to 8 and is capped at 16 |
| `MATCH_JSON_ROOT` | Backend tools | Override the historical local archived-JSON root |
| `ARCHIVE_STORAGE_PROVIDER` | Backend | `local` for development; staging/production require `gcs` |
| `ARCHIVE_STORAGE_ROOT` | Backend | Ignored local temporary/accepted object root |
| `ARCHIVE_GCS_BUCKET` | Backend | Hosted immutable archive bucket name |
| `MEDIA_STORAGE_PROVIDER` | Backend | `local` for development; staging/production require `gcs` |
| `MEDIA_STORAGE_ROOT` | Backend | Local uploaded-media root; defaults to `backend/data/media` |
| `MEDIA_GCS_BUCKET` | Backend | Hosted team-logo media bucket name |
| `FIREBASE_PROJECT_ID` | Backend | Expected Firebase token audience; `GOOGLE_CLOUD_PROJECT` is a fallback |
| `ALLOW_DEV_AUTH` | Backend | Explicit local/test identity override; never enable in hosted environments |
| `SUBMISSION_RATE_LIMIT_SECRET` | Backend | HMAC key for non-reversible anonymous network identifiers |
| `SUBMISSION_RATE_LIMIT` | Backend | Requests per fixed window; defaults to 10 |
| `SUBMISSION_RATE_WINDOW_MINUTES` | Backend | Fixed-window length; defaults to 60 |
| `MAX_REVIEW_SUBMISSION_BYTES` | Backend | Canonical JSON size limit; defaults to 1 MiB |
| `VITE_API_URL` | Frontend build | Optional API origin override; defaults to the frontend origin |
| `VITE_FIREBASE_API_KEY` | Frontend build | Public Firebase web API identifier, not a secret |
| `VITE_FIREBASE_AUTH_DOMAIN` | Frontend build | Firebase sign-in domain |
| `VITE_FIREBASE_PROJECT_ID` | Frontend build | Firebase project identifier |
| `VITE_FIREBASE_APP_ID` | Frontend build | Firebase web application identifier |
| `VITE_ALLOW_DEV_AUTH` | Frontend build | Exposes the local auth control; local/test use only |
| `VITE_DEV_ADMIN_EMAIL` | Frontend build | Optional local override form default; not authorization by itself |
| `PORT` | `start.sh` | Gunicorn bind port; defaults to 5000 |
| `PYTHON_VERSION` | Render config | Transitional Render Python selection |
| `PYTHON_BIN` | Playwright config | Backend interpreter used by browser tests |

## Local Development

`.env.example` contains non-secret local PostgreSQL defaults. The application does
not depend on automatic `.env` loading, so export the values in the shell or use
environment tooling that loads the file. The backend fails fast when
`DATABASE_URL` is absent or does not identify PostgreSQL.

Real Firebase Google sign-in also requires the backend token audience:

```text
FIREBASE_PROJECT_ID=mkw-stats
```

The frontend separately requires all four `VITE_FIREBASE_*` values in the
ignored `frontend/.env.development.local` file. See the
[local development startup runbook](local-development-startup.md) for the
Firebase CLI retrieval command and complete startup sequence. Vite must be
restarted after those values change.

To force the frontend to the local API explicitly:

```text
VITE_API_URL=http://127.0.0.1:5000
```

Vite variables are public build inputs, never secrets. The API client uses
same-origin requests when `VITE_API_URL` is unset.

## Production Direction

Cloud Run will receive database and storage configuration through deployment
settings and Secret Manager. Administrator requests carry short-lived Firebase ID
tokens; the backend verifies them and checks `admin_users`. GitHub Actions will use
short-lived Workload Identity Federation credentials rather than a service-account
key.

The Phase 4 secret containers and initial versions now exist. Staging and
production have separate database URL and rate-limit HMAC secrets. Migration jobs
have separate environment-specific database URLs. Accessor is granted per secret,
not across the project, and the five user-managed service accounts have no
downloadable keys. See [`infra/iam/`](../../infra/iam/README.md) and
[`infra/secrets/`](../../infra/secrets/README.md) for the live resource mapping.

The committed `ctc_local` password is only for the host-local Compose service.
Never reuse it for staging, production, or any remotely reachable database.
