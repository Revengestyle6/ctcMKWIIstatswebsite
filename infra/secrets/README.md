# Phase 4 Runtime Secrets

All secrets use user-managed replication in `us-central1`. Version `1` was
created and enabled July 25, 2026.

| Secret | Cloud Run/job variable | Authorized service account |
| --- | --- | --- |
| `ctc-staging-database-url` | `DATABASE_URL` | `ctc-api-staging` |
| `ctc-prod-database-url` | `DATABASE_URL` | `ctc-api-prod` |
| `ctc-migrator-staging-database-url` | `DATABASE_URL` for staging migration/import | `ctc-db-migrator` |
| `ctc-migrator-prod-database-url` | `DATABASE_URL` for production migration/import | `ctc-db-migrator` |
| `ctc-staging-rate-limit-hmac` | `SUBMISSION_RATE_LIMIT_SECRET` | `ctc-api-staging` |
| `ctc-prod-rate-limit-hmac` | `SUBMISSION_RATE_LIMIT_SECRET` | `ctc-api-prod` |

Secret Accessor is granted on each individual secret rather than at project
level. Secret values must never be printed during verification. Inspect metadata
without reading payloads:

```bash
gcloud secrets versions describe 1 \
  --secret=ctc-staging-database-url \
  --project=mkw-stats
```

Rotation requires coordinated database-password and Cloud Run revision changes.
Create a separate reviewed rotation runbook before the first planned credential
rotation; do not overwrite or disable the serving version ad hoc.
