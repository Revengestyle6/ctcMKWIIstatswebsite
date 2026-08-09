# Cloud Storage Configuration

The production topology uses five private, regional Standard-class buckets:

| Bucket | Purpose |
| --- | --- |
| `mkw-stats-staging-archive` | Staging review queue and accepted match JSON |
| `mkw-stats-prod-archive` | Production review queue and accepted match JSON |
| `mkw-stats-db-exports` | Logical PostgreSQL exports |
| `mkw-stats-staging-media` | Staging normalized team-logo uploads |
| `mkw-stats-prod-media` | Production normalized team-logo uploads |

Both archive buckets use `archive-lifecycle.json`. Objects under `queue/` are
deleted after 30 days; objects under `accepted/` have no lifecycle deletion rule.
The export bucket uses `database-export-lifecycle.json`: `daily/` objects expire
after 30 days, `monthly/` objects expire after 365 days, and `annual/` objects have
no lifecycle deletion rule.

All buckets are in `us-central1`, enforce public-access prevention and uniform
bucket-level access, and retain soft-deleted objects for seven days. Object
versioning is disabled. The application uses generation-match preconditions for
both immutable accepted JSON and content-addressed uploaded media.

Media objects have no lifecycle deletion rule. Administrators deactivate logo
metadata instead of deleting historical assets. The staging API identity has
`roles/storage.objectCreator` and `roles/storage.objectViewer` only on
`mkw-stats-staging-media`; the production API identity has the same two roles only
on `mkw-stats-prod-media`. Neither runtime can delete media objects.

The July 25, 2026 staging rebuild temporarily uploaded 464 repository files under
`bootstrap/JSON`. The controlled bootstrap job imported 244 authoritative sources,
promoted all 244 to `accepted/`, and reported zero failures. After database and
object counts were verified, the temporary prefix was deleted. Those temporary
objects remain recoverable for the bucket's seven-day soft-delete window; the
244 live `accepted/` objects are the durable staging archive.

Lifecycle configuration can be reconciled explicitly:

```bash
gcloud storage buckets update gs://mkw-stats-staging-archive \
  --lifecycle-file=infra/storage/archive-lifecycle.json

gcloud storage buckets update gs://mkw-stats-prod-archive \
  --lifecycle-file=infra/storage/archive-lifecycle.json

gcloud storage buckets update gs://mkw-stats-db-exports \
  --lifecycle-file=infra/storage/database-export-lifecycle.json
```

Bucket IAM is configured separately with the runtime and maintenance identities.
Do not grant public access or give the Flask runtime access to the export bucket.
