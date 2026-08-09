# Deployment

## Accepted Target

- Firebase Hosting: React build, CDN, TLS, and `/api/**` rewrite.
- Cloud Run: Flask API with request-based billing and zero minimum instances.
- Cloud SQL: PostgreSQL 18 on the initial cost-first `db-f1-micro` configuration.
- Cloud Storage: immutable archived JSON and database exports.
- Cloud Storage media bucket: normalized team-logo uploads served by the API.
- Firebase Authentication: Google sign-in for administrator actions.
- GitHub Actions: Workload Identity Federation for deployment credentials.

See `docs/adr/` for accepted decisions and constraints.

## Current Phase 4 Status

The Firebase/Google Cloud project, billing safeguards, authentication
configuration, shared Cloud SQL instance, application databases, database roles,
Cloud Storage, dedicated identities, Secret Manager, Artifact Registry, migration
and bootstrap jobs, staging Cloud Run API, and Firebase Hosting deployment exist.
The staging database has 246 matches and 246 accepted source objects; all three
public health checks, React SPA fallback, and same-origin API routing pass.
Workload Identity Federation and the least-privilege staging deployer are
configured and have completed multiple successful deployments from `main`.
Scheduled operations and the remaining staging acceptance matrix remain. See the
[Phase 4 resource inventory](phase-4-resource-inventory.md) for the authoritative
checkpoint record.

Human database access uses IAM database authentication through the Cloud SQL Auth
Proxy and the PostgreSQL `ctc_readonly` role. Follow the
[Cloud SQL read-only access runbook](cloud-sql-read-access.md) to onboard, verify,
or revoke a reader.

## Deployment Files

`Dockerfile` and `start.sh` define the PostgreSQL-backed API artifact. The old
SQLite-rebuilding Render definition has been retired to
`docs/archive/sqlite-retired/`. `.github/workflows/ci-staging.yml` replaces the
GitHub Pages publisher with PostgreSQL CI followed by a keyless, digest-pinned
staging deployment. `.gcloudignore` limits the remote build context to backend
runtime inputs.

## Why Each Managed Tool Exists

| Tool | Brief description | Why this application uses it |
| --- | --- | --- |
| Artifact Registry | A private regional repository for Docker images and other build artifacts | Preserves immutable, digest-addressed Flask images so staging, jobs, and production can run exactly the reviewed code |
| Cloud Build | A managed remote container builder | Produces repeatable Docker images without depending on a developer's Docker daemon and pushes them directly to Artifact Registry |
| Cloud Run Job | A run-to-completion container workload | Runs Alembic migrations and controlled archive imports explicitly, without racing during web-service startup or remaining online afterward |
| Cloud Run Service | A request-driven managed container runtime | Runs the Python/Flask API that Firebase Hosting cannot execute and scales to zero when idle |
| Cloud SQL | Managed PostgreSQL with backups and point-in-time recovery | Holds relational application state, constraints, identities, and analytics data durably |
| Cloud SQL attachment | Cloud Run's managed Unix-socket path to a named Cloud SQL instance | Provides authenticated database transport without opening PostgreSQL to arbitrary public clients |
| Cloud Storage | Durable object storage | Preserves original submitted JSON independently of PostgreSQL so imports can be audited and rebuilt |
| Secret Manager | Versioned encrypted secret storage with per-secret IAM | Injects database URLs and the rate-limit HMAC only at runtime; secrets are absent from images, source, and frontend bundles |
| Service account | A non-human Google Cloud workload identity | Gives each API or maintenance job only the cloud permissions required for its role and environment |
| GitHub Actions | Repository-hosted automation runners | Runs the same PostgreSQL/frontend checks on every change and deploys only a successful `main` revision |
| OpenID Connect | A signed, short-lived workload identity token | Lets a GitHub job prove its repository, event, and branch without storing a Google credential |
| Workload Identity Federation | Google's external-identity validation and token exchange | Converts only approved GitHub OIDC claims into short-lived deployer credentials |
| Firebase Authentication | Browser sign-in and Firebase ID-token issuer | Provides Google sign-in while Flask remains the authority for administrator allowlist and action checks |
| Firebase Hosting | CDN-backed static hosting with routing rewrites | Serves the React build, TLS, SPA fallback, and same-origin `/api/**` forwarding |

Enabling a Google Cloud API only makes that product callable in the project. It
does not create an always-running workload. Workload Identity Federation and IAM
policies have no always-running compute. Artifact Registry incurs storage and
transfer usage; Cloud Build incurs build-minute usage; Cloud Run Jobs incur
compute only while executing; and the staging Cloud Run Service is configured
with zero minimum and three maximum instances to bound request compute and database
connections. Cloud SQL is the principal fixed-cost resource in this topology.

## Automated Staging Deployment

The workflow runs tests before requesting a deploy credential. Pull requests can
exercise CI but the WIF provider accepts only `main` pushes or manual runs on
`main`. Deployment order is build, digest resolution, migration job, API service,
direct readiness, React build, Hosting release, and same-origin health checks.

The registered Firebase web configuration is fetched during the workflow. These
browser identifiers are public, but retrieving them avoids a second manually
maintained copy. Database URLs, HMAC values, and archive permissions remain behind
the Cloud Run runtime identities and never enter the workflow.

See the [WIF runbook](../../infra/iam/github-actions-wif.md) for exact trust,
permissions, production separation, and revocation.

The old Vercel and GitHub Pages integrations are external repository settings,
not part of the accepted deployment. Follow the
[legacy deployment integration cleanup runbook](legacy-deployment-cleanup.md)
with the previous-site collaborator before removing their environments or
deployment metadata.

## Staging API Checkpoint

Created and verified July 25, 2026:

- Service: `ctc-stats-api-staging`
- Region: `us-central1`
- URL: `https://ctc-stats-api-staging-1054134490602.us-central1.run.app`
- Image digest:
  `sha256:3be6fc168e1a703d973b15aeca16d8efaa98bdca7a84517862ce2a0654a37e9b`
- Identity: `ctc-api-staging@mkw-stats.iam.gserviceaccount.com`
- Scaling: zero minimum, three maximum, concurrency 8
- Gunicorn: one worker with eight threads and a 60-second timeout
- Database: `ctc_staging` through the Cloud SQL attachment
- Archive: `mkw-stats-staging-archive`

The migration and historical rebuild are separate jobs named
`ctc-staging-migrate` and `ctc-staging-bootstrap`. The migration job is safe to
rerun because Alembic applies only unapplied revisions. The bootstrap job is a
controlled rebuild tool, not a routine service operation; do not rerun it against
a populated database without a reviewed rebuild plan.

Verification endpoints have distinct purposes:

```bash
curl -fsS "$SERVICE_URL/api/health/live"   # Flask can answer HTTP
curl -fsS "$SERVICE_URL/api/health/ready"  # Cloud SQL works and schema is current
curl -fsS "$SERVICE_URL/api/health/data"   # data exists and the archive needs no repair
```

The verified data response reported 244 matches and zero pending archive repairs.
A representative `/api/matches?season=s2&division=d1` request returned 16 records.

After normal dashboard navigation produced platform HTTP 429 responses under the
original one-instance/single-synchronous-worker configuration, revision
`ctc-stats-api-staging-00004-7f2` added eight Gunicorn threads, set Cloud Run
concurrency to eight, and raised the maximum-instance ceiling to three while
retaining zero minimum instances. A 16-request same-origin burst then returned 16
HTTP 200 responses and zero revision-level 429s.

## Firebase Hosting Checkpoint

Release `1785003027409000` is live at `https://mkw-stats.web.app`. The versioned
configuration is in `firebase.json`, and `.firebaserc` binds the repository to
project `mkw-stats`.

The `/api/**` rewrite comes before the catch-all SPA rewrite. Firebase Hosting uses
the first matching rewrite, so reversing these rules would serve `index.html` to
API callers. The Cloud Run rewrite gives frontend requests a same-origin URL,
which removes the need for hosted cross-origin CORS.

Deploy only Hosting from the repository root:

```bash
cd frontend
npm run check
npm run build
cd ..
npx firebase-tools deploy --only hosting --project mkw-stats
```

Do not run `firebase init hosting` over the checked-in configuration; it can
replace the reviewed Hosting section with interactive defaults. Cloud Functions
does not need to be enabled for the Cloud Run rewrite.

## Phase 3 Docker Artifact

The image contains only the Python API and runtime adapters, installs dependencies
in a cacheable layer, and runs Gunicorn as the unprivileged `app` user. It excludes
the frontend, tests, historical JSON, and generated databases. Image construction
never migrates or imports a database; those are explicit deployment jobs.

Build the current regression artifact from the repository root:

```bash
docker build -t ctc-stats:phase3 .
```

## Local Development

Use the root `README.md`. Flask listens on port 5000 and Vite on port 3000. The Vite
proxy forwards `/api` to Flask.

Local development commands do not create or change Phase 4 cloud resources.
