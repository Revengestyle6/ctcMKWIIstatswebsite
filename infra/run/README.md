# Cloud Run Staging Workloads

Cloud Run Jobs execute containers to completion. They are used for schema
migrations and controlled historical rebuilds because those operations must be
explicit, observable, and separate from HTTP service startup.

Cloud Run Service is the request-driven Flask runtime. It can scale to zero when
idle; staging is capped at three instances to bound compute cost and Cloud SQL
connections. Each instance runs one Gunicorn worker with eight threads and a
five-connection SQLAlchemy pool ceiling. Public invocation supports analytics,
while Flask still verifies Firebase tokens and the database allowlist for
administrator routes.

| Workload | Type | Identity | Purpose |
| --- | --- | --- | --- |
| `ctc-staging-migrate` | Job | `ctc-db-migrator` | Apply unapplied Alembic revisions |
| `ctc-staging-bootstrap` | Job | `ctc-db-migrator` | Controlled JSON rebuild and GCS archive promotion |
| `ctc-staging-bootstrap-owner` | Job | `ctc-db-migrator` | One-time, idempotent creation/restoration of the invited application owner |
| `ctc-stats-api-staging` | Service | `ctc-api-staging` | Serve the staging Flask API |

All workloads attach Cloud SQL instance
`mkw-stats:us-central1:mkw-stats-prod-pg18` and use Secret Manager references
rather than literal credentials. The service also uses only the staging archive
bucket. Never give it access to the production archive or export bucket.

Deployment order matters:

1. Build and pin one Artifact Registry image digest.
2. Update and execute the migration job.
3. Deploy that same digest to the service.
4. Verify `/api/health/live`, `/api/health/ready`, and `/api/health/data`.

Do not run the bootstrap job as part of normal deploys. It is a rebuild tool and
requires a reviewed empty-target/recovery procedure.

Cloud Run concurrency is set to eight to match Gunicorn's thread count. The
maximum of three instances is a ceiling, not a reservation; zero minimum instances
keeps scale-to-zero behavior. This configuration replaced the original
one-instance/single-synchronous-worker setup after normal parallel dashboard loads
produced platform HTTP 429 responses.

The owner-bootstrap job does not accept or invent a Firebase UID. It records an
explicit email as an invited owner; the first successful Firebase-authenticated
request for that email binds the verified UID and activates the row. This keeps
identity proof inside the authentication flow instead of a deployment command.
