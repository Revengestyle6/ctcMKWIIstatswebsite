# Production Readiness Plan

## Status

- Created: July 19, 2026
- Phase: Phase 3 local implementation complete; Phase 4 cloud checkpoints pending
- Scope: Repository cleanup, documentation, production infrastructure, deployment, and ongoing operations
- Accepted architecture: Firebase Hosting, Cloud Run, Cloud SQL for PostgreSQL,
  Cloud Storage, and Firebase Authentication

Phase 0 evidence and open decisions are tracked in
[`phase-0-production-baseline.md`](phase-0-production-baseline.md). Proposed cleanup
dispositions are tracked in
[`repository-cleanup-inventory.md`](repository-cleanup-inventory.md).

## Goal

Move the application from its current development deployment into a maintainable,
recoverable, low-cost production environment without changing existing product
functionality or visual design during the cleanup and refactoring work.

Future match entry will occur through the JSON editor. Archived JSON will remain an
immutable audit record, while the SQL database will be the operational source for
analytics and application reads.

## Scope And Non-Goals

This plan includes:

- Removing obsolete, generated, local-only, and superseded repository content.
- Refactoring large or poorly separated modules for readability and maintainability.
- Improving build, test, dependency, and container organization.
- Updating documentation to describe the implemented system.
- Migrating production data from SQLite to PostgreSQL.
- Moving archived JSON out of the application container into durable object storage.
- Establishing staging and production deployment workflows.
- Adding production authentication, backups, monitoring, and recovery procedures.
- Establishing continued-development and release practices.

The initial cleanup and refactor explicitly does not include:

- New application features.
- Changes to analytics definitions or results.
- Changes to API response contracts unless required for a production-safety issue.
- Visual redesigns or intentional user-interface changes.
- Direct edits to historical source data.

Behavioral changes required for authentication, durable storage, and production
safety will be handled as separate, reviewed infrastructure work after the no-change
refactor has a regression baseline.

## Recommended Target Architecture

```text
Browser
  |
  +-- Static application and media --> Firebase Hosting and CDN
  |
  +-- /api/* ------------------------> Cloud Run: Flask API
                                          |
                                          +--> Cloud SQL: PostgreSQL
                                          |
                                          +--> Cloud Storage: archived JSON
                                          |                   and DB exports
                                          |
                                          +--> Cloud Logging/Monitoring

Administrator
  +-- Google sign-in -----------------> Firebase Authentication
                                          |
                                          +--> Verified ID token at Flask API

GitHub Actions
  +-- Short-lived OIDC credentials ---> Google Workload Identity Federation
                                          |
                                          +--> Staging/production deployment
```

Firebase Hosting should serve the React application and rewrite `/api/**` requests
to Cloud Run. This gives the browser one origin, simplifies CORS, supports React
route fallbacks, provides managed TLS for a custom domain, and places static assets
behind a global CDN.

Cloud Run should use request-based billing and initially permit zero minimum
instances. A cold start is acceptable at launch in exchange for lower cost. This
decision can be revisited using measured latency rather than assumption.

## Data Ownership Model

The production data model should be explicit:

- **Archived JSON:** Immutable input and audit record stored in Cloud Storage.
- **PostgreSQL:** Operational source for application reads and analytics.
- **Git:** Application code, schema migrations, documentation, normalization
  registries, and optional seed/history data. Git is not the live upload target.
- **SQLite:** Supported for lightweight local tasks and selected tests, but not as
  the production database.

Cloud Run cannot safely hold SQLite or archived uploads because its writable
filesystem is temporary and does not persist when an instance stops.

## Production Database Decision

### Recommended: Cloud SQL For PostgreSQL

Reasons:

- PostgreSQL is supported by the existing SQLAlchemy architecture.
- It handles concurrent readers and JSON editor writes safely.
- It has standard migration, inspection, backup, and recovery tooling.
- Cloud SQL integrates directly with Cloud Run, IAM, monitoring, and the existing
  Google Cloud credits.
- Managed automated backups and point-in-time recovery reduce operational risk.

The accepted initial instance is Cloud SQL Enterprise PostgreSQL 18 on a
`db-f1-micro` shared-core machine in `us-central1`, with 10 GB SSD storage, single-
zone availability, automated backups, and point-in-time recovery. Shared-core
instances do not have a Cloud SQL SLA, which is acceptable for the initial
community-site availability requirement. Upgrade to a dedicated-core or highly
available configuration only when traffic or uptime needs justify the cost.

### Alternative: Neon PostgreSQL

Neon is the strongest lower-cost managed alternative. It can scale to zero and its
free allocation is far larger than the current database. Its disadvantages are an
additional vendor, possible database cold starts, cross-provider latency, and a
shorter recovery window on the free plan. If chosen, it should be deployed near the
Cloud Run region and supplemented with scheduled logical exports to Cloud Storage.

### Alternative: Single Compute Engine VM

A small VM could run the frontend server, Flask, and either SQLite or PostgreSQL at
very low cost. It is not recommended as the initial production target because the
team would own operating-system patching, TLS, process supervision, database
maintenance, monitoring, and recovery. It also creates a larger single point of
failure.

## Estimated Initial Cost

The database is approximately 4 MB, and the archived JSON is approximately 5 MB.
Those sizes are negligible. Static and media assets, currently around 60 MB, are
more likely to drive cost through bandwidth.

Expected starting costs:

- Firebase Hosting: likely within its free storage and transfer allowances at low
  traffic. Configure immutable caching for fingerprinted media and monitor transfer.
- Cloud Run: likely within the request-based free allowance at current traffic.
- Cloud SQL: approximately $8 per month for shared-core compute, plus storage and
  backups. Region and current pricing must be confirmed before provisioning.
- Cloud Storage: likely within the applicable free allowance at the current size.
- Domain registration: commonly $10-$20 per year, depending on the registrar and
  selected domain.

A reasonable planning estimate is **$10-$15 per month plus the domain**. The owner
accepted the lowest-cost shared-core configuration shown by the Google Cloud
calculator at roughly $0.01 per hour for compute plus approximately $0.002 per hour
for 10 GiB SSD storage, before backup, network, or usage-dependent charges. The $150
in Google Cloud credits should fund approximately the first year, subject to actual
traffic and billed usage.

Set billing alerts before deploying any billable resource. Suggested monthly alert
thresholds are $5, $10, $15, and $25. Budget alerts notify; they do not automatically
cap spending.

## Remaining Repository Findings

Phase 1 resolved tracked-environment, legacy-pipeline, generated-documentation,
duplicate-tooling, and stale-artifact findings. Phase 2 separated application
boundaries, added checks, and reduced the API image by 73.7%. Remaining intentional
work is:

- `railway.json`, `render.yaml`, and the GitHub Pages workflow remain only as
  transitional/rollback deployment definitions until Cloud Run staging works.
- The frontend now defaults to same-origin `/api` requests.
- The JSON ingestion pipeline and editor UI are still substantial cohesive workflows;
  future changes should continue extracting independently testable behavior.
- The API image no longer contains or seeds SQLite/historical JSON. Migrations and
  initialization are explicit deployment jobs.

## Refactoring Direction

### Backend

- Split Flask route definitions from business logic and data access.
- Organize code into routes, services, repositories/query modules, models, schemas,
  and maintenance scripts.
- Break up `dashboard_stats.py`, `import_json_to_db.py`, `stats_db.py`, and `app.py`
  by responsibility.
- Centralize configuration and environment validation.
- Replace ad hoc printing with structured logging.
- Establish consistent session, transaction, error, and response handling.
- Remove pandas and NumPy if the retired CSV runtime is their only remaining use.
- Lock dependencies reproducibly.

### Frontend

- Keep the current presentation and behavior.
- Add route-level lazy loading so large pages are not part of the initial bundle.
- Split oversized pages into cohesive components, hooks, types, and pure utilities.
- Centralize API calls and remove the hard-coded production host.
- Remove unused dependencies and stale Create React App files.
- Consolidate Node/Tailwind tooling into one clearly documented setup.
- Use a modern browser compilation target after recording supported browsers.

### Container

- Build only the Flask API into the Cloud Run runtime container.
- Serve the React build from Firebase Hosting rather than Flask.
- Remove Node and frontend output from the runtime API image.
- Do not build or seed a production database during image construction.
- Run as a non-root user, pin appropriate base-image versions, and add a health
  check where supported.
- Keep database migration and seed/import operations as explicit jobs or commands.

## Documentation Plan

Create or update the following canonical Markdown documents:

1. Root README with project overview, prerequisites, local setup, and common tasks.
2. Current architecture and end-to-end request/data flow.
3. Current database schema, including `team_logos` and every implemented table.
4. JSON editor validation, preview, ingestion, archive, and transaction lifecycle.
5. API routes, request conventions, authentication, and error behavior.
6. Environment variables and secret management.
7. Local development with PostgreSQL and optional SQLite workflows.
8. Deployment guide for staging and production.
9. Backup, restore, rollback, and incident-response runbook.
10. Analytics methodology and historical-data exclusion rules.
11. Architecture decision records for the database, hosting, object storage,
    authentication, and deployment workflow.

Completed implementation plans should move to a historical documentation area or
be marked clearly as completed. Generated PDFs should be removed or generated from
canonical Markdown by an explicit release/documentation task.

## Implementation Phases

### Phase 0: Baseline And Decisions

Tasks:

- Record current API response fixtures for representative seasons and divisions.
- Record database table counts and the database-health summary.
- Confirm the current backend test suite passes.
- Add or identify frontend build, type-check, and smoke-test baselines.
- Capture representative screenshots for visual-regression comparison.
- Produce an explicit keep/remove/archive inventory for questionable files.
- Record architecture decisions in ADRs.
- Confirm the Google Cloud project, preferred region, domain plan, and production
  availability expectations.

Done when:

- Current behavior can be compared automatically or repeatably after refactors.
- No production architecture decision remains implicit.
- Every cleanup candidate has an approved disposition.

### Phase 1: Repository Cleanup

Completed July 19, 2026. The execution record and verification results are in
[`phase-1-repository-cleanup.md`](phase-1-repository-cleanup.md).

Tasks:

- Stop tracking virtual environments, caches, IDE state, databases, and backups.
- Remove or archive the old website prototype and verified legacy CSV pipeline.
- Move maintenance utilities under a dedicated scripts/tools directory.
- Remove unused deployment definitions after the target architecture is approved.
- Remove stale generated documentation and frontend artifacts.
- Consolidate package tooling and document the supported commands.

Done when:

- A fresh clone contains only source, intentional assets, documentation, tests, and
  reproducible configuration.
- A collaborator can install dependencies and run the application using documented
  commands.
- Baseline behavior and tests are unchanged.

### Phase 2: No-Change Code Refactor

Completed July 19, 2026. The implementation record and verification results are in
[`phase-2-no-change-refactor.md`](phase-2-no-change-refactor.md).

Tasks:

- Refactor backend routes, services, queries, configuration, and logging.
- Refactor frontend pages, hooks, API clients, types, and lazy-loaded routes.
- Add linting/formatting and fill important regression-test gaps.
- Optimize the Docker build without changing the deployment target yet.
- Remove dependencies proven to be unused.

Done when:

- API fixtures, analytics results, and UI regression checks match the baseline.
- Large modules have clear responsibilities and manageable sizes.
- Build, lint, type-check, and test commands pass from a clean clone.

### Phase 3: Production-Capable Application

Design checkpoint proposed July 19, 2026. The PostgreSQL, migration, administrator,
public review-queue, and accepted-archive design is in
[`phase-3-technical-specification.md`](phase-3-technical-specification.md). No cloud
resources are provisioned by this checkpoint.

Tasks:

- Add Alembic and create a baseline database migration.
- Add PostgreSQL driver and test configuration.
- Replace SQLite-specific health-dashboard SQL with portable queries or
  dialect-specific implementations.
- Add an archive-storage interface with local and Cloud Storage implementations.
- Define an idempotent staged-upload workflow spanning object storage and the SQL
  transaction, including reconciliation of interrupted uploads.
- Add Firebase Authentication to administrator screens and verify ID tokens in
  Flask.
- Require authentication for uploads, health review actions, and sensitive health
  details.
- Restrict CORS and request sizes appropriately.
- Add a lightweight liveness/readiness endpoint, structured logs, request IDs, and
  safe production error responses.
- Make frontend API requests use same-origin `/api` paths.

Done when:

- The application passes its test suite on PostgreSQL.
- A JSON editor submission persists to PostgreSQL and durable object storage.
- Unauthorized mutation attempts are rejected.
- Production no longer depends on persistent container files.

### Phase 4: Infrastructure And Staging

Tasks:

- Provision Firebase Hosting, Cloud Run, Cloud SQL, Cloud Storage, Secret Manager,
  service accounts, monitoring, and budget alerts.
- Keep Cloud Run, Cloud SQL, and Cloud Storage in a compatible US region.
- Configure GitHub Actions through Workload Identity Federation rather than a
  long-lived service-account key.
- Create separate staging and production settings and resources where practical.
- Configure Firebase Hosting rewrites and React route fallback behavior.
- Configure Google sign-in and an explicit administrator allowlist.
- Deploy staging and rebuild its database from authoritative JSON.
- Compare staging counts, health findings, analytics, and API fixtures with the
  baseline.
- Complete a real editor upload, backup, and restore test in staging.

Done when:

- Staging represents the production topology.
- Deployment is reproducible from GitHub Actions.
- No secret is stored in Git or a built frontend bundle.
- A documented restore procedure has succeeded.

### Phase 5: Production Cutover

Tasks:

- Announce and begin a brief upload freeze.
- Take a final SQLite and JSON archive backup.
- Rebuild PostgreSQL from the authoritative JSON and required registries.
- Run count, integrity, health-dashboard, and representative analytics checks.
- Deploy Cloud Run and Firebase Hosting.
- Connect the custom domain and verify managed TLS.
- Perform a controlled production JSON editor upload.
- Verify database persistence, archived JSON, logs, cache invalidation, and public
  analytics.
- Retain the previous deployment temporarily as a read-only rollback option.

Done when:

- Public pages and administrator workflows work on the production domain.
- Monitoring, budget alerts, backups, and authentication are active.
- The old production deployment is no longer receiving writes.
- The rollback and incident contacts/procedure are documented.

### Phase 6: Post-Launch Hardening

Tasks:

- Review real Cloud Run cold-start and endpoint latency.
- Review Firebase Hosting bandwidth, especially music and background assets.
- Adjust media caching and loading without changing design.
- Tune PostgreSQL indexes and connection pooling from measured queries.
- Resolve production-only errors and noisy alerts.
- Perform the first scheduled restore drill.
- Remove the old deployment after the rollback window ends.

Done when:

- Performance and costs are understood from measured production traffic.
- No launch-critical incident remains open.
- Recovery procedures are part of normal operations.

## PostgreSQL Migration Strategy

The production database should be rebuilt from the authoritative JSON and registries
rather than copied directly from SQLite. The importer is already the mechanism that
defines normalized SQL state, and rebuilding verifies that production remains
reproducible.

Migration steps:

1. Add Alembic and PostgreSQL compatibility locally.
2. Create a clean PostgreSQL database from migrations.
3. Import the full authoritative JSON archive.
4. Apply identity and normalization registries through their normal code paths.
5. Compare every table count with the verified SQLite database.
6. Run database-health screening and investigate unexpected differences.
7. Compare representative public API and analytics results.
8. Test a new editor submission and confirm archive/database consistency.
9. Repeat the same scripted procedure for final production cutover.

Internal numeric IDs do not need to remain identical unless an external contract is
found to depend on them. Stable natural identifiers, relationships, and API results
must remain correct.

## Upload And Archive Reliability

Object storage and PostgreSQL cannot share a single database transaction. The upload
flow must therefore be idempotent and recoverable.

Recommended model:

1. Validate and fingerprint the JSON.
2. Upload it to a temporary/staged Cloud Storage key.
3. Begin the PostgreSQL transaction and record the intended object key/fingerprint.
4. Import and commit the database transaction.
5. Promote or copy the staged object to its immutable final key.
6. Mark the source record complete.
7. Reconcile incomplete states through a safe maintenance job and health finding.

Retries must not create duplicate matches or archive objects. Object keys should be
derived from stable metadata and/or content fingerprints rather than random upload
times alone.

## Backup And Recovery Plan

Use layered recovery:

- Enable Cloud SQL automated backups.
- Enable point-in-time recovery with a documented retention window.
- Export logical PostgreSQL backups to a separate Cloud Storage location on a
  schedule.
- Enable Cloud Storage versioning or soft-delete behavior for source JSON.
- Apply lifecycle policies to control storage growth.
- Keep approximately 30 daily, 12 monthly, and selected annual logical backups,
  adjusted after measuring their small actual size.
- Perform a documented restore drill at least quarterly and before risky migrations.
- Back up before every production schema migration that could make rollback
  difficult.

Restores should target a new database instance or database first. Do not overwrite
the only production copy during a recovery test.

## Authentication And Security

- Public analytics endpoints remain publicly readable.
- JSON editor ingestion, database-health review/dismissal actions, and sensitive
  operational details require authentication.
- Use Firebase Google sign-in and verify Firebase ID tokens at the Flask API.
- Maintain a small server-side administrator allowlist or role claim.
- Do not embed a static bearer secret in the frontend bundle.
- Store database credentials and transitional secrets in Secret Manager.
- Use least-privilege service accounts for runtime and deployment.
- Restrict CORS to the production/staging domains if cross-origin access remains.
- Apply upload size limits, request timeouts, and appropriate rate limits.
- Avoid returning database paths, stack traces, or secret-bearing configuration in
  public responses.
- Add automated dependency and secret scanning to CI.

## CI/CD And Continued Development

### Pull Requests

Required checks should include:

- Backend unit and integration tests.
- PostgreSQL importer/migration tests.
- Frontend type-check, lint, tests, and production build.
- Representative API contract tests.
- Docker image build.
- Dependency and secret scanning.

Use Dependabot or Renovate for scheduled dependency updates. Require review before
merging production-impacting changes.

### Environments

- Developers use disposable local databases and storage.
- Staging uses separate data, credentials, storage prefixes/buckets, and deployment
  configuration.
- Production data must never be used as an ordinary development database.
- Staging upload tests must never write to production storage or PostgreSQL.

### Deployments

- Use GitHub Actions with short-lived Workload Identity Federation credentials.
- Avoid downloadable, long-lived Google service-account keys.
- Deploy immutable Cloud Run revisions.
- Use a manual approval or protected GitHub environment for production.
- Retain enough old revisions for fast application rollback.
- Run schema migrations as an explicit, observable step.
- Use backward-compatible expand/deploy/contract migrations when possible.
- Treat application rollback and database rollback as separate procedures.

### Production Changes

- Do not edit the production schema manually.
- Do not directly patch production data when the supported editor/importer or a
  reviewed remediation script can represent the change.
- Record administrator mutations and source fingerprints for auditing.
- Create a backup and rollback plan before destructive migrations.
- Maintain release notes for user-visible changes and operational changes.

## Monitoring And Alerts

At minimum, monitor:

- Public site availability.
- API error rate and latency.
- Cloud Run startup latency, instance count, memory, and request volume.
- Cloud SQL CPU, memory pressure where available, connections, storage, and backup
  success.
- JSON archive failures and incomplete upload states.
- Database-health critical finding count.
- Firebase Hosting bandwidth and storage.
- Monthly cost and forecasted cost.

Logs should be structured and contain request IDs, endpoint, status, duration, and a
safe actor identifier for administrator operations. They must not contain bearer
tokens, raw credentials, or unnecessary uploaded personal data.

## Risks And Mitigations

### Refactor Changes Behavior

Mitigation: Establish API, analytics, test, and screenshot baselines before moving
code. Keep cleanup/refactor commits separate from production-infrastructure changes.

### Legacy File Is Removed Prematurely

Mitigation: Produce a keep/remove/archive inventory and verify imports, references,
tests, and deployment usage before deletion.

### SQLite-Specific SQL Blocks PostgreSQL

Mitigation: Search raw SQL and health queries, add PostgreSQL integration tests, and
keep dialect-specific behavior isolated.

### Upload Commits To Only One Durable Store

Mitigation: Use staged objects, stable fingerprints, upload states, idempotent
retries, and reconciliation findings.

### Costs Exceed Expectations

Mitigation: Scale Cloud Run to zero, start with the smallest database, configure
budgets first, use long-lived asset caching, and review bandwidth after launch.

### Media Bandwidth Dominates Cost

Mitigation: Fingerprint assets, set immutable cache headers, avoid preloading unused
music/backgrounds, measure transfer, and consider moving heavy media to a separately
controlled bucket/CDN only if needed.

### Production Migration Produces Different Analytics

Mitigation: Rebuild staging from the same sources, compare table counts and API
fixtures, run health screening, and require an explicit cutover checklist.

### Administrator Credential Is Exposed

Mitigation: Replace static frontend bearer tokens with short-lived Firebase ID
tokens, verify server-side, and keep runtime/deployment secrets in managed secret
storage.

## Decision Log

| Decision | Recommended choice | Status |
| --- | --- | --- |
| Production relational database | Cloud SQL Enterprise for PostgreSQL 18 | Accepted |
| Static frontend hosting | Firebase Hosting | Accepted |
| API hosting | Cloud Run | Accepted |
| Archived JSON storage | Cloud Storage | Accepted |
| Administrator authentication | Firebase Authentication with Google sign-in | Accepted |
| CI/CD authentication | Workload Identity Federation | Accepted |
| Production region | `us-central1` | Accepted |
| Initial domain | Firebase staging subdomain; custom domain before production | Accepted |
| Cloud Run minimum instances | Zero initially | Accepted |
| Initial availability target | Single-zone shared-core/no formal SLA | Accepted |
| Backup/PITR retention | Seven daily backups and seven days of logs | Accepted |

These decisions were accepted by the owner on July 19, 2026. Record meaningful
reversals in an ADR rather than silently rewriting historical reasoning.

## Overall Completion Criteria

This production-readiness effort is complete when:

- A new collaborator can clone, configure, test, and run the project from current
  documentation.
- The repository no longer tracks local environments, databases, generated caches,
  or unused deployment systems.
- Refactored code passes regression checks without unintended UI or analytics
  changes.
- PostgreSQL is created through migrations and reproducibly populated from the JSON
  archive.
- Production uploads persist to both PostgreSQL and durable JSON archive storage.
- Administrator operations require verified authentication.
- Deployment uses repeatable CI/CD with no long-lived cloud key in GitHub.
- Backups, PITR, logical exports, and a tested restore procedure exist.
- Monitoring and cost alerts are active.
- The custom domain serves the site over managed HTTPS.
- Staging and production are isolated.
- The old deployment and obsolete infrastructure definitions have been retired.

## Reference Documentation

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Run container filesystem behavior](https://docs.cloud.google.com/run/docs/container-contract)
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
- [Cloud SQL backups](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/backups)
- [Cloud SQL point-in-time recovery](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/pitr)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run)
- [Firebase Hosting quotas and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Workload Identity Federation for deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Google Cloud budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Neon pricing](https://neon.com/pricing)
