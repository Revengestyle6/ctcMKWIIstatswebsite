# Phase 3 Local Implementation

- Status: implemented and locally verified
- Scope: application, schema, adapters, local runtime, and CI gates
- Cloud status: Phase 4 is in progress. The Firebase project, authentication
  configuration, billing safeguards, and shared Cloud SQL instance exist; the
  authoritative checkpoint record is
  [`phase-4-resource-inventory.md`](phase-4-resource-inventory.md).

## Delivered Components

| Component | Location | Purpose |
| --- | --- | --- |
| Production-state schema | `backend/models.py`, migration `20260719_0002` | Administrators, queue, rate limits, audit, durable health reviews, and archive state |
| Administrator authorization | `backend/admin_auth.py` | Verifies Firebase ID tokens and checks the database allowlist |
| Owner bootstrap | `backend/scripts/bootstrap_owner.py` | Creates the first invited owner from an explicit verified email |
| Review queue | `backend/review_queue.py`, `backend/routes/reviews.py` | Anonymous validation/submission and admin claim, reject, edit, and accept |
| Accepted archive | `backend/archive_storage.py` | Local and GCS implementations with immutable no-overwrite promotion |
| Acceptance state machine | `backend/acceptance_service.py` | One idempotent database-first path for direct and queued admin imports |
| Maintenance | `backend/phase3_maintenance.py`, `backend/scripts/run_phase3_maintenance.py` | Expires temporary reviews and repairs interrupted accepted archives |
| Access administration | `backend/routes/access.py`, `/admin/access` | Owner allowlist management and admin onboarding instructions |
| Queue interface | `/admin/review-queue`, `/json-editor` | Admin review in the existing editor; public users submit without analytics writes |
| Operations | `backend/routes/operations.py` | Liveness, exact-revision readiness, and public aggregate data health |

Only acceptance creates analytics rows. Queue submission never invokes the importer.
The PostgreSQL transaction commits first, so the new match is immediately visible.
The exact canonical bytes are then promoted to `accepted/`. A storage failure leaves
the visible match marked `repair_required`; maintenance safely completes it later.

## Environment Configuration

The committed `.env.example` lists local values. Staging and production values will
be configured on Cloud Run or in Secret Manager only after owner approval.

| Variable | Required where | Notes |
| --- | --- | --- |
| `APP_ENV` | All | Selects local, test, staging, or production policy; every environment requires PostgreSQL |
| `DATABASE_URL` | PostgreSQL environments | Runtime database credential; never a frontend variable |
| `FIREBASE_PROJECT_ID` | API when Firebase sign-in is used | Audience used to verify Firebase ID tokens; local real-Google sign-in uses `mkw-stats` |
| `VITE_FIREBASE_*` | Hosted frontend build | Public Firebase web identifiers, not secrets |
| `ARCHIVE_STORAGE_PROVIDER` | Hosted API | Must be `gcs` in staging/production |
| `ARCHIVE_GCS_BUCKET` | Hosted API and maintenance job | Bucket name selected at the cloud checkpoint |
| `SUBMISSION_RATE_LIMIT_SECRET` | Hosted API | Secret HMAC key; raw client IPs are never stored |
| `MAX_REVIEW_SUBMISSION_BYTES` | Optional | Defaults to 1 MiB of canonical JSON |
| `SUBMISSION_RATE_LIMIT` | Optional | Defaults to 10 submissions per window |
| `ALLOW_DEV_AUTH` | Explicit local/test use only | Must remain false in hosted environments |

The frontend defaults to its own origin. `VITE_API_URL` is needed only when the API
is intentionally hosted on another origin. Firebase code is route/session gated so
anonymous analytics traffic does not load the authentication bundle.

## Local Operation

Start PostgreSQL and migrate it from the repository root:

```bash
docker compose up -d postgres
export APP_ENV=local
export DATABASE_URL=postgresql+psycopg://ctc_local:ctc_local@127.0.0.1:55432/ctc_dev
export FIREBASE_PROJECT_ID=mkw-stats
.venv/bin/alembic upgrade head
.venv/bin/python backend/import_json_to_db.py --database-url "$DATABASE_URL"
```

Create the local owner only after choosing the email that should become the real
owner identity:

```bash
cd backend
../.venv/bin/python scripts/bootstrap_owner.py --email you@example.com
```

For an intentional local UI authentication override, set both
`ALLOW_DEV_AUTH=true` for Flask and `VITE_ALLOW_DEV_AUTH=true` for Vite. This path
is rejected as a production authentication design and exists only for local work.

Run queue expiry and archive reconciliation from `backend/`:

```bash
../.venv/bin/python scripts/run_phase3_maintenance.py
```

In production this command will become a small scheduled Cloud Run Job using the
same runtime database and bucket identities. Its schedule and resources require a
separate Phase 4 approval.

## Access Boundaries

- Anonymous users can use analytics, edit/preview JSON, submit to the queue, and
  query only their opaque receipt status.
- Admins must use an allowlisted, verified Google account. They can claim/reject/
  accept reviews, commit direct editor uploads, see detailed health, and view access
  instructions.
- Owners can additionally invite/revoke application admins and track their SQL and
  repository onboarding status.
- Application admins do not receive cloud resource management. Direct SQL will use
  the `ctc_readonly` PostgreSQL group through Cloud SQL Auth Proxy.
- GitHub Write access is granted separately. Admins work on branches and open pull
  requests; protected branches require passing CI and owner/code-owner approval.

The access page records provider onboarding status but deliberately cannot grant
Google Cloud IAM or GitHub permissions. The owner performs those provider steps.

## Verified Evidence

- 72 backend tests pass locally; the PostgreSQL-only test is skipped unless its
  dedicated URL is supplied.
- Clean PostgreSQL migration and model-drift checks succeed.
- Clean PostgreSQL 18 migration and `alembic check` succeed.
- The accepted archive imports 244 matches and the established Phase 0 counts.
- A dedicated PostgreSQL integration test accepts one match and queries it
  immediately.
- Frontend formatting/type checks and the production build pass.
- All 20 desktop/mobile browser smoke checks pass.
- The production API image builds without frontend, historical JSON, test files,
  or a generated database and runs as an unprivileged user.
- Container liveness, exact migration readiness, and aggregate data health return
  healthy against PostgreSQL.

## Phase 4 Owner Checkpoints

This is a summary of the handoff from Phase 3. The Phase 4 resource inventory is
authoritative for current status. Before each remaining batch, review the exact
project, region, resource name, access grants, settings, expected monthly cost, and
any credentials or domain choices needed from the owner:

1. [Complete] Create the `mkw-stats` Google Cloud/Firebase project and register
   its web app; link billing and configure project-level budget alerts.
2. [Complete] Create the cost-first shared Cloud SQL instance, then create
   `ctc_staging`, `ctc_prod`, their runtime/migration roles, `ctc_readonly`, and
   future-table default privileges.
3. [Pending] Create the archive/export bucket, staging/production namespaces,
   retention/lifecycle rules, and service accounts.
4. [Complete] Configure Firebase Google sign-in, authorize localhost, provide the
   public web configuration, and verify the allowlisted owner login.
5. [Pending] Create secrets, migrate/import staging data, and bootstrap the owner
   email.
6. [Pending] Deploy Cloud Run staging with zero minimum instances and conservative
   maxima.
7. [Pending] Deploy Firebase Hosting staging and its same-origin `/api/**` rewrite.
8. [Pending] Validate admin sign-in, queue/acceptance, archive repair, read-only SQL,
   costs, cold starts, and rollback before approving production.
9. [Complete] GitHub Workload Identity Federation, least-privilege staging grants,
   and the digest-pinned deployment workflow are configured; repeated successful
   `main` runs have verified the deployment path.
10. [Pending; Phase 5] Repeat the reviewed configuration for production, then
    retire transitional hosting only after the rollback window.
