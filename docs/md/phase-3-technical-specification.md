# Phase 3 Production-Capable Application Specification

- Status: local implementation complete; Phase 4 cloud checkpoint pending
- Prepared: July 19, 2026
- Scope: application and local development only; no cloud resources are created

The approved local implementation is documented in
`phase-3-local-implementation.md`. No cloud resource has been provisioned.

## Goals

Phase 3 makes the application safe to deploy without changing the public analytics
contract unnecessarily. It must:

- run against PostgreSQL 18 in development, tests, and production;
- create and change schemas only through Alembic;
- let anonymous users submit valid or warning-bearing JSON to a temporary review
  queue without writing analytics data;
- let an owner-authorized Google account review and import queued JSON;
- archive only canonical JSON whose match transaction committed successfully;
- give administrators read-only direct SQL access without cloud-management access;
- remove production dependence on container-local files;
- make committed matches visible to analytics within a few seconds; and
- preserve the Phase 0 API, analytics, and UI regression evidence.

## Non-Goals

Phase 3 does not provision Cloud SQL, Cloud Run, Firebase Hosting, Cloud Storage,
IAM, budgets, or production secrets. Those are Phase 4 checkpoints. It also does
not add automated bulk match ingestion, direct public database writes, Redis,
background workers, or a Cloud Function.

## Environments

| Environment | PostgreSQL location | Purpose |
| --- | --- | --- |
| Local development | PostgreSQL 18 container | Normal coding and manual testing |
| Automated test | Disposable PostgreSQL 18 service | Migration and integration tests |
| Staging | `ctc_staging` database on the initial Cloud SQL instance | Real cloud integration checks |
| Production | `ctc_prod` database on the same initial Cloud SQL instance | Live application |

The local Flask and Vite processes remain outside Docker. A small Compose file will
run PostgreSQL only, on a host port that does not conflict with an existing local
PostgreSQL installation. Named database volumes remain untracked and disposable.

Staging and production use different databases, roles, service accounts, secrets,
storage namespaces, and Firebase configuration. They share the initial Cloud SQL
instance only to avoid a second fixed compute charge. Load testing and destructive
migration rehearsals must not run on that shared instance.

## Database And Migration Strategy

### Connection Configuration

`DATABASE_URL` remains the common SQLAlchemy input. Configuration will reject
missing or SQLite production URLs when `APP_ENV` is `staging` or `production`.
Engine creation will be centralized and apply dialect-appropriate settings:

- PostgreSQL: connection pre-ping, a deliberately small pool, bounded overflow,
  connection recycling, and statement/application naming where appropriate;
- SQLite: foreign keys, WAL, and busy timeout for local compatibility; and
- tests: explicit database URLs with no implicit connection to production.

The initial Cloud Run service will use its service identity to reach the Cloud SQL
Unix socket and a dedicated runtime database credential from Secret Manager.
Human SQL access will use IAM database authentication and the Cloud SQL Auth Proxy.

### Alembic Sequence

1. `0001_current_schema` reproduces the current SQLAlchemy schema exactly.
2. `0002_production_state` adds administrator, review, audit, and durable archive
   state.
3. Later migrations remain small and feature-specific.

An empty database must be created with `alembic upgrade head`. Application startup
must not call `metadata.create_all()` outside explicit test/local bootstrap tools.
Staging and production migrations run as an explicit deployment step before a new
revision receives traffic.

Historical production data will be rebuilt from accepted JSON and reviewed
registries. The SQLite database file will not be copied into PostgreSQL.

### Portability Work

The database-health service currently executes SQLite `PRAGMA` checks. Phase 3
will introduce a dialect boundary:

- SQLite retains `integrity_check` and `foreign_key_check` for local diagnostics.
- PostgreSQL verifies connectivity, migration revision, invalid constraints where
  available, and application-level foreign-key/catalog checks.
- Public health returns only a safe summary.
- Detailed health findings remain administrator-only.

SQLite-specific maintenance scripts will either become SQLAlchemy/PostgreSQL
portable or be labeled explicitly as historical/local-only tools.

## Proposed PostgreSQL Roles

| Role | Login | Purpose | Key privileges |
| --- | --- | --- | --- |
| `ctc_migrator` | Deployment only | Alembic and controlled imports | Schema ownership and migrations |
| `ctc_app_prod` | Cloud Run runtime | Production API | Required table CRUD only |
| `ctc_app_staging` | Staging runtime | Staging API | CRUD only in `ctc_staging` |
| `ctc_readonly` | No | Group role for human administrators | Connect, schema usage, table/sequence select |
| Owner break-glass identity | IAM login | Exceptional recovery | Granted temporarily and audited |

Administrators receive the Cloud SQL Client and Cloud SQL Instance User IAM roles,
then inherit `ctc_readonly` in PostgreSQL. They do not receive direct production
insert, update, delete, DDL, secret, deployment, or cloud-administration access.
Default privileges must grant `ctc_readonly` access to future tables created by the
migration owner.

## Application Identity Model

Public analytics and JSON editing remain anonymous. Submitting a server-validated
document to the review queue also remains anonymous. Administrator operations
require a verified Firebase Google identity that is active in `admin_users`.

### `admin_users`

| Column | Purpose |
| --- | --- |
| `admin_user_id` | Internal primary key |
| `firebase_uid` | Unique Firebase identity; null until first accepted sign-in |
| `email` | Display email from the verified Google token |
| `normalized_email` | Unique lowercase authorization key |
| `role` | `owner` or `admin` |
| `status` | `invited`, `active`, or `revoked` |
| `github_username` | Optional collaboration identity |
| `database_access_status` | `not_requested`, `provisioned`, or `revoked` |
| `repository_access_status` | `not_requested`, `provisioned`, or `revoked` |
| `created_by_admin_user_id` | Owner who granted access |
| `created_at`, `activated_at`, `revoked_at`, `last_login_at` | Audit timestamps |

The first owner is created by an explicit bootstrap command using a deployment
setting. No public endpoint can create the first owner. The owner-only access page
can invite, activate, and revoke application administrators, but it cannot modify
Google Cloud IAM or GitHub permissions.

### Authorization Rules

- Anonymous: public analytics, local editor, queue submission, receipt status.
- Admin: queue review, editor preview/commit, detailed health, health reviews,
  addition details, and access instructions.
- Owner: all admin permissions plus application administrator management.
- Cloud infrastructure: owner only, outside the application.

The transitional bearer token and local-IP write bypass will be removed from
staging and production. A tightly scoped test/local authentication override may
exist only behind explicit non-production configuration.

## Public Review Queue

### Validation Rules

- Validation errors block submission.
- Warnings are permitted after the submitter explicitly acknowledges them.
- Server validation always repeats browser validation.
- Queue submission never invokes the match importer or writes analytics tables.
- Request bodies are JSON-only and subject to a strict size limit.
- Duplicate active fingerprints are rejected or return the existing receipt.

### `review_submissions`

| Column | Purpose |
| --- | --- |
| `submission_id` | Random UUID primary key and public receipt identifier |
| `fingerprint` | SHA-256 of canonical cleaned JSON |
| `queue_object_key` | Temporary storage key, never an accepted archive key |
| `original_filename` | Sanitized display metadata only |
| `content_length` | Request/storage validation |
| `validation_version` | Validator contract used at submission |
| `warnings_json` | Warnings visible to the reviewer |
| `warnings_acknowledged` | Submitter confirmation |
| `status` | `pending`, `in_review`, `accepted`, `rejected`, `expired`, or `failed` |
| `claimed_by_admin_user_id`, `claimed_at` | Review ownership |
| `reviewed_by_admin_user_id`, `reviewed_at` | Decision audit |
| `decision_note` | Required for rejection; private to administrators |
| `accepted_match_id` | Match created by acceptance, if any |
| `submitted_at`, `expires_at`, `updated_at` | Lifecycle timestamps |

A partial unique index prevents two active submissions with the same fingerprint.
The public receipt endpoint exposes only status and safe timestamps. It never
returns the JSON, administrator note, identities, or database details.

### Abuse Controls

The initial design avoids Redis and external anti-abuse services:

- maximum document and request sizes are enforced before expensive processing;
- stable fingerprints prevent repeated identical queue objects;
- a small PostgreSQL fixed-window counter limits anonymous submissions by an
  HMAC-derived network identifier;
- the HMAC key is a secret and raw IP addresses are not retained;
- Cloud Run has a conservative maximum instance count; and
- temporary objects expire after 30 days.

CAPTCHA can be added if observed abuse justifies its complexity. Rate-limit values
remain deployment configuration and will be reviewed before staging.

### Queue API

Public endpoints:

- `POST /api/review-submissions` validates and queues canonical JSON.
- `GET /api/review-submissions/{receipt}` returns safe status only.

Administrator endpoints:

- `GET /api/admin/review-submissions` lists and filters the queue.
- `GET /api/admin/review-submissions/{id}` loads a submission into the editor.
- `POST /api/admin/review-submissions/{id}/claim` claims a pending item.
- `POST /api/admin/review-submissions/{id}/reject` records a reason and schedules
  temporary-object deletion.
- `POST /api/admin/review-submissions/{id}/accept` performs the reviewed import.

Direct administrator-created JSON uses the same acceptance service after preview,
so there is one authoritative commit path.

## Accepted Archive

### Storage Interface

Application code depends on an `ArchiveStorage` interface rather than filesystem
paths. Implementations are:

- `LocalArchiveStorage` for development and selected tests;
- `GcsArchiveStorage` for staging and production; and
- an in-memory/fake implementation for unit tests.

The interface supports staging temporary bytes, promoting with an overwrite
precondition, reading/verifying bytes, and deleting temporary objects.
Reconciliation is driven by durable database state rather than costly bucket-wide
listing.

### Object Namespaces

- Temporary public queue: `queue/pending/{submission_uuid}.json`
- Temporary direct admin upload: `queue/admin/{operation_uuid}.json`
- Accepted archive:
  `accepted/{league}/{season}/{division}/{safe-label}--{fingerprint-prefix}.json`

Accepted objects contain the exact canonical cleaned JSON imported into the
database. Object creation uses a no-overwrite generation precondition. Rejected,
failed-before-commit, and expired temporary objects never enter `accepted/`.

### `source_files` Additions

The existing unique path and SHA-256 constraints remain. Add:

| Column | Purpose |
| --- | --- |
| `storage_provider` | `local` or `gcs` |
| `storage_object_key` | Provider-relative immutable key |
| `archive_status` | `pending`, `complete`, or `repair_required` |
| `storage_generation` | GCS generation/version identifier when available |
| `accepted_by_admin_user_id` | Administrator responsible for acceptance |
| `review_submission_id` | Originating queue record, if applicable |
| `archived_at` | Completed archive timestamp |
| `archive_attempts` | Reconciliation counter |
| `last_archive_error_code` | Safe operational code, not raw exception text |

Historical imported files are marked `complete` by the rebuild process.

### Cross-System Commit State

Cloud Storage and PostgreSQL cannot share one atomic transaction. Acceptance is
therefore intentionally idempotent:

1. Revalidate the canonical bytes and expected fingerprint.
2. Verify the administrator and queue claim.
3. Ensure a temporary object exists with the expected digest.
4. Begin the PostgreSQL transaction.
5. Recheck duplicate source and match constraints.
6. Insert the match, source row with `archive_status=pending`, additions, and audit
   event.
7. Commit PostgreSQL; analytics now see the match.
8. Promote the exact temporary object to its immutable accepted key.
9. Mark the source `complete` in a short second transaction.
10. Invalidate only necessary process-local caches and return the match ID.

If step 8 or 9 fails, the accepted database match remains visible and the source is
`repair_required`. Repeating the operation or running reconciliation verifies the
fingerprint and safely completes the archive. It never inserts the match twice.

## Durable Administrative State

The current health-review JSON file must move into PostgreSQL because Cloud Run
files are disposable.

### `health_issue_reviews`

Stores issue key, open/dismissed status, required note, reviewer identity, and
timestamps. Hard integrity findings remain non-dismissible.

### `admin_audit_logs`

Records administrator login/access changes, queue claims and decisions, match
acceptance, health reviews, and other mutations. It stores a request ID and safe
structured details but never tokens, database credentials, or complete submitted
JSON.

The existing `database_addition_logs` remains the catalog/match addition feed. It
does not replace the security audit log.

## Analytics Freshness And Live Updates

No Cloud Function or background refresh job is required. Analytics query the same
PostgreSQL transaction that accepted the match.

The current one-hour in-process analytics cache will be removed initially for
database-backed results. The small dataset and low request volume favor correctness
and simplicity. Short caching can be reintroduced only after measurement, with a
cross-instance-safe revision strategy.

After acceptance, the API returns the new match detail and ID so the editor can
show it immediately. The administrator additions page will use bounded polling,
initially every 15 seconds while visible, rather than an indefinite SSE connection
through Firebase Hosting's request timeout.

## Health And Production Runtime

- `GET /api/health/live` verifies that the Flask process can serve requests.
- `GET /api/health/ready` verifies configuration, migration revision, and a bounded
  database query without exposing credentials or record details.
- Public database health exposes only status and aggregate counts.
- Administrator health exposes detailed findings and reconciliation state.
- Every request receives or propagates a request ID.
- Production errors use stable public error codes and safe messages.
- Logs are structured and include request ID, route, status, duration, and safe
  actor identity.

## GitHub And Human Database Onboarding

The owner-only access page records checklist status and displays instructions, but
provider access remains controlled by the owner in Google Cloud and GitHub.

Administrator onboarding requires:

1. owner adds the verified Google email to the application;
2. administrator signs in and binds the Firebase UID;
3. owner grants Cloud SQL Client and Instance User roles plus the PostgreSQL
   `ctc_readonly` role;
4. administrator installs Google Cloud CLI, Cloud SQL Auth Proxy, and a SQL client;
5. owner grants repository Write access;
6. administrator enables GitHub two-factor authentication, clones, branches, runs
   checks, and opens a pull request; and
7. protected branches require owner/code-owner approval and passing CI.

Administrators receive no cloud resource-management, billing, secret, deployment,
or direct production write permissions.

## Test And Acceptance Matrix

Phase 3 is complete only when:

- every Alembic migration applies to empty PostgreSQL and upgrades a supported
  local database path;
- the authoritative JSON rebuild produces expected PostgreSQL counts;
- all Phase 0 API fixtures match or have an explicitly approved contract change;
- the full backend suite runs on PostgreSQL in CI;
- anonymous valid and warning-acknowledged submissions enter only the queue;
- validation errors, oversized requests, duplicates, and rate-limit excesses are
  rejected safely;
- rejected/expired queue objects are deleted and never archived;
- admin acceptance produces one match, one accepted object, and an audit trail;
- retries cannot duplicate a match or accepted object;
- archive interruption is visible and reconciliation repairs it;
- unauthorized mutation and detailed-health requests return 401 or 403;
- read-only SQL identities cannot mutate production tables;
- accepted matches appear immediately in representative analytics;
- local files are not required for production state; and
- frontend type checks, production build, and browser smoke tests pass.

## Implementation Order After Approval

1. Add local PostgreSQL Compose configuration, environment validation, Psycopg,
   Alembic, and PostgreSQL CI service.
2. Create and test the current-schema baseline migration.
3. Port database health and remove implicit production `create_all()`.
4. Add administrator/authentication domain models and server-side authorization.
5. Add storage interface and local/fake implementations.
6. Add public review queue, expiry, rate limiting, and receipt endpoint.
7. Add administrator queue/access pages and the single acceptance service.
8. Add GCS and Firebase adapters behind configuration without provisioning them.
9. Replace stale analytics caching and SSE behavior.
10. Run the complete PostgreSQL, API, UI, security, and reconciliation suite.

## Owner Checkpoint

Approval of this specification authorizes local Phase 3 implementation and schema
migrations. It does not authorize creating or changing Google Cloud, Firebase,
GitHub access, billing, DNS, or production resources. Each remains a separate
reviewed Phase 4 checkpoint.
