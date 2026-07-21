# Phase 4 Resource Inventory

This inventory records approved cloud resources and configuration checkpoints.
Secrets and environment-specific credentials are never committed here.

## Firebase And Google Cloud Project

| Setting | Value |
| --- | --- |
| Project display name | CTC MKWII Stats |
| Project ID | `mkw-stats` |
| Firebase auth domain | `mkw-stats.firebaseapp.com` |
| Firebase web app ID | `1:1054134490602:web:6e5f37e3beccd7d4b28e93` |
| Firebase web app nickname | `ctc-mkwii-stats-web` (owner-confirmed setup) |
| Permanent project owner | `ynhcaz@gmail.com` |
| Application owner allowlist | `ynhcaz@gmail.com`; activated and Firebase UID bound July 20, 2026 |
| Firebase Authentication | Initialized and provider handshake verified July 20, 2026 |
| Google sign-in provider | Enabled; authorization URI creation verified |
| Authorized local domain | `localhost`; authorization URI creation verified |
| Google Analytics | Disabled at initial setup |
| Gemini in Firebase | Disabled at initial setup |
| Billing | Spark/no-cost during authentication setup; no paid resources approved |
| Region | Not applicable to Firebase Authentication |

The Firebase web API key is a public build identifier, but remains in ignored
local/deployment environment configuration rather than repository source. The
backend receives only `FIREBASE_PROJECT_ID=mkw-stats` to verify token audience.

The project was intentionally created separately from `cs-528-zgentile`. Before
paid resources are provisioned, verify whether its funded billing account can be
linked to `mkw-stats` without placing the project under the BU organization. Keep
the permanent personal account as a direct project owner before the BU account is
retired.

## Pending Resource Checkpoints

- Record the project's resource hierarchy parent (`No organization` expected).
- Verify billing-account eligibility and institutional terms before linking it.
- Approve and document Cloud SQL, Cloud Storage, service accounts, secrets,
  Cloud Run, Firebase Hosting, budget alerts, and CI identity separately.

## Database Health Additions After Cloud SQL Deployment

Keep application-level PostgreSQL integrity checks independent from managed-service
operations. After the Cloud SQL instance exists, add a separate Cloud SQL operations
section backed by Cloud SQL Admin and Cloud Monitoring data:

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
