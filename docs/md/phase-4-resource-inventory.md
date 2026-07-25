# Phase 4 Resource Inventory

This inventory records approved cloud resources and configuration checkpoints.
Secrets and environment-specific credentials are never committed here.

## Status

- Last reconciled: July 25, 2026
- Canonical phase: Phase 4, Infrastructure And Staging
- Overall status: In progress

| Checkpoint | Status | Current evidence or next action |
| --- | --- | --- |
| Google Cloud/Firebase project and web app | Complete | Project `mkw-stats` and web app are registered |
| Firebase Google authentication | Complete | Hosted Google sign-in, Flask token verification, staging allowlist lookup, owner UID binding, and administrator page access were verified July 25 |
| Billing link and budget safeguards | Complete | Funded billing is linked; project and net-charge budgets are recorded below |
| Shared Cloud SQL instance | Complete | `mkw-stats-prod-pg18` is `RUNNABLE` with backups, PITR, and deletion protection |
| Staging/production databases and roles | Complete | Databases, non-login roles, ownership, environment isolation, and current/future grants were verified July 25 |
| Archive/export Cloud Storage | Complete | Three private `us-central1` buckets isolate staging JSON, production JSON, and database exports; security and lifecycle policies were verified July 25 |
| Runtime identities and secrets | Complete | Five keyless user-managed service accounts, three scoped SQL login users, and six regional secrets with per-resource IAM were verified July 25 |
| Artifact Registry and backend image | Complete | Private immutable-tag repository `ctc-backend` contains the verified digest-addressed staging image |
| Cloud Run staging | Complete | Migration/bootstrap jobs and `ctc-stats-api-staging` run as dedicated identities; live, ready, and data checks pass |
| Firebase Hosting staging | Complete | Release `1785003027409000` serves the React SPA; deep-link fallback and same-origin Cloud Run API rewrites pass |
| CI/CD identity and workflow | Verification pending | WIF pool/provider, keyless deployer grants, and digest-pinned staging workflow are configured; first successful run from `main` remains |
| Staging data rebuild and archive seed | Complete | 244 matches and 244 source files match the baseline; 244 accepted GCS objects and zero archive failures verified |
| Monitoring and scheduled operations | Pending | Application/service alerts, archive reconciliation, logical exports, and integrity maintenance are not scheduled |
| End-to-end staging validation | In progress | Hosted authentication and a controlled upload/accept/archive cycle pass; backup/export, restore, rollback, and remaining boundary checks remain |
| Production cutover | Phase 5 | Begins only after Phase 4 staging acceptance |

## Remaining Phase 4 Execution Order

1. **Complete:** Artifact Registry, Cloud Build, and Cloud Run APIs are enabled;
   the private regional Docker repository and verified backend image exist.
2. **Complete:** The staging migration/import jobs ran as `ctc-db-migrator`;
   `ctc_staging` and the accepted archive match the Phase 0 source/match counts.
3. **Partially complete:** The Flask staging service runs as `ctc-stats-api-staging`
   with zero minimum and three maximum instances. Live/readiness/data, SQL privileges,
   archive access, Firebase owner authorization, and controlled direct and queued
   writes pass.
4. **Complete:** Firebase Hosting serves the staging React build at
   `https://mkw-stats.web.app`; SPA fallback, cache policy, and the `/api/**`
   Cloud Run rewrite are verified.
5. **Complete:** A controlled editor submission was accepted as match `248`;
   PostgreSQL/API visibility, accepted-object promotion, empty queue, and zero
   archive repairs were verified.
6. **Complete:** An anonymous submission entered the review queue without changing
   public analytics, then owner acceptance created match `251`, promoted the exact
   JSON to the accepted archive, and removed the pending queue object.
7. **In verification:** GitHub Pages has been replaced locally by PostgreSQL CI and
   a staging workflow using Workload Identity Federation, an immutable image
   digest, the explicit migration job, and no long-lived Google key. The Google
   trust and least-privilege grants are live; commit to `main` and verify the first
   workflow deployment.
8. Configure monitoring and scheduled operations: service/database alerts,
   archive reconciliation, integrity maintenance, daily/monthly/annual logical
   exports, retention checks, and a documented restore drill.
9. Run the remaining staging acceptance matrix, including authentication
   boundaries, rollback, export, and restore.

The immediate next checkpoint is completion evidence for step 7. Production resources beyond the already
shared Cloud SQL instance and production archive/identity scaffolding remain
unused until staging acceptance.

## Firebase And Google Cloud Project

| Setting | Value |
| --- | --- |
| Project display name | CTC MKWII Stats |
| Project ID | `mkw-stats` |
| Firebase auth domain | `mkw-stats.firebaseapp.com` |
| Firebase web app ID | `1:1054134490602:web:6e5f37e3beccd7d4b28e93` |
| Firebase web app nickname | `ctc-mkwii-stats-web` (owner-confirmed setup) |
| Permanent project owner | `ynhcaz@gmail.com` |
| Application owner allowlist | `ynhcaz@gmail.com`; staging owner UID bound and activated through hosted Firebase sign-in July 25, 2026 |
| Firebase Authentication | Initialized and provider handshake verified July 20, 2026 |
| Google sign-in provider | Enabled; authorization URI creation verified |
| Authorized local domain | `localhost`; authorization URI creation verified |
| Google Analytics | Disabled at initial setup |
| Gemini in Firebase | Disabled at initial setup |
| Billing | Funded billing account linked; the shared Cloud SQL instance is the first paid runtime resource |
| Region | Not applicable to Firebase Authentication |
| Project lifecycle | Active; verified July 21, 2026 |
| Resource hierarchy | No organization or folder parent; verified July 21, 2026 |
| Project IAM owner | `ynhcaz@gmail.com`; verified with Google Cloud IAM July 21, 2026 |
| BU billing-project role | `zgentile@bu.edu` has `roles/billing.projectManager`; verified July 21, 2026 |
| BU project visibility | `zgentile@bu.edu` has read-only `roles/browser`; verified July 21, 2026 |
| BU API quota access | `zgentile@bu.edu` has `roles/serviceusage.serviceUsageConsumer`; verified July 21, 2026 |
| Cloud billing link | Enabled and linked to the funded Google Cloud trial account July 21, 2026 |
| Funded billing account | Open Google Cloud trial account managed through `zgentile@bu.edu` |
| Cloud Billing Budget API | Enabled on `mkw-stats` July 21, 2026 |
| Cloud SQL Admin API | Enabled on `mkw-stats` July 21, 2026 |
| Existing account-wide budget | `$50/month`, includes credits, alerts at 25%, 50%, 75%, 90%, and 100% |
| Project budget | `mkw-stats monthly operating budget`; `$10 USD` monthly; project `1054134490602` only; excludes credits; created July 21, 2026 |
| Project budget alerts | Actual spend at 50% (`$5`), 90% (`$9`), and 100% (`$10`); forecasted spend at 100% (`$10`) |
| Project budget ID | `e28862ff-969e-4ce5-a143-22324a1972c1` |
| Net-charge budget | `mkw-stats net charge warning`; `$1 USD` monthly; project `1054134490602` only; includes all credits; created July 21, 2026 |
| Net-charge alerts | Actual net spend at 1% (`$0.01`), 50% (`$0.50`), and 100% (`$1`); forecasted net spend at 100% (`$1`) |
| Net-charge budget ID | `7f985f78-a1ae-402a-9b54-ab7c974286bf` |

The Firebase web API key is a public build identifier, but remains in ignored
local/deployment environment configuration rather than repository source. The
backend receives only `FIREBASE_PROJECT_ID=mkw-stats` to verify token audience.

The project was intentionally created separately from `cs-528-zgentile`. Its funded
billing account is linked without placing the project under the BU organization.
Keep the permanent personal account as a direct project owner before the BU account
is retired.

## Pending Resource Checkpoints

- Before the BU account is retired, transfer billing ownership and alert recipients
  to a permanent billing identity; project ownership alone does not grant access to
  the BU-owned billing account's budgets.
- Create and document Artifact Registry, Cloud Run, Firebase Hosting deployment,
  CI federation, monitoring, scheduled maintenance, and restore evidence through
  their reviewed checkpoints.

## Database Health Additions After Application Deployment

Keep application-level PostgreSQL integrity checks independent from managed-service
operations. After the application is connected to Cloud SQL, add a separate Cloud
SQL operations section backed by Cloud SQL Admin and Cloud Monitoring data:

- instance name, region, edition, tier, PostgreSQL version, availability mode, and
  current serving state;
- provisioned storage, used storage, storage growth, and automatic-growth status;
- CPU, memory, active connections, transaction latency, disk operations, and
  network throughput;
- automated-backup configuration, last successful backup, retention, and restore
  test status;
- point-in-time recovery state and transaction-log retention;
- deletion protection and final-backup settings;
- latest scheduled `amcheck`/`pg_amcheck` completion, scope, duration, and result;
- alert status for availability, storage, memory, connections, backup failures,
  and approaching budget limits.

Do not run `amcheck` from a dashboard request. Run it through a scheduled,
least-privileged maintenance job and store a small result summary for the dashboard.
Cloud Monitoring calls should be bounded and cached so loading this admin page does
not create a request waterfall or add latency to public analytics traffic.

## Shared Cloud SQL Instance

Created and verified July 21, 2026. The instance reached `RUNNABLE` at
05:44:50 UTC. The `ctc_staging` and `ctc_prod` databases were created and verified
July 25. Database roles and grants were configured the same day. Dedicated runtime
login users and application secrets were configured later that day.

| Setting | Configured value |
| --- | --- |
| Instance ID | `mkw-stats-prod-pg18` |
| Connection name | `mkw-stats:us-central1:mkw-stats-prod-pg18` |
| Creation operation | `1f8c7b4e-639e-40a7-871c-759d00000032`; completed successfully |
| Serving state | `RUNNABLE` |
| Application databases | `ctc_staging` and `ctc_prod`; created July 25, 2026 |
| Edition/version | Enterprise, PostgreSQL 18 |
| Location | `us-central1`, single zone `us-central1-a` |
| Machine | `db-f1-micro` shared core, approximately 0.6 GiB RAM |
| Availability | Zonal; no standby or SLA |
| Storage | 10 GiB SSD; automatic growth disabled initially |
| Network | Public IPv4 transport, no authorized networks |
| Connection security | Cloud SQL connector/proxy required; direct database connections rejected |
| Database authentication | Cloud SQL IAM database authentication enabled; no root password passed through the CLI or stored in the repository |
| Built-in password policy | Enabled; minimum 20 characters, default complexity, username substring prohibited, previous 5 passwords cannot be reused |
| Backups | Standard automated daily backup at 09:00 UTC; retain 7 |
| PITR | Enabled; retain 1 day of transaction logs |
| Backup location | `us-central1` |
| Deletion protection | Enabled; retain backups on deletion; final backup retained 30 days |
| Maintenance | Sunday 09:00 UTC, stable maintenance track |
| Data cache/query insights | Disabled |
| Initial connection envelope | One Cloud Run instance initially; small bounded SQLAlchemy pool |
| Estimated fixed baseline | Approximately `$9.37/month` before backup storage and usage-dependent network charges |

The shared-core tier is intentionally a cost-first starting point. It is not
covered by the Cloud SQL SLA and will be upgraded only if measured latency,
memory pressure, or connection demand warrants it.

### Database Roles And Grants

| Role | Login | Ownership and privileges |
| --- | --- | --- |
| `ctc_migrator` | No | Owns `ctc_staging` and `ctc_prod`; inherited by the controlled migration login |
| `ctc_app_staging` | No | Connects only to `ctc_staging`; table CRUD and sequence usage/select |
| `ctc_app_prod` | No | Connects only to `ctc_prod`; table CRUD and sequence usage/select |
| `ctc_readonly` | No | Connects to both databases; schema usage and table/sequence select |

The `public` role has no database or schema privileges on either application
database. Alembic logs in as `ctc_migration_job`, so migration-created objects and
their PostgreSQL default privileges belong to that actual creator, not merely its
inherited `ctc_migrator` group. Migration `20260725_0003` grants each runtime role
access only in its environment, grants `ctc_readonly` select access, and establishes
matching defaults for future tables and sequences. This was verified through the
staging API after the original inherited-role assumption produced permission
denials.

The owner IAM database user `ynhcaz@gmail.com` received `cloudsqlsuperuser` only for
the configuration session. It was then reduced to `ctc_readonly`. Verification
confirmed that it is not a member of `ctc_migrator` or `cloudsqlsuperuser`, cannot
create objects, and retains read-only schema access.

Use the [Cloud SQL read-only access runbook](cloud-sql-read-access.md) for all
future human-reader grants, connection verification, periodic review, and
revocation.

## Cloud Storage Archive And Exports

Created and verified July 25, 2026. Separate archive buckets are required because
the application writes provider-relative `queue/` and `accepted/` keys without an
environment prefix. A third bucket keeps database-export permissions outside the
Flask runtime.

| Bucket | Purpose | Lifecycle |
| --- | --- | --- |
| `mkw-stats-staging-archive` | Staging review queue and immutable accepted JSON | Delete `queue/` objects after 30 days; retain `accepted/` |
| `mkw-stats-prod-archive` | Production review queue and immutable accepted JSON | Delete `queue/` objects after 30 days; retain `accepted/` |
| `mkw-stats-db-exports` | Logical PostgreSQL exports | Delete `daily/` after 30 days and `monthly/` after 365 days; retain `annual/` |

All three buckets use regional Standard storage in `us-central1`, uniform
bucket-level access, enforced public-access prevention, and seven-day soft delete.
Object versioning is disabled. The application additionally uses
`if_generation_match=0` when creating queue and accepted objects so a retry cannot
overwrite different bytes at an existing key.

The lifecycle files are versioned under [`infra/storage/`](../../infra/storage/).
The staging and production API identities each have object access only to their
environment's archive bucket. The export identity has no bucket access until its
job is designed. The staging archive contains the 244-object historical baseline
plus two controlled accepted matches, for 246 accepted source objects. The
production archive and export buckets remain unused.

## Artifact Registry, Build, And Cloud Run

Created and verified July 25, 2026:

| Resource | Configuration and why |
| --- | --- |
| Artifact Registry `ctc-backend` | Private Docker repository in `us-central1` with immutable tags; keeps reviewed images addressable by content digest |
| Cloud Build | Builds the Dockerfile remotely and publishes into Artifact Registry; removes dependence on a local Docker daemon |
| `ctc-staging-migrate` | Cloud Run Job using the migrator identity; applies Alembic explicitly before an API revision is deployed |
| `ctc-staging-bootstrap` | Cloud Run Job using the migrator identity; performs the controlled JSON rebuild and accepted-archive promotion |
| `ctc-stats-api-staging` | Publicly invokable Cloud Run Service using the staging API identity; serves Flask while admin routes still enforce Firebase and database authorization |

The serving image is pinned to digest
`sha256:3be6fc168e1a703d973b15aeca16d8efaa98bdca7a84517862ce2a0654a37e9b`.
The serving configuration uses zero minimum instances, three maximum instances,
concurrency 8, one Gunicorn worker with eight threads, 512 MiB memory, and a
60-second request timeout. Health
verification returned schema revision `20260725_0003`, 244 matches, and zero
archive repairs. A representative public `s2`/`d1` matches request returned 16
records.

Revision `ctc-stats-api-staging-00004-7f2` replaced the initial
one-instance/single-synchronous-worker serving configuration after normal
parallel dashboard loads received platform HTTP 429 responses. Verification sent
16 parallel requests through Firebase Hosting; all 16 returned HTTP 200 and the
new revision logged zero 429s.

The staging rebuild downloaded 464 repository archive files, imported 244 matches,
archived 244 authoritative sources, and reported zero failures. After those counts
and the accepted archive were verified, the temporary `bootstrap/JSON` prefix was
removed; bucket soft delete provides a seven-day recovery window.

## Firebase Hosting Staging

Deployed and verified July 25, 2026:

| Setting | Value and why |
| --- | --- |
| Site | `mkw-stats`, the existing default Firebase Hosting site |
| URL | `https://mkw-stats.web.app` |
| Release | `1785003027409000`, version `b3cf5d0f8fd9d3b2` |
| Public directory | `frontend/build`, the Vite production output |
| `/api/**` | Rewritten to Cloud Run service `ctc-stats-api-staging` in `us-central1`, giving the browser one origin |
| Other unknown paths | Rewritten to `/index.html` so React Router deep links load |
| `/assets/**` cache | One year and immutable because Vite fingerprints filenames by content |
| `/index.html` cache | `no-cache` so browsers discover new fingerprinted asset names after a release |

Verification confirmed that `/` serves the React document, `/admin/access` serves
the same SPA shell, `/api/health/ready` returns Flask JSON at schema revision
`20260725_0003`, and a same-origin `s2`/`d1` matches request returns 16 records.
Only Hosting was deployed; Cloud Functions remains disabled because no function is
part of this architecture.

Hosted authentication was then verified with `ynhcaz@gmail.com`: Firebase Google
sign-in succeeded, Flask accepted the Firebase ID token, the invited owner row
bound its verified UID and became active, and the administrator access page
loaded.

## Controlled Staging Write

Verified July 25, 2026 with `S3 / D2 / Week 1`, `CS vs SLAY`, 12 races,
`410 - 322`:

- the authenticated owner used the direct acceptance path;
- administrator acceptance returned HTTP 200;
- PostgreSQL created match `248`, immediately visible through the public API;
- Cloud Storage promoted the source to
  `accepted/ctc/s3/d2/W1 [M1] CS 410 - 322 SLAY--12d15a96c09e.json`;
- the accepted-object count increased from 244 to 245;
- the temporary review queue returned to zero objects;
- public data health reported 245 matches and zero archive repairs.

The separate public review-queue path was then verified with `S3 / D2 / Week 1`,
`Mi vs SLOW`, 12 races, `373 - 359`:

- the anonymous submission entered temporary `queue/pending/` storage and did not
  import a match before review;
- the owner reviewed and accepted it as match `251`;
- the public match endpoint returned the imported 5v5 match and all 12 races;
- Cloud Storage contained
  `accepted/ctc/s3/d2/W1 [M1] Mi 373 - 359 SLOW--bd8c5dd1b183.json`;
- the pending queue returned to zero objects; and
- public data health reported 246 matches and zero archive repairs.

No Git commit is expected. Runtime data is owned by PostgreSQL and the immutable
Cloud Storage archive. The repository contains application code, migrations,
reviewed configuration, and the historical bootstrap snapshot; the Cloud Run API
does not receive a GitHub write credential.

## Runtime Identities And Secrets

Created and verified July 25, 2026. User-managed accounts keep Cloud Run runtime,
migrations, exports, and deployment independently revocable.

| Identity | Current privileges |
| --- | --- |
| `ctc-api-staging@mkw-stats.iam.gserviceaccount.com` | Cloud SQL Client; staging archive object user; accessor for staging database URL and HMAC secrets |
| `ctc-api-prod@mkw-stats.iam.gserviceaccount.com` | Cloud SQL Client; production archive object user; accessor for production database URL and HMAC secrets |
| `ctc-db-migrator@mkw-stats.iam.gserviceaccount.com` | Cloud SQL Client; accessor for staging and production migrator database URLs |
| `ctc-db-exporter@mkw-stats.iam.gserviceaccount.com` | No roles until the scheduled export implementation is selected |
| `ctc-github-deployer@mkw-stats.iam.gserviceaccount.com` | WIF from immutable GitHub repository ID `1138772443`; Cloud Build submit; read `ctc-backend`; update/execute only the staging API and migration job; deploy Hosting; act as only the staging API and migrator identities |

The PostgreSQL login users `ctc_runtime_staging`, `ctc_runtime_prod`, and
`ctc_migration_job` were created with only `ctc_app_staging`, `ctc_app_prod`, and
`ctc_migrator`, respectively. Six Secret Manager resources replicate only in
`us-central1`; each has one enabled version and a single environment/workload
accessor policy.

No user-managed service-account keys exist. Effective access was verified by the
staging migration/bootstrap jobs and Cloud Run service executing as their assigned
accounts; no owner-minted workload token was used. Resource mappings and operational
constraints are versioned under [`infra/iam/`](../../infra/iam/README.md) and
[`infra/secrets/`](../../infra/secrets/README.md).
