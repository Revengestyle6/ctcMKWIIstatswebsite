# Phase 4 Service Identities

All application and automation identities are user-managed service accounts in
project `mkw-stats`. No downloadable service-account keys exist.

| Service account | Intended workload | Current access |
| --- | --- | --- |
| `ctc-api-staging@mkw-stats.iam.gserviceaccount.com` | Staging Cloud Run API | Cloud SQL Client; object access on the staging archive and staging media buckets; accessor on the staging database URL and rate-limit HMAC secrets |
| `ctc-api-prod@mkw-stats.iam.gserviceaccount.com` | Production Cloud Run API | Cloud SQL Client; object access on the production archive and production media buckets; accessor on the production database URL and rate-limit HMAC secrets |
| `ctc-db-migrator@mkw-stats.iam.gserviceaccount.com` | Alembic and controlled import jobs | Cloud SQL Client; accessor on the two migrator database URL secrets |
| `ctc-db-exporter@mkw-stats.iam.gserviceaccount.com` | Scheduled logical database exports | No roles yet; grant only after the export mechanism is selected |
| `ctc-cloud-builder@mkw-stats.iam.gserviceaccount.com` | Cloud Build backend image execution | Read submitted source objects from `mkw-stats_cloudbuild`; write Cloud Logging entries; push images only to `ctc-backend` |
| `ctc-github-deployer@mkw-stats.iam.gserviceaccount.com` | GitHub Actions staging deployment | WIF impersonation from immutable GitHub repository ID `1138772443`; scoped Cloud Build, Artifact Registry, staging Cloud Run, Firebase Hosting, and act-as grants |

Runtime archive permissions use `roles/storage.objectUser` because accepted-match
promotion removes queue objects. Media permissions use the narrower
`roles/storage.objectCreator` plus `roles/storage.objectViewer`; the API cannot
delete media. Every grant is bucket-scoped rather than project-scoped. Runtime secret access uses
`roles/secretmanager.secretAccessor` on individual secrets. The API and migrator
accounts have project-level `roles/cloudsql.client`, which permits transport to
Cloud SQL but does not grant PostgreSQL data privileges.

The human owner is intentionally not a service-account token creator for these
accounts. Cloud Run executes as the API accounts, while the
[`github-actions-wif.md`](github-actions-wif.md) runbook records the narrowly
scoped, keyless GitHub trust and its revocation path.

## PostgreSQL Login Users

The current SQLAlchemy adapter uses built-in password authentication through the
Cloud Run Cloud SQL Unix socket:

| Login user | Inherited PostgreSQL role | Database boundary |
| --- | --- | --- |
| `ctc_runtime_staging` | `ctc_app_staging` | Staging only |
| `ctc_runtime_prod` | `ctc_app_prod` | Production only |
| `ctc_migration_job` | `ctc_migrator` | Both databases for controlled schema/import jobs |

Passwords are generated values stored only inside the corresponding Secret
Manager database URLs. They must never appear in commands committed to Git,
GitHub secrets, environment files, or documentation.
