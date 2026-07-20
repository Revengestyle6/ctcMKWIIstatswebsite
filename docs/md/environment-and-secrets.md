# Environment And Secrets

No secret belongs in Git, a frontend bundle, or a committed environment file.

| Variable | Consumer | Purpose |
| --- | --- | --- |
| `APP_ENV` | Backend | `local`, `test`, `staging`, or `production`; production-like environments require PostgreSQL |
| `DATABASE_URL` | Backend | SQLAlchemy database URL; defaults to local SQLite |
| `DB_POOL_SIZE` | Backend | PostgreSQL persistent connection count per process; defaults to 3 |
| `DB_MAX_OVERFLOW` | Backend | Temporary PostgreSQL connections per process; defaults to 2 |
| `DB_POOL_RECYCLE_SECONDS` | Backend | PostgreSQL connection recycle interval; defaults to 1,800 seconds |
| `DB_APPLICATION_NAME` | Backend | PostgreSQL connection label for diagnostics |
| `POSTGRES_PORT` | Compose | Local PostgreSQL host port; defaults to 55432 |
| `MATCH_JSON_ROOT` | Backend | Override the local archived-JSON root |
| `MATCH_UPLOAD_TOKEN` | Backend | Optional transitional bearer token for non-local writes and operational details |
| `VITE_API_URL` | Frontend build | API base URL embedded by Vite |
| `PORT` | `start.sh` | Gunicorn bind port; defaults to 5000 |
| `PYTHON_VERSION` | Render config | Transitional Render Python selection |
| `PYTHON_BIN` | Playwright config | Backend interpreter used by browser tests |

## Local Development

`.env.example` contains non-secret local PostgreSQL defaults. The application does
not depend on automatic `.env` loading, so export the values in the shell or use
environment tooling that loads the file. Normal SQLite development requires no
backend variable.

To force the frontend to the local API explicitly:

```text
VITE_API_URL=http://127.0.0.1:5000
```

Vite variables are public build inputs, never secrets. The current Render fallback
is transitional and will be replaced by same-origin `/api` paths.

## Production Direction

Cloud Run will receive database and storage configuration through deployment
settings and Secret Manager. Firebase ID tokens will replace the transitional
shared upload token. GitHub Actions will use short-lived Workload Identity
Federation credentials rather than a service-account key.

The committed `ctc_local` password is only for the host-local Compose service.
Never reuse it for staging, production, or any remotely reachable database.
